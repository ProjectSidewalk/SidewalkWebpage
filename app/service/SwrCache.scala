package service

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import play.api.Logger
import play.api.cache.AsyncCacheApi

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import javax.inject._
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

/**
 * A stale-while-revalidate layer over the Play cache, for expensive computations that must never block a request
 * (#4600). Extracted from ConfigService so other services (e.g. the GA traffic fan-out) share one implementation.
 *
 * One instance serves every caller, so the in-flight map's lock is shared across services. It covers registering a
 * `Future`, never awaiting one — a `compute` that blocks before returning would stall every other service's cache.
 */
@Singleton
class SwrCache @Inject() (cacheApi: AsyncCacheApi, actorSystem: ActorSystem)(implicit val ec: ExecutionContext) {
  private val logger = Logger(this.getClass)

  /** A cached value plus when it was computed, so stale data can be served while a refresh runs (#4600). */
  private case class Timestamped[T](value: T, computedAt: OffsetDateTime)

  /** In-flight cache recomputes by cache key, so concurrent refreshes of a key share one computation (#4600). */
  private val refreshesInFlight = scala.collection.mutable.Map.empty[String, Future[_]]

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
   * @param compute  The expensive computation producing a fresh value.
   * @return         The cached (possibly stale) value, or the result of `compute` when nothing is cached.
   */
  def staleWhileRevalidate[T: ClassTag](key: String, freshFor: FiniteDuration, maxAge: FiniteDuration)(
      compute: => Future[T]
  ): Future[T] =
    serveCached(key, freshFor, maxAge)(compute).flatMap {
      case Some(cached) => Future.successful(cached)
      case None         => refreshCachedValue(key, maxAge)(compute) // Nothing cached yet: wait for the compute.
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
   * @param coldWait How long a request that found nothing cached waits for the compute before giving up on it.
   * @return         `Some(value)` — cached, stale, or computed within `coldWait` — or `None` when the deadline passed
   *                 first. The compute's failure is still the caller's, as in [[staleWhileRevalidate]].
   */
  def staleWhileRevalidateWithin[T: ClassTag](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      coldWait: FiniteDuration
  )(compute: => Future[T]): Future[Option[T]] =
    serveCached(key, freshFor, maxAge)(compute).flatMap {
      case Some(cached) => Future.successful(Some(cached))
      case None         =>
        val computation: Future[Option[T]] = refreshCachedValue(key, maxAge)(compute).map(Some(_))
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
  private def serveCached[T: ClassTag](key: String, freshFor: FiniteDuration, maxAge: FiniteDuration)(
      compute: => Future[T]
  ): Future[Option[T]] =
    cacheApi.get[Timestamped[T]](key).map {
      case Some(cached) =>
        val ageSeconds = ChronoUnit.SECONDS.between(cached.computedAt, OffsetDateTime.now())
        if (ageSeconds >= freshFor.toSeconds) { val _ = refreshCachedValue(key, maxAge)(compute) }
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
   * @return The freshly computed value, or the computation's failure (already-cached data is left untouched).
   */
  private def refreshCachedValue[T](key: String, maxAge: FiniteDuration)(compute: => Future[T]): Future[T] =
    synchronized {
      refreshesInFlight.get(key) match {
        // The cast is safe because a given key is only ever refreshed with one result type.
        case Some(inFlight) => inFlight.asInstanceOf[Future[T]]
        case None           =>
          val startedAt = OffsetDateTime.now()
          // Future.delegate guards against `compute` throwing synchronously (before producing a Future): the throw
          // becomes a failed Future handled by the onComplete logging below, instead of escaping to a caller that
          // could have been served stale data.
          val computation = Future.delegate(compute).flatMap { value =>
            cacheApi.get[Timestamped[T]](key).flatMap {
              case Some(newer) if newer.computedAt.isAfter(startedAt) =>
                logger.debug(s"Recompute of cached '$key' finished behind a newer value; keeping the newer one.")
                Future.successful(value)
              case _ =>
                cacheApi.set(key, Timestamped(value, OffsetDateTime.now()), maxAge).map(_ => value)
            }
          }
          computation.onComplete { result =>
            synchronized { val _ = refreshesInFlight.remove(key) }
            result.failed.foreach(e => logger.warn(s"Recompute of cached '$key' failed: ${e.getMessage}", e))
          }
          refreshesInFlight(key) = computation
          computation
      }
    }
}
