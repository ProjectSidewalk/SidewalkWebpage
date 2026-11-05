package service

import models.utils.{ConfigTable, FunnelStatTable, VersionTable}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.i18n.MessagesApi
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration}
import util.SidewalkSpec

import java.time.OffsetDateTime
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future, Promise}

/**
 * How `/leaderboard`'s global board behaves behind [[SwrCache]] (#5235): a stale board is served at once while the
 * ~50-schema union refreshes behind it, and a failed refresh never replaces a board, or the lack of one, in the cache.
 *
 * The board's scope lookup is the first step of every recompute, so each test hands the service a scope it controls:
 * a `Promise` keeps a refresh "still running" for as long as the test needs, and a counter shows whether a recompute
 * started at all. Each test uses its own `n`, so its cache key is its own; the cache is per JVM and the suite shares
 * one. A board past its fresh window is planted directly rather than waited for.
 */
class GlobalLeaderboardCacheSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: => Future[T], within: FiniteDuration = 30.seconds): T = Await.result(f, within)

  private lazy val swrCache   = app.injector.instanceOf[SwrCache]
  private lazy val realConfig = app.injector.instanceOf[ConfigService]

  /** A board no real query could produce, so serving it can only mean the planted copy was served. */
  private val plantedBoard: Option[Seq[GlobalLeaderboardEntry]] =
    Some(Seq(GlobalLeaderboardEntry("GlobalLeaderboardCacheSpec-planted", 42, 1, 0.0, None, None, false)))

  /** A `ConfigService` identical to the real one except for the scope the global board is built from. */
  private class ScopedConfigService(scope: () => Future[GlobalLeaderboardScope])
      extends ConfigServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        app.injector.instanceOf[Configuration],
        app.injector.instanceOf[MessagesApi],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[WSClient],
        app.injector.instanceOf[ConfigTable],
        app.injector.instanceOf[FunnelStatTable],
        app.injector.instanceOf[VersionTable],
        app.injector.instanceOf[PanoDataService],
        app.injector.instanceOf[SwrCache],
        app.injector.instanceOf[AssetManifestService]
      ) {
    override def getGlobalLeaderboardScope: Future[GlobalLeaderboardScope] = scope()
  }

  /**
   * A real `UserServiceImpl` whose global board reads `scope`, counting every recompute that starts.
   *
   * @param scope The scope each recompute is handed, re-evaluated per recompute so a test can change it mid-way.
   * @return      The service, and the number of recomputes started so far.
   */
  private def serviceWith(scope: => Future[GlobalLeaderboardScope]): (UserService, AtomicInteger) = {
    val recomputes = AtomicInteger(0)
    val service    = UserServiceImpl(
      app.injector.instanceOf[DatabaseConfigProvider],
      app.injector.instanceOf[models.user.UserStatTable],
      app.injector.instanceOf[models.user.SidewalkUserTable],
      app.injector.instanceOf[models.userdashboard.TrophyTable],
      app.injector.instanceOf[models.mission.MissionTable],
      app.injector.instanceOf[models.label.LabelTable],
      app.injector.instanceOf[models.validation.LabelValidationTable],
      app.injector.instanceOf[models.audit.AuditTaskTable],
      app.injector.instanceOf[models.audit.AuditTaskInteractionTable],
      app.injector.instanceOf[StreetService],
      app.injector.instanceOf[models.user.UserTeamTable],
      app.injector.instanceOf[models.user.TeamTable],
      app.injector.instanceOf[models.user.UserUtmTable],
      app.injector.instanceOf[models.user.UserSettingsTable],
      ScopedConfigService { () => recomputes.incrementAndGet(); scope },
      app.injector.instanceOf[AsyncCacheApi],
      swrCache
    )(using global)
    (service, recomputes)
  }

  /** Plants `plantedBoard` under the key for `n` as if it had been computed past the fresh window. */
  private def plantStaleBoard(n: Int): Unit = {
    val computedAt = OffsetDateTime.now().minusSeconds(ConfigService.CrossCityFreshFor.toSeconds + 60)
    await(swrCache.putComputedAt(UserService.globalLeaderboardCacheKey(n), plantedBoard, computedAt, 2.hours))
  }

  /** Polls `condition` until it holds, failing the test if it never does within `within`. */
  private def pollUntil(within: FiniteDuration)(condition: => Boolean): Unit = {
    val until = System.nanoTime() + within.toNanos
    while (!condition) {
      if (System.nanoTime() > until) fail(s"condition never held within $within")
      Thread.sleep(25)
    }
  }

  "getGlobalLeaderboardStats" should {
    "serve a stale board at once while its refresh is still running, then serve the refreshed one" in {
      val n                  = 9101
      val refresh            = Promise[GlobalLeaderboardScope]()
      val (service, started) = serviceWith(refresh.future)
      plantStaleBoard(n)

      // The refresh can't finish until the test says so, so a render that waited on it would time out here.
      await(service.getGlobalLeaderboardStats(n), within = 5.seconds) mustBe plantedBoard
      pollUntil(5.seconds)(started.get() == 1)

      // A second request inside the same refresh is served the same stale board and joins that refresh.
      await(service.getGlobalLeaderboardStats(n), within = 5.seconds) mustBe plantedBoard
      started.get() mustBe 1

      // An empty scope computes `None`, which no stale read could return, so seeing it means the refresh landed.
      refresh.success(GlobalLeaderboardScope(Nil, Nil))
      // No recompute count is asserted past this point: a poll that read the stale entry just before the write can
      // start one redundant refresh after the first leaves the in-flight map, which is harmless and racy to pin.
      pollUntil(5.seconds)(await(service.getGlobalLeaderboardStats(n)).isEmpty)
    }

    "keep serving the cached board when its refresh fails, and keep retrying the refresh" in {
      val n                  = 9102
      val (service, started) = serviceWith(Future.failed(RuntimeException("union exploded")))
      plantStaleBoard(n)

      // Each stale read starts a refresh once the last one has failed; a failure that reached the cache would turn
      // a later read into `None` (the recover's answer) instead of the planted board.
      pollUntil(10.seconds) {
        await(service.getGlobalLeaderboardStats(n), within = 5.seconds) mustBe plantedBoard
        started.get() >= 3
      }
      await(service.getGlobalLeaderboardStats(n)) mustBe plantedBoard
    }

    "drop the section on a cold-cache failure without remembering it as no board" in {
      val n                  = 9103
      val scope              = AtomicReference[Future[GlobalLeaderboardScope]](Future.failed(RuntimeException("down")))
      val (service, started) = serviceWith(scope.get())

      // Nothing cached and the compute failed: the page omits the section rather than erroring.
      await(service.getGlobalLeaderboardStats(n)) mustBe None
      started.get() mustBe 1

      // The next request must recompute, not be handed a cached "no board". A real single-city scope yields `Some`,
      // even if empty, which the recover's `None` can't be mistaken for.
      val thisCity = realConfig.getCityId
      scope.set(Future.successful(GlobalLeaderboardScope(Seq(thisCity -> realConfig.getCitySchema(thisCity)), Nil)))
      // Polled, because the failed compute leaves the in-flight map from an `onComplete` that can run after the recover
      // answered, so a request straight after may still join that failed future. What matters is that one recomputes.
      pollUntil(10.seconds)(await(service.getGlobalLeaderboardStats(n)).isDefined)
      started.get() must be >= 2

      // Now cached and fresh, so a further request is served without recomputing.
      val recomputesSoFar = started.get()
      await(service.getGlobalLeaderboardStats(n)) mustBe defined
      started.get() mustBe recomputesSoFar
    }
  }
}
