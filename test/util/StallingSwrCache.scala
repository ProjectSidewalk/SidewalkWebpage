package util

import org.apache.pekko.actor.ActorSystem
import play.api.cache.AsyncCacheApi
import service.SwrCache

import java.util.concurrent.ConcurrentHashMap
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future, Promise}

/**
 * A [[SwrCache]] that can make chosen keys' cold computes never finish, while still running them through the real
 * deadline race of `staleWhileRevalidateWithin` (#5432). Unlike `ColdSwrCache`, which skips the race and answers
 * `None` outright, this proves the deadline itself is what frees the request: a compute that never completes must not
 * hold it.
 *
 * Also records the `coldWait` every bounded read was called with, so a spec can pin which deadline each read uses.
 *
 * A stalled key is raced under a private alias, never under its real key: the never-completing compute stays in the
 * in-flight map forever, and under the real key it would capture every later read of that key in the same app.
 */
@Singleton
class StallingSwrCache @Inject() (cacheApi: AsyncCacheApi, actorSystem: ActorSystem)(using context: ExecutionContext)
    extends SwrCache(cacheApi, actorSystem) {

  /** How long a stalled read waits before its deadline fires; short, so specs stay fast. */
  val StalledColdWait: FiniteDuration = 100.millis

  /** Keys whose cold compute should never finish; set by the spec before the request it is about. */
  @volatile var stalledKeys: Set[String] = Set.empty

  /** The `coldWait` most recently passed for each key, as the code under test chose it. */
  val coldWaitByKey: ConcurrentHashMap[String, FiniteDuration] = ConcurrentHashMap()

  override def staleWhileRevalidateWithin[T](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      coldWait: FiniteDuration
  )(compute: => Future[T]): Future[Option[T]] = {
    coldWaitByKey.put(key, coldWait)
    if (stalledKeys.contains(key)) {
      super.staleWhileRevalidateWithin(s"stalling-swr-cache:$key", freshFor, maxAge, StalledColdWait)(
        Promise[T]().future
      )
    } else {
      super.staleWhileRevalidateWithin(key, freshFor, maxAge, coldWait)(compute)
    }
  }
}
