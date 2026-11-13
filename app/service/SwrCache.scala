package service

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import play.api.Logger
import play.api.cache.AsyncCacheApi

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import javax.inject.*
import scala.concurrent.duration.{Duration, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

object SwrCache {

  /**
   * What a cold request gets while its key is backing off after a failed compute (#5977): the compute was not run
   * again, and `retryAfter` says when it may be.
   *
   * Its own type so a caller can answer "try again shortly" (an HTTP 503 with `Retry-After`) and log it quietly, where
   * the compute's own failure, logged once by [[SwrCache]], is the one worth an error.
   *
   * @param key        The cache key that is backing off.
   * @param retryAfter How long until a request may start the compute again.
   * @param cause      The failure that started the backoff.
   */
  final class RecentlyFailedException(val key: String, val retryAfter: FiniteDuration, cause: Throwable)
      extends RuntimeException(s"'$key' failed recently; retrying in $retryAfter: ${cause.getMessage}", cause)
}

/**
 * A stale-while-revalidate layer over the Play cache, for expensive computations that must never block a request
 * (#4600). Extracted from ConfigService so other services (e.g. the GA traffic fan-out) share one implementation.
 *
 * One instance serves every caller, so the in-flight map's lock is shared across services. It covers registering a
 * `Future`, never awaiting one — a `compute` that blocks before returning would stall every other service's cache.
 *
 * A failed compute never replaces the cached value. A caller can also pass a `failureBackoff`, for a compute expensive
 * enough that rerunning it on every request after a failure would add load to whatever just failed: for that long no
 * new compute of the key starts, so a stale hit is served without a refresh and a miss fails at once with a
 * [[SwrCache.RecentlyFailedException]] (#5977). The default of zero retries on the next request.
 */
@Singleton
class SwrCache @Inject() (cacheApi: AsyncCacheApi, actorSystem: ActorSystem)(using val ec: ExecutionContext) {
  private val logger = Logger(this.getClass)

  /** A cached value plus when it was computed, so stale data can be served while a refresh runs (#4600). */
  private case class Timestamped[T](value: T, computedAt: OffsetDateTime)

  /** In-flight cache recomputes by cache key, so concurrent refreshes of a key share one computation (#4600). */
  private val refreshesInFlight = scala.collection.mutable.Map.empty[String, Future[?]]

  /**
   * A key's most recent failed compute, as (System.nanoTime when it failed, the error); cleared by a success. Bounded
   * by the number of keys, which callers keep finite (keys never carry free-form request input).
   */
  private val recentFailures = scala.collection.mutable.Map.empty[String, (Long, Throwable)]

  /**
   * Whether `key` is inside `failureBackoff` of its last failed compute. Lets a spec wait for a failed refresh to be
   * recorded instead of guessing how long that takes.
   *
   * @return True while a compute of `key` would be refused.
   */
  private[service] def isBackingOff(key: String, failureBackoff: FiniteDuration): Boolean =
    synchronized(backoffFailure(key, failureBackoff).isDefined)

  /**
   * Serves the cached value for `key` immediately — even when stale — while keeping it fresh in the background.
   *
   * When the cached copy is older than `freshFor`, a single background recompute is kicked off and the stale copy is
   * returned right away; requests arriving while a recompute runs share it rather than piling more load on the
   * database. Only a request that finds nothing cached at all (first call since JVM start, or the value aged past
   * `maxAge`) blocks on `compute`.
   *
   * The cache key should name the value's shape (e.g. a `:v2-bundle` suffix) when it could change across versions:
   * this reads `cacheApi.get[Timestamped[T]](key)` and `T` erases, so nothing would catch a differently-shaped value
   * stored under the same key.
   *
   * @param key      Cache key; must uniquely identify the computation, including any parameters.
   * @param freshFor Age beyond which serving the cached value also triggers a background recompute.
   * @param maxAge   Hard cache-eviction bound; past this, a request blocks on recomputing.
   * @param failureBackoff How long after a failed compute no new one starts; zero (the default) never holds one back.
   * @param compute  The expensive computation producing a fresh value.
   * @return         The cached (possibly stale) value, or the result of `compute` when nothing is cached.
   */
  def staleWhileRevalidate[T](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      failureBackoff: FiniteDuration = Duration.Zero
  )(compute: => Future[T]): Future[T] =
    serveCached(key, freshFor, maxAge, failureBackoff)(compute).flatMap {
      case Some(cached) => Future.successful(cached)
      case None => refreshCachedValue(key, maxAge, failureBackoff)(compute) // Nothing cached yet: wait for the compute.
    }

  /**
   * [[staleWhileRevalidate]] with a bound on how long a cold-cache request waits for the value (#5418).
   *
   * A hit, fresh or stale, is served exactly as by [[staleWhileRevalidate]]. On a miss the (coalesced) compute is
   * started and the caller waits at most `coldWait` for it; past that, `None` is returned while the compute keeps
   * running and still fills the cache when it finishes, so a retry finds either the value or the same in-flight
   * computation to attach to. For a computation that can outlast the reverse proxy's timeout, that turns a `502` the
   * client can do nothing with into an answer it can act on.
   *
   * @param coldWait       How long a request that found nothing cached waits for the compute before giving up on it.
   * @param failureBackoff As in [[staleWhileRevalidate]].
   * @return               `Some(value)` — cached, stale, or computed within `coldWait` — or `None` when the deadline
   *                       passed first. The compute's failure is still the caller's, as in [[staleWhileRevalidate]].
   */
  def staleWhileRevalidateWithin[T](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      coldWait: FiniteDuration,
      failureBackoff: FiniteDuration = Duration.Zero
  )(compute: => Future[T]): Future[Option[T]] =
    serveCached(key, freshFor, maxAge, failureBackoff)(compute).flatMap {
      case Some(cached) => Future.successful(Some(cached))
      case None         =>
        val computation: Future[Option[T]] = refreshCachedValue(key, maxAge, failureBackoff)(compute).map(Some(_))
        val deadline: Future[Option[T]]    = after(coldWait, actorSystem.scheduler)(Future.successful(None))
        Future.firstCompletedOf(Seq(computation, deadline))
    }

  /**
   * Stores `value` under `key` as if a refresh had just computed it, so a later [[staleWhileRevalidate]] (or the
   * deadline variant) under the same key and `T` serves it (#5418).
   *
   * For a job that has already done the computation a request would otherwise block on — the nightly AccessScore
   * Spotlight snapshot computes the very value `/v3/api/accessScoreStreets` caches — so a cold JVM's first request
   * after the job is a hit, not a wait. Deliberately not routed through the in-flight map: the caller's value is
   * final, and a request-triggered refresh that started earlier must neither be handed this value nor block it. Nor
   * may it overwrite it: a refresh that finishes after this write finds the newer timestamp and leaves it in place.
   *
   * @param key    Cache key, the same one the readers use.
   * @param value  The value to serve from now on.
   * @param maxAge Hard cache-eviction bound, the same one the readers pass.
   * @return       Completes once the value is in the cache.
   */
  def put[T](key: String, value: T, maxAge: FiniteDuration): Future[Unit] =
    cacheApi.set(key, Timestamped(value, OffsetDateTime.now()), maxAge).map(_ => ())

  /**
   * The hit half both public variants share: the cached value if there is one, with a background recompute kicked
   * off when it has gone stale.
   *
   * @return `Some(cached)` on a hit, `None` on a miss (nothing started; the caller decides how to wait).
   */
  private def serveCached[T](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      failureBackoff: FiniteDuration
  )(compute: => Future[T]): Future[Option[T]] =
    cacheApi.get[Timestamped[T]](key).map {
      case Some(cached) =>
        val ageSeconds = ChronoUnit.SECONDS.between(cached.computedAt, OffsetDateTime.now())
        if (ageSeconds >= freshFor.toSeconds) { val _ = refreshCachedValue(key, maxAge, failureBackoff)(compute) }
        Some(cached.value)
      case None => None
    }

  /**
   * Recomputes the value behind `key` and caches it, coalescing concurrent calls into one shared computation.
   *
   * The write is skipped when the cache already holds a value computed after this refresh started: a [[put]] landed
   * while the compute ran, and the caller of `put` had newer inputs than this compute read. The nightly AccessScore
   * snapshot seeds its key at the end of the clustering job, and a request-triggered refresh that started
   * mid-clustering would otherwise land afterwards and replace the post-clustering scores with pre-clustering ones
   * for the rest of the fresh window. The refresh's own callers still receive what it computed (#5418).
   *
   * Within `failureBackoff` of this key's last failed compute, nothing is started and a
   * [[SwrCache.RecentlyFailedException]] is returned instead (#5977). A stale hit discards the result, so it simply
   * goes unrefreshed until the backoff ends.
   *
   * @return The freshly computed value, or the computation's failure (already-cached data is left untouched).
   */
  private def refreshCachedValue[T](key: String, maxAge: FiniteDuration, failureBackoff: FiniteDuration)(
      compute: => Future[T]
  ): Future[T] =
    synchronized {
      (refreshesInFlight.get(key), backoffFailure(key, failureBackoff)) match {
        // The cast is safe because a given key is only ever refreshed with one result type.
        case (Some(inFlight), _)                  => inFlight.asInstanceOf[Future[T]]
        case (None, Some((remaining, lastError))) =>
          Future.failed(SwrCache.RecentlyFailedException(key, remaining, lastError))
        case (None, None) =>
          val startedAt = OffsetDateTime.now()
          // Future.delegate guards against `compute` throwing synchronously (before producing a Future): the throw
          // becomes a failed Future handled by the bookkeeping below, instead of escaping to a caller that could have
          // been served stale data.
          val computation = Future
            .delegate(compute)
            .flatMap { value =>
              cacheApi.get[Timestamped[T]](key).flatMap {
                case Some(newer) if newer.computedAt.isAfter(startedAt) =>
                  logger.debug(s"Recompute of cached '$key' finished behind a newer value; keeping the newer one.")
                  Future.successful(value)
                case _ =>
                  cacheApi.set(key, Timestamped(value, OffsetDateTime.now()), maxAge).map(_ => value)
              }
            }
            // Part of the Future the callers get rather than a side callback, so the in-flight entry is gone and the
            // backoff recorded by the time any caller sees the outcome. The callback runs on the pool, never inline on
            // this thread (`synchronized` is reentrant, so an inline one would run before the map write below and
            // leave the entry stuck); on another thread it waits on this lock until that write has happened.
            .transform { result =>
              val failedBefore: Boolean = synchronized {
                val _      = refreshesInFlight.remove(key)
                val before = recentFailures.contains(key)
                result.fold(
                  e => recentFailures(key) = (System.nanoTime(), e),
                  _ => { val _ = recentFailures.remove(key) }
                )
                before
              }
              result.failed.foreach { e =>
                val message =
                  s"Recompute of cached '$key' failed (next attempt allowed in ${failureBackoff.toSeconds} s): ${e.getMessage}"
                // The stack trace only for the first failure in a row: an outage repeats the same one every backoff.
                if (failedBefore) logger.warn(message) else logger.warn(message, e)
              }
              result
            }
          refreshesInFlight(key) = computation
          computation
      }
    }

  /**
   * The failure holding `key` back, if its last compute failed less than `failureBackoff` ago. Call under the lock.
   *
   * @return How long the backoff has left and the failure that started it, or None when a compute may start.
   */
  private def backoffFailure(key: String, failureBackoff: FiniteDuration): Option[(FiniteDuration, Throwable)] =
    recentFailures.get(key).flatMap { case (failedAt, error) =>
      val remainingNanos = failureBackoff.toNanos - (System.nanoTime() - failedAt)
      Option.when(remainingNanos > 0)((Duration.fromNanos(remainingNanos), error))
    }
}
