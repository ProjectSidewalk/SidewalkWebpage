package service

import models.street.{StreetEdgeStatus, StreetEdgeStatusChangeSource, StreetEdgeStatusChangeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for the street status-change log (#4928, evolution 359) and the trend it feeds.
 *
 * `street_edge.status` has no application write path, so these rows are the only record that a maintenance script ran
 * at all. The cases here pin what makes that record trustworthy: only real transitions are storable, and the weekly
 * rollup counts each street once no matter how often it moved.
 *
 * Seeds its own transitions against a real street and removes them afterwards. Requires a Postgres+PostGIS database
 * (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors are disabled.
 */
class StreetLifecycleServiceSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val statusChangeTable      = app.injector.instanceOf[StreetEdgeStatusChangeTable]
  private val streetLifecycleService = app.injector.instanceOf[StreetLifecycleService]
  private val dbConfig               = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  /** A real street to hang the seeded transitions off, since the log carries a foreign key to street_edge. */
  private lazy val streetEdgeId: Option[Int] =
    run(sql"SELECT street_edge_id FROM street_edge ORDER BY street_edge_id LIMIT 1".as[Int].headOption)

  private def seedChange(
      oldStatus: StreetEdgeStatus.Value,
      newStatus: StreetEdgeStatus.Value,
      changedAt: OffsetDateTime
  ): Unit = {
    val streetId = streetEdgeId.get
    val _        = run(
      sqlu"""INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, changed_at, source)
               VALUES ($streetId,
                       ${oldStatus.toString}::street_edge_status,
                       ${newStatus.toString}::street_edge_status,
                       $changedAt,
                       ${StreetEdgeStatusChangeSource.HideStreetsWithoutImagery.toString}
                         ::street_edge_status_change_source)"""
    )
  }

  private def cleanUp(): Unit = streetEdgeId.foreach { streetId =>
    val _ = run(sqlu"DELETE FROM street_edge_status_change WHERE street_edge_id = $streetId")
  }

  override def beforeAll(): Unit = { super.beforeAll(); cleanUp() }
  override def afterAll(): Unit  = { cleanUp(); super.afterAll() }

  "street_edge_status_change" should {
    "refuse a row whose old and new status are the same" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to attach a status change to")
      an[Exception] must be thrownBy {
        seedChange(StreetEdgeStatus.Open, StreetEdgeStatus.Open, OffsetDateTime.now)
      }
    }

    "refuse a row for a street that does not exist" in {
      an[Exception] must be thrownBy {
        run(sqlu"""INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
                   VALUES (-1, 'open'::street_edge_status, 'closed'::street_edge_status,
                           'remove_streets'::street_edge_status_change_source)""")
      }
    }
  }

  "transitionsByWeek" should {
    "bucket transitions by week and destination status" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to attach a status change to")
      cleanUp()
      val now = OffsetDateTime.now
      seedChange(StreetEdgeStatus.Open, StreetEdgeStatus.NoImagery, now)
      seedChange(StreetEdgeStatus.NoImagery, StreetEdgeStatus.Closed, now.minusWeeks(3))

      val weeks = run(statusChangeTable.transitionsByWeek(now.minusWeeks(8)))
      weeks.filter(_.newStatus == StreetEdgeStatus.NoImagery).map(_.streetCount).sum mustBe 1
      weeks.filter(_.newStatus == StreetEdgeStatus.Closed).map(_.streetCount).sum mustBe 1
      weeks.map(_.weekStart).distinct must have size 2
    }

    "count a street once even when it moved twice into the same status in one week" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to attach a status change to")
      cleanUp()
      val now = OffsetDateTime.now
      seedChange(StreetEdgeStatus.Open, StreetEdgeStatus.NoImagery, now)
      seedChange(StreetEdgeStatus.Closed, StreetEdgeStatus.NoImagery, now)

      val weeks = run(statusChangeTable.transitionsByWeek(now.minusWeeks(2)))
      weeks.filter(_.newStatus == StreetEdgeStatus.NoImagery).map(_.streetCount).sum mustBe 1
    }

    "leave out transitions older than the window" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to attach a status change to")
      cleanUp()
      seedChange(StreetEdgeStatus.Open, StreetEdgeStatus.Closed, OffsetDateTime.now.minusWeeks(20))
      run(statusChangeTable.transitionsByWeek(OffsetDateTime.now.minusWeeks(4))) mustBe empty
    }
  }

  "StreetLifecycleService.clampWeeks" should {
    "hold a junk window inside the supported range rather than erroring" in {
      StreetLifecycleService.clampWeeks(0) mustBe StreetLifecycleService.MinTrendWeeks
      StreetLifecycleService.clampWeeks(-5) mustBe StreetLifecycleService.MinTrendWeeks
      StreetLifecycleService.clampWeeks(100000) mustBe StreetLifecycleService.MaxTrendWeeks
      StreetLifecycleService.clampWeeks(26) mustBe 26
    }
  }

  "getStreetStatusTrend" should {
    "emit every series in snake_case, with the window it actually used" in {
      val trend = Await.result(streetLifecycleService.getStreetStatusTrend(100000), 120.seconds)
      trend.weeks mustBe StreetLifecycleService.MaxTrendWeeks

      val json = Json.toJson(trend)
      (json \ "weeks").as[Int] mustBe StreetLifecycleService.MaxTrendWeeks
      (json \ "min_reporters").as[Int] mustBe StreetLifecycleService.MinCorroboratingReporters
      Seq("status_changes", "no_imagery_reports", "panos_expired", "top_report_regions", "corroborated_streets")
        .foreach(key => (json \ key).asOpt[play.api.libs.json.JsArray] mustBe defined)
      (json \ "panos_expired_undated").as[Int] must be >= 0
    }

    "start the window on a Monday so the oldest bucket is a whole week" in {
      val trend = Await.result(streetLifecycleService.getStreetStatusTrend(4), 120.seconds)
      trend.since.getDayOfWeek mustBe java.time.DayOfWeek.MONDAY
    }
  }
}
