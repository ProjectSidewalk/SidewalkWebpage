package service

import models.api.{AggregateStats, DailyLabelStat, DailyValidationStat}
import models.utils.{ConfigTable, FunnelStatTable, VersionTable}
import org.apache.pekko.stream.Materializer
import org.postgresql.util.{PSQLException, PSQLState}
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
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/**
 * The cross-city totals are complete or they are a failure, never a smaller number (#5977).
 *
 * The public totals (`/v3/api/aggregateStats`, the Leaderboard bands, `/cities`) once dropped any city whose query
 * failed and cached the shrunken sum as the real one. Each failure mode is reached here on purpose, through a
 * `ConfigTable` or schema list that fails on command, while every other query runs against the real database: a failed
 * schema list, a failed aggregate query, a failed contributor-id query, and a failed daily query must each fail the
 * compute. A schema that can't answer the queries yet is the one case left out deliberately, and it must leave the
 * totals exactly as they were without it.
 */
class AggregateStatsResilienceSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: => Future[T]): T = Await.result(f, 120.seconds)

  private given Materializer = app.injector.instanceOf[Materializer]

  private lazy val realConfig = app.injector.instanceOf[ConfigService]
  private lazy val ownSchema  = realConfig.getCitySchema(realConfig.getCityId)

  private def transient: Throwable = SQLTransientConnectionException("Connection is not available, timed out")
  private def shape: Throwable     = PSQLException("relation \"label\" does not exist", PSQLState.UNDEFINED_TABLE)

  /**
   * How one schema's queries should go wrong. `failures` is how many attempts fail before the query runs for real, so
   * 1 is a blip the retry absorbs and 2 is a failure that survives it.
   */
  private case class Fault(schema: String, query: String, error: () => Throwable, failures: Int = Int.MaxValue)

  /** A `ConfigTable` that fails one query on one schema per `fault`, and counts the attempts it made there. */
  private class FaultyConfigTable(fault: Option[Fault])
      extends ConfigTable(app.injector.instanceOf[DatabaseConfigProvider]) {
    val attempts = AtomicInteger(0)

    private def faulty[T](schema: String, query: String)(real: => DBIO[T]): DBIO[T] = fault match {
      case Some(f) if f.schema == schema && f.query == query =>
        // Counted when the action is built, which is once per attempt: the fan-out rebuilds it to retry.
        if (attempts.incrementAndGet() <= f.failures) DBIO.failed(f.error()) else real
      case _ => real
    }

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

  /** The real `ConfigService` over `table`, with the schema list optionally replaced. */
  private class TestConfigService(table: ConfigTable, schemas: Option[Future[Set[String]] => Future[Set[String]]])
      extends ConfigServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        app.injector.instanceOf[Configuration],
        app.injector.instanceOf[MessagesApi],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[WSClient],
        table,
        app.injector.instanceOf[FunnelStatTable],
        app.injector.instanceOf[VersionTable],
        app.injector.instanceOf[PanoDataService],
        app.injector.instanceOf[SwrCache],
        app.injector.instanceOf[AssetManifestService]
      ) {
    override protected def readableSchemas(): Future[Set[String]] =
      schemas.fold(super.readableSchemas())(_(super.readableSchemas()))
  }

  private def serviceWith(
      fault: Option[Fault] = None,
      schemas: Option[Future[Set[String]] => Future[Set[String]]] = None
  ): (TestConfigService, FaultyConfigTable) = {
    val table = FaultyConfigTable(fault)
    (TestConfigService(table, schemas), table)
  }

  private lazy val baseline = await(serviceWith()._1.computeAggregateStats())

  "computeAggregateStats" should {
    "count exactly the cities it summed, this city included" in {
      baseline.overall.numCities mustBe baseline.byCity.size
      baseline.byCity.keySet must contain(realConfig.getCityId)
    }

    "fail, rather than report no cities, when the schema list can't be read" in {
      val (service, _) = serviceWith(schemas = Some(_ => Future.failed(transient)))
      intercept[SQLTransientConnectionException](await(service.computeAggregateStats()))
    }

    "fail when a city's aggregate query fails past its retry" in {
      val (service, table) = serviceWith(Some(Fault(ownSchema, "aggregate", () => transient)))
      intercept[SQLTransientConnectionException](await(service.computeAggregateStats()))
      table.attempts.get mustBe 2
    }

    "fail when a city's contributor ids fail past their retry, instead of shrinking total_users" in {
      val (service, table) = serviceWith(Some(Fault(ownSchema, "contributors", () => transient)))
      intercept[SQLTransientConnectionException](await(service.computeAggregateStats()))
      table.attempts.get mustBe 2
    }

    "absorb a single failed attempt with the retry, giving the same totals" in {
      val (service, table) = serviceWith(Some(Fault(ownSchema, "contributors", () => transient, failures = 1)))
      await(service.computeAggregateStats()) mustBe baseline
      table.attempts.get mustBe 2
    }

    "fail when this city's own schema can't answer, since that means the query itself is wrong" in {
      val (service, _) = serviceWith(Some(Fault(ownSchema, "aggregate", () => shape)))
      val error        = intercept[IllegalStateException](await(service.computeAggregateStats()))
      error.getMessage must include("own schema")
    }

    "leave out another city whose schema can't answer, counting only what it summed" in {
      // A configured city whose schema isn't in this database, presented as readable so its real queries run and fail
      // the way a schema behind on evolutions does.
      val summedSchemas = baseline.byCity.keySet.map(realConfig.getCitySchema)
      val ghost         = app.injector
        .instanceOf[Configuration]
        .get[Seq[String]]("city-params.city-ids")
        .filter(_ != "staging")
        .map(realConfig.getCitySchema)
        .find(schema => !summedSchemas.contains(schema))
      assume(ghost.isDefined, "every configured city's schema is already summed in this database")

      val (service, _) = serviceWith(schemas = Some(_.map(_ + ghost.get)))
      await(service.computeAggregateStats()) mustBe baseline
    }
  }

  "computeAggregateStatsByDay" should {
    "fail when a city's daily query fails past its retry" in {
      val (service, table) = serviceWith(Some(Fault(ownSchema, "dailyValidations", () => transient)))
      intercept[SQLTransientConnectionException](await(service.computeAggregateStatsByDay(filterLowQuality = false)))
      table.attempts.get mustBe 2
    }
  }

  "getAggregateStatsWithCurrentCity" should {
    "answer None, not fail, when nothing complete is cached and the compute fails" in {
      // A fresh app's cache holds nothing under the bundle key, and nothing in this suite fills it.
      val (service, _) = serviceWith(schemas = Some(_ => Future.failed(transient)))
      await(service.getAggregateStatsWithCurrentCity()) mustBe None
    }
  }
}
