package util

import org.apache.pekko.actor.ActorSystem
import play.api.cache.AsyncCacheApi
import service.SwrCache

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}

/**
 * A [[SwrCache]] whose bounded cold path answers `None` outright for chosen keys, their compute never started, so a
 * spec can hold an endpoint to its still-computing contract without waiting on a real fan-out (#5418, #5432). The hit
 * path is left alone, so the rest of the app's caches behave normally.
 */
@Singleton
class ColdSwrCache @Inject() (cacheApi: AsyncCacheApi, actorSystem: ActorSystem)(using context: ExecutionContext)
    extends SwrCache(cacheApi, actorSystem) {

  /** Which keys are cold; every one by default, so a suite that never narrows it sees no compute at all. */
  @volatile var isCold: String => Boolean = _ => true

  override def staleWhileRevalidateWithin[T](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      coldWait: FiniteDuration
  )(compute: => Future[T]): Future[Option[T]] =
    if (isCold(key)) Future.successful(None)
    else super.staleWhileRevalidateWithin(key, freshFor, maxAge, coldWait)(compute)
}
