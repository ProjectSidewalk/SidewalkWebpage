package service

import models.utils.{ConfigTable, FunnelStatTable, VersionTable}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.i18n.{Lang, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/**
 * What `/timeCheck` does when the cross-city fan-out goes wrong (#4526).
 *
 * A volunteer reads this page to report service hours, so the two ways it can fail them are a 500 and a number that
 * is quietly too small. Both live on paths the normal DB-backed spec can't reach, because a healthy database never
 * produces an unreadable schema. Here the scope is supplied directly, so the failures are reachable on purpose while
 * the per-city queries still run against the real database.
 */
class CrossCityHoursResilienceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: => Future[T]): T = Await.result(f, 60.seconds)

  private val ghostId = "00000000-0000-0000-0000-000000000000"

  private lazy val realConfig  = app.injector.instanceOf[ConfigService]
  private lazy val realService = app.injector.instanceOf[UserService]
  private lazy val thisCity    = realConfig.getCityId
  private lazy val thisSchema  = realConfig.getCitySchema(thisCity)

  // A user who has actually logged time here; the fallback's real contract is invisible against an empty account.
  private lazy val activeUser: Option[String] = await(realService.getLeaderboardStats(1, "overall")).headOption
    .flatMap(stat => await(app.injector.instanceOf[AuthenticationService].findByUsername(stat.username)))
    .map(_.userId)

  /** A `ConfigService` identical to the real one except for the scope the hours fan-out is handed. */
  private class ScopedConfigService(scope: => Future[SelfViewScope])
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
    override def getCrossCityHoursScope: Future[SelfViewScope] = scope
  }

  private def userServiceWith(scope: => Future[SelfViewScope]): UserService = new UserServiceImpl(
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
    new ScopedConfigService(scope),
    app.injector.instanceOf[AsyncCacheApi],
    global
  )

  "getCrossCityHours" should {
    "fall back to this city's own total when the scope can't be determined at all" in {
      // Without this the page 500s on a volunteer who may be mid-way through logging hours, when the number they
      // came for is still perfectly computable.
      val service = userServiceWith(Future.failed(new RuntimeException("scope lookup exploded")))
      val result  = await(service.getCrossCityHours(ghostId, Lang("en")))

      result.cities.count(_.isCurrentCity) must be <= 1
      result.cities.foreach(_.cityId mustBe thisCity)
      // Every other deployment went unchecked, so the page has to say the total is a floor rather than an answer.
      result.unreachableCities must be > 0
    }

    "report exactly this city's own hours in that fallback, not a zero or a partial figure" in {
      activeUser.foreach { userId =>
        val service = userServiceWith(Future.failed(new RuntimeException("scope lookup exploded")))
        val result  = await(service.getCrossCityHours(userId, Lang("en")))

        result.totalHours mustBe UserService.toDisplayedTenth(await(realService.getHoursAuditingAndValidating(userId)))
        if (result.totalHours > 0d) result.cities.map(_.cityId) mustBe Seq(thisCity)
      }
    }

    "keep the cities it could read when one schema is unreadable, and count the one it lost" in {
      val service = userServiceWith(
        Future.successful(SelfViewScope(Seq(thisCity -> thisSchema, "ghost-city" -> "sidewalk_not_a_real_schema"), Nil))
      )
      val result = await(service.getCrossCityHours(ghostId, Lang("en")))

      result.cities.map(_.cityId) must not contain "ghost-city"
      result.unreachableCities mustBe 1
    }

    "survive a schema name the query builder refuses, rather than letting it escape the fan-out" in {
      // The guard throws while its argument is evaluated, so it lands outside any recover hung off the db.run future.
      val service = userServiceWith(
        Future.successful(
          SelfViewScope(Seq(thisCity -> thisSchema, "bad-city" -> "Not A Schema; DROP TABLE label"), Nil)
        )
      )
      val result = await(service.getCrossCityHours(ghostId, Lang("en")))

      result.cities.map(_.cityId) must not contain "bad-city"
      result.unreachableCities mustBe 1
    }

    "carry the scope's own exclusions into the count, so a gated city isn't silently dropped" in {
      val service = userServiceWith(
        Future.successful(SelfViewScope(Seq(thisCity -> thisSchema), Seq("sidewalk_behind_on_evolutions")))
      )
      await(service.getCrossCityHours(ghostId, Lang("en"))).unreachableCities mustBe 1
    }

    "report nothing unreachable when every city in scope answered" in {
      val service = userServiceWith(Future.successful(SelfViewScope(Seq(thisCity -> thisSchema), Nil)))
      await(service.getCrossCityHours(ghostId, Lang("en"))).unreachableCities mustBe 0
    }

    "add up every source of loss rather than reporting only the worst one" in {
      val service = userServiceWith(
        Future.successful(
          SelfViewScope(
            Seq(thisCity -> thisSchema, "ghost-city" -> "sidewalk_not_a_real_schema", "bad-city" -> "Bad Schema!"),
            Seq("sidewalk_behind_on_evolutions")
          )
        )
      )
      await(service.getCrossCityHours(ghostId, Lang("en"))).unreachableCities mustBe 3
    }
  }
}
