package service

import play.api.Configuration

import java.util.concurrent.ConcurrentHashMap
import java.util.function.BiFunction
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}

/**
 * In-memory, fixed-window rate limiter for a single application instance.
 *
 * Tracks a per-key attempt count within a sliding fixed window. On by default (`rate-limit.enabled`); a deployment can
 * turn it off with `RATE_LIMIT_ENABLED=false`. IP keys are safe to limit on because client IPs come from Play's
 * forwarded-header processing (`play.http.forwarded.*`; see `CustomBaseController.ipAddress`), which a client-supplied
 * X-Forwarded-For can't spoof. State is per-instance and resets on restart, which fits the current
 * one-process-per-city deployment; a multi-instance future would need a shared store (e.g. Redis).
 *
 * @param config Application configuration; supplies `rate-limit.enabled` and the per-endpoint limit blocks.
 */
@Singleton
class RateLimiter @Inject() (config: Configuration) {

  private val enabled: Boolean = config.getOptional[Boolean]("rate-limit.enabled").getOrElse(false)

  // Above this many distinct tracked keys, sweep expired windows so a flood of unique keys can't grow the map without
  // bound. Chosen well above any legitimate per-window key count for a single instance.
  private val MaxTrackedKeys: Int = 100000

  /** A fixed window: when it started, how long it lasts, and how many attempts have landed in it. */
  private case class Window(startMs: Long, windowMs: Long, count: Int)

  private val windows = new ConcurrentHashMap[String, Window]()

  /** Current time in milliseconds. `protected` so tests can override it to drive window expiry deterministically. */
  protected def nowMs: Long = System.currentTimeMillis()

  /**
   * Records an attempt against `key` and reports whether it is within `limit`.
   *
   * Increments the current window's counter (starting a fresh window if none is active or the previous one has
   * elapsed) and returns whether the running count is still at or below the limit's `maxAttempts`. Counting is atomic
   * per key via `ConcurrentHashMap.compute`. Honors the limit's own `enabled` flag, which a per-endpoint config block
   * can set independently of the global `rate-limit.enabled` (story-submit ships enabled so photo uploads are
   * IP-bounded by default).
   *
   * Use this when the limit exists to bound request *volume*, because the work behind the endpoint is itself the cost
   * — a bcrypt hash, a photo transcode, an Overpass query — so every request has to pay whether or not it turns out to
   * be legitimate. When the limit instead exists to bound *failures*, pair [[isBlocked]] with [[record]] so a caller
   * who succeeds never spends budget.
   *
   * @param key   Identifies the thing being limited (e.g. `s"login:ip:$ip"`). Callers namespace their own keys.
   * @param limit The named limit, carrying its max-attempts, window, and effective enabled flag.
   * @return      True if the attempt is allowed, false if the limit has been exceeded within the window.
   */
  def allow(key: String, limit: RateLimiter.Limit): Boolean = {
    if (!limit.enabled) true else countAttempt(key, limit.window) <= limit.maxAttempts
  }

  /**
   * Reports whether `key` has already spent `limit`'s budget in the current window, *without* recording an attempt.
   *
   * The read half of the failure-counted pattern: check here, then [[record]] only on the outcome that should cost
   * something and [[clear]] on the one that shouldn't. Sign-in uses it so that a shared classroom account isn't locked
   * out by its own successful logins, and so the right password resets the counter instead of inheriting it.
   *
   * @param key   Identifies the thing being limited; callers namespace their own keys.
   * @param limit The named limit, carrying its max-attempts, window, and effective enabled flag.
   * @return      True if a further attempt would exceed the limit; false if the budget or the window has room.
   */
  def isBlocked(key: String, limit: RateLimiter.Limit): Boolean = {
    if (!limit.enabled) false
    else {
      val now = nowMs
      Option(windows.get(key)).exists(w => now - w.startMs < w.windowMs && w.count >= limit.maxAttempts)
    }
  }

  /** Spends one unit of `key`'s budget, starting a window if none is active. The write half of [[isBlocked]]. */
  def record(key: String, limit: RateLimiter.Limit): Unit = {
    if (limit.enabled) { val _ = countAttempt(key, limit.window) }
  }

  /** Restores `key`'s full budget, ending its window early (e.g. a sign-in that finally succeeded). */
  def clear(key: String): Unit = { val _ = windows.remove(key) }

  /** Counts one attempt against `key` and returns the running count; starts a fresh window if none is live. */
  private def countAttempt(key: String, window: FiniteDuration): Int = {
    val now      = nowMs
    val windowMs = window.toMillis
    if (windows.size > MaxTrackedKeys) evictExpired(now)

    val remap: BiFunction[String, Window, Window] = (_, existing) =>
      if (existing == null || now - existing.startMs >= windowMs) Window(now, windowMs, 1)
      else existing.copy(count = existing.count + 1)
    windows.compute(key, remap).count
  }

  /**
   * Looks up a named limit from the `rate-limit.<name>` config block. A block may carry its own `enabled` flag; when
   * absent it inherits the global `rate-limit.enabled`, so an endpoint can opt in to limiting independently.
   *
   * @param name The limit's config key (e.g. "login", "signup", "story-submit").
   * @return     The configured max-attempts, window, and effective enabled flag.
   */
  def limit(name: String): RateLimiter.Limit = {
    val block = config.get[Configuration](s"rate-limit.$name")
    RateLimiter.Limit(
      block.get[Int]("max-attempts"),
      block.get[Int]("window-seconds").seconds,
      block.getOptional[Boolean]("enabled").getOrElse(enabled)
    )
  }

  /**
   * How long until `key`'s current window elapses and its count resets — the honest value for a `Retry-After`
   * header, rather than quoting the full window length to someone who is already partway through it.
   *
   * @param key The key whose window to inspect; not recorded as an attempt.
   * @return    Seconds remaining (at least one), or None if the key has no active window.
   */
  def retryAfterSeconds(key: String): Option[Long] = {
    Option(windows.get(key)).map { w =>
      val remainingMs = w.startMs + w.windowMs - nowMs
      math.max(1L, (remainingMs + 999) / 1000) // Round up: never quote a moment before the window actually clears.
    }
  }

  /** Drops windows that have fully elapsed as of `now`, freeing memory. The CHM iterator supports safe live removal. */
  private def evictExpired(now: Long): Unit = {
    val it = windows.entrySet().iterator()
    while (it.hasNext) {
      val w = it.next().getValue
      if (now - w.startMs >= w.windowMs) it.remove()
    }
  }
}

object RateLimiter {

  /**
   * A configured rate limit.
   *
   * @param maxAttempts Attempts allowed within one window.
   * @param window      Length of the fixed window.
   * @param enabled     Whether this limit is active (from its config block, else the global `rate-limit.enabled`).
   */
  case class Limit(maxAttempts: Int, window: FiniteDuration, enabled: Boolean = false)
}
