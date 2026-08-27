package service

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
class SwrCache @Inject() (cacheApi: AsyncCacheApi)(implicit val ec: ExecutionContext) {
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
  ): Future[T] = {
    cacheApi.get[Timestamped[T]](key).flatMap {
      case Some(cached) =>
        val ageSeconds = ChronoUnit.SECONDS.between(cached.computedAt, OffsetDateTime.now())
        if (ageSeconds >= freshFor.toSeconds) { val _ = refreshCachedValue(key, maxAge)(compute) }
        Future.successful(cached.value)
      case None => refreshCachedValue(key, maxAge)(compute) // Nothing cached yet: wait for the compute.
    }
  }

  /**
   * Recomputes the value behind `key` and caches it, coalescing concurrent calls into one shared computation.
   *
   * @return The freshly computed value, or the computation's failure (already-cached data is left untouched).
   */
  private def refreshCachedValue[T](key: String, maxAge: FiniteDuration)(compute: => Future[T]): Future[T] =
    synchronized {
      refreshesInFlight.get(key) match {
        // The cast is safe because a given key is only ever refreshed with one result type.
        case Some(inFlight) => inFlight.asInstanceOf[Future[T]]
        case None           =>
          // Future.delegate guards against `compute` throwing synchronously (before producing a Future): the throw
          // becomes a failed Future handled by the onComplete logging below, instead of escaping to a caller that
          // could have been served stale data.
          val computation = Future.delegate(compute).flatMap { value =>
            cacheApi.set(key, Timestamped(value, OffsetDateTime.now()), maxAge).map(_ => value)
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
