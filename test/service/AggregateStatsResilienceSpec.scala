package service

import models.api.{AggregateStats, DailyLabelStat, DailyValidationStat}
import models.utils.{ConfigTable, FunnelStatTable, VersionTable}
import org.apache.pekko.actor.ActorSystem
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.i18n.MessagesApi
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration}
import slick.dbio.DBIO
import util.SidewalkSpec

import java.sql.SQLTransientConnectionException
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future, Promise}

/**
 * The cross-city totals are complete or they are a failure, never a smaller number (#5977).
 *
 * A cached partial sum looks like the real total to everyone who reads it. Each failure is caused on purpose, through
 * a `ConfigTable` or schema list that fails on command, while every other query runs against the real database.
 */
class AggregateStatsResilienceSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: => Future[T]): T = Await.result(f, 120.seconds)

  private lazy val realConfig = app.injector.instanceOf[ConfigService]
  private lazy val ownSchema  = realConfig.getCitySchema(realConfig.getCityId)

  private def transient: Throwable = SQLTransientConnectionException("Connection is not available, timed out")

  /** A `ConfigTable` whose `failing` query fails on `schema`. */
  private class FaultyConfigTable(schema: String, failing: Option[String])
      extends ConfigTable(app.injector.instanceOf[DatabaseConfigProvider]) {

    private def faulty[T](onSchema: String, query: String)(real: => DBIO[T]): DBIO[T] =
      if (onSchema == schema && failing.contains(query)) DBIO.failed(transient) else real

    override def getCityAggregateDataBySchema(schema: String): DBIO[AggregateStats] =
      faulty(schema, "aggregate")(super.getCityAggregateDataBySchema(schema))
    override def getContributorUserIdsBySchema(schema: String): DBIO[Seq[String]] =
      faulty(schema, "contributors")(super.getContributorUserIdsBySchema(schema))
    override def getCityDailyLabelStatsBySchema(schema: String, filterLowQuality: Boolean): DBIO[Seq[DailyLabelStat]] =
      faulty(schema, "dailyLabels")(super.getCityDailyLabelStatsBySchema(schema, filterLowQuality))
    override def getCityDailyValidationStatsBySchema(
        schema: String,
        filterLowQuality: Boolean
    ): DBIO[Seq[DailyValidationStat]] =
      faulty(schema, "dailyValidations")(super.getCityDailyValidationStatsBySchema(schema, filterLowQuality))
  }

  /** The real `ConfigService` with one query failing on this city's schema, and the schema list optionally replaced. */
  private class TestConfigService(
      failing: Option[String],
      schemas: Option[Future[Set[String]]],
      needEveryCity: Boolean
  ) extends ConfigServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        app.injector.instanceOf[Configuration],
        app.injector.instanceOf[MessagesApi],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[WSClient],
        FaultyConfigTable(ownSchema, failing),
        app.injector.instanceOf[FunnelStatTable],
        app.injector.instanceOf[VersionTable],
        app.injector.instanceOf[PanoDataService],
        // Its own instance, so one test's in-flight compute or failure backoff can't answer for another's.
        SwrCache(app.injector.instanceOf[AsyncCacheApi], app.injector.instanceOf[ActorSystem]),
        app.injector.instanceOf[AssetManifestService]
      ) {
    override protected def readableSchemas(): Future[Set[String]] = schemas.getOrElse(super.readableSchemas())
    override protected def totalsNeedEveryCity: Boolean           = needEveryCity
  }

  /** A service set up like prod's unless told otherwise: any city failing fails the total. */
  private def serviceWith(
      failing: Option[String] = None,
      schemas: Option[Future[Set[String]]] = None,
      needEveryCity: Boolean = true
  ): TestConfigService = TestConfigService(failing, schemas, needEveryCity)

  private lazy val baseline = await(serviceWith().computeAggregateStats())

  "computeAggregateStats" should {
    "count exactly the cities it summed, this city included" in {
      baseline.overall.numCities mustBe baseline.byCity.size
      baseline.byCity.keySet must contain(realConfig.getCityId)
    }

    "fail, rather than report no cities, when the schema list can't be read" in {
      val service = serviceWith(schemas = Some(Future.failed(transient)))
      intercept[SQLTransientConnectionException](await(service.computeAggregateStats()))
    }

    "fail when a city's aggregate query fails" in {
      val error = intercept[RuntimeException](await(serviceWith(Some("aggregate")).computeAggregateStats()))
      error.getMessage must include(realConfig.getCityId)
    }

    "fail when a city's contributor ids fail, instead of shrinking total_users" in {
      intercept[RuntimeException](await(serviceWith(Some("contributors")).computeAggregateStats()))
    }

    "skip the failing city where totals don't need every city, as on a test server" in {
      val bundle = await(serviceWith(Some("aggregate"), needEveryCity = false).computeAggregateStats())
      bundle.byCity.keySet mustBe baseline.byCity.keySet - realConfig.getCityId
      bundle.overall.numCities mustBe baseline.overall.numCities - 1
    }
  }

  "computeAggregateStatsByDay" should {
    "fail when a city's daily query fails" in {
      val service = serviceWith(Some("dailyValidations"))
      intercept[RuntimeException](await(service.computeAggregateStatsByDay(filterLowQuality = false)))
    }
  }

  "getAggregateStatsWithCurrentCity" should {
    "answer None after the cold wait when the compute is still running, instead of holding the page" in {
      val service = serviceWith(schemas = Some(Promise[Set[String]]().future)) // Never completes.
      val started = System.nanoTime()
      await(service.getAggregateStatsWithCurrentCity()) mustBe None
      (System.nanoTime() - started).nanos must be >= ConfigService.AggregateStatsColdWait
    }

    "answer None, not fail, when nothing complete is cached and the compute fails" in {
      val service = serviceWith(schemas = Some(Future.failed(transient)))
      await(service.getAggregateStatsWithCurrentCity()) mustBe None
    }
  }
}
