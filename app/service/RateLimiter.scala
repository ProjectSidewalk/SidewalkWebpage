package service

import play.api.Configuration

import java.util.concurrent.ConcurrentHashMap
import java.util.function.BiFunction
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}

/**
 * In-memory, fixed-window rate limiter for a single application instance.
 *
 * Tracks a per-key attempt count within a sliding fixed window. It is a no-op when `rate-limit.enabled` is false, so it
 * can be wired into endpoints and shipped inert, then enabled by config once the deployment's proxy client-IP handling
 * is confirmed (see `CustomBaseController.ipAddress`). State is per-instance and resets on restart, which fits the
 * current single-instance deployment; a multi-instance future would need a shared store (e.g. Redis).
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
   * Records an attempt against `key` and reports whether it is within the limit.
   *
   * Always returns true when rate limiting is disabled. Otherwise increments the current window's counter (starting a
   * fresh window if none is active or the previous one has elapsed) and returns whether the running count is still at or
   * below `maxAttempts`. Counting is atomic per key via `ConcurrentHashMap.compute`.
   *
   * @param key         Identifies the thing being limited (e.g. `s"login:ip:$ip"`). Callers namespace their own keys.
   * @param maxAttempts Attempts allowed within one window before this returns false.
   * @param window      Length of the fixed window.
   * @return            True if the attempt is allowed, false if `maxAttempts` has been exceeded within the window.
   */
  def allow(key: String, maxAttempts: Int, window: FiniteDuration): Boolean = {
    if (!enabled) true else allowInWindow(key, maxAttempts, window)
  }

  /**
   * Records an attempt against `key` and reports whether it is within `limit`, honoring the limit's own `enabled`
   * flag (which a per-endpoint config block can turn on even while the global `rate-limit.enabled` is off — e.g.
   * story-submit ships enabled so photo uploads are IP-bounded by default).
   *
   * @param key   Identifies the thing being limited; callers namespace their own keys.
   * @param limit The named limit, carrying its max-attempts, window, and effective enabled flag.
   * @return      True if the attempt is allowed, false if the limit has been exceeded within the window.
   */
  def allow(key: String, limit: RateLimiter.Limit): Boolean = {
    if (!limit.enabled) true else allowInWindow(key, limit.maxAttempts, limit.window)
  }

  /** The window-counting core shared by both `allow` overloads; assumes the enabled check already passed. */
  private def allowInWindow(key: String, maxAttempts: Int, window: FiniteDuration): Boolean = {
    val now      = nowMs
    val windowMs = window.toMillis
    if (windows.size > MaxTrackedKeys) evictExpired(now)

    val remap: BiFunction[String, Window, Window] = (_, existing) =>
      if (existing == null || now - existing.startMs >= windowMs) Window(now, windowMs, 1)
      else existing.copy(count = existing.count + 1)
    windows.compute(key, remap).count <= maxAttempts
  }

  /**
   * Looks up a named limit from the `rate-limit.<name>` config block. A block may carry its own `enabled` flag; when
   * absent it inherits the global `rate-limit.enabled`, so an endpoint can opt in to limiting independently.
   *
   * @param name The limit's config key (e.g. "login", "signup", "ai-ingest").
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
