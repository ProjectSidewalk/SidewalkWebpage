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
 * DB-backed contract test for the street status-change log (#4928, evolution 358), the trend it feeds, and the
 * admin reopen action that is the log's one in-app writer (#4929).
 *
 * The cases here pin what makes the record trustworthy: only real transitions are storable, the weekly rollup counts
 * each street once no matter how often it moved, and a reopen leaves the street fully routable again -- status,
 * change row, priority row, retired candidate, and invalidated completion cache all in one transaction.
 *
 * Seeds its own transitions against a real street and removes them afterwards. Requires a Postgres+PostGIS database
 * (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors are disabled.
 */
class StreetLifecycleServiceSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val statusChangeTable      = app.injector.instanceOf[StreetEdgeStatusChangeTable]
  private val streetLifecycleService = app.injector.instanceOf[StreetLifecycleService]
  private val regionService          = app.injector.instanceOf[RegionService]
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

  private val panoId = "test-4947-trend-payload"

  /** A pano and one crossing in each direction, so the imagery series has both counts to report. */
  private def seedImageryChanges(changedAt: OffsetDateTime): Unit = {
    run(sqlu"""INSERT INTO pano_data (pano_id, capture_date, expired, last_viewed, last_checked, source)
               VALUES ($panoId, '2020-06', FALSE, $changedAt, $changedAt, 'gsv'::pano_source)
               ON CONFLICT (pano_id) DO NOTHING""")
    val _ = run(sqlu"""INSERT INTO pano_imagery_change (pano_id, expired, changed_at, source)
                       VALUES ($panoId, TRUE, $changedAt, 'provider_check'::pano_imagery_change_source),
                              ($panoId, FALSE, $changedAt, 'provider_check'::pano_imagery_change_source)""")
  }

  private def cleanUpPano(): Unit = {
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
  }

  override def beforeAll(): Unit = { super.beforeAll(); cleanUp(); cleanUpPano() }
  override def afterAll(): Unit  = { cleanUp(); cleanUpPano(); super.afterAll() }

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
      Seq("status_changes", "no_imagery_reports", "pano_imagery_changes", "top_report_regions", "corroborated_streets",
        "reopen_candidates").foreach(key => (json \ key).asOpt[play.api.libs.json.JsArray] mustBe defined)
      (json \ "panos_expired_undated").as[Int] must be >= 0
      // The window start is what the client steps its week grid from, so it has to stay an ISO string rather than
      // whatever a serializer's default for a timestamp happens to be.
      (json \ "since").as[String] must startWith(trend.since.toLocalDate.toString)
    }

    "name each series row's fields in snake_case" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to attach a status change to")
      cleanUp()
      seedChange(StreetEdgeStatus.Open, StreetEdgeStatus.NoImagery, OffsetDateTime.now)
      // Straight through the service so the cached payload is the one being checked; the window is its own key.
      val trend = Await.result(streetLifecycleService.getStreetStatusTrend(3), 120.seconds)

      val rows = (Json.toJson(trend) \ "status_changes").as[play.api.libs.json.JsArray].value
      rows.size must be >= 1
      val first = rows.head
      (first \ "week_start").as[String] must fullyMatch regex """\d{4}-\d{2}-\d{2}"""
      (first \ "new_status").asOpt[String] mustBe defined
      (first \ "street_count").as[Int] must be >= 1
    }

    "report both directions of the imagery series under the names the chart reads" in {
      cleanUpPano()
      seedImageryChanges(OffsetDateTime.now)
      // Its own window so the assertion reads the payload it seeded rather than one cached by an earlier case.
      val trend = Await.result(streetLifecycleService.getStreetStatusTrend(5), 120.seconds)

      val rows = (Json.toJson(trend) \ "pano_imagery_changes").as[play.api.libs.json.JsArray].value
      rows.size must be >= 1
      // The client indexes these by name and silently draws zeros on a miss, so a rename shows up as an empty chart.
      rows.map(row => (row \ "expired_count").as[Int]).sum must be >= 1
      rows.map(row => (row \ "returned_count").as[Int]).sum must be >= 1
      (rows.head \ "week_start").as[String] must fullyMatch regex """\d{4}-\d{2}-\d{2}"""
    }

    "start the window on a Monday so the oldest bucket is a whole week" in {
      val trend = Await.result(streetLifecycleService.getStreetStatusTrend(4), 120.seconds)
      trend.since.getDayOfWeek mustBe java.time.DayOfWeek.MONDAY
    }

    "list the regained-imagery queue's rows in snake_case with their evidence fields" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to queue")
      val streetId = streetEdgeId.get
      val original =
        run(sql"SELECT status::text FROM street_edge WHERE street_edge_id = $streetId".as[String].head)
      try {
        run(sqlu"UPDATE street_edge SET status = 'no_imagery' WHERE street_edge_id = $streetId")
        run(sqlu"""INSERT INTO street_reopen_candidate (street_edge_id, n_panos, newest_capture)
                   VALUES ($streetId, 3, '2025-06-01') ON CONFLICT (street_edge_id) DO NOTHING""")
        // Its own window so the assertion can't read a payload cached by an earlier case.
        val trend = Await.result(streetLifecycleService.getStreetStatusTrend(7), 120.seconds)

        val rows = (Json.toJson(trend) \ "reopen_candidates").as[play.api.libs.json.JsArray].value
        val row  = rows.find(r => (r \ "street_edge_id").as[Int] == streetId)
        // The street may sit in a deleted region in some seeds; the queue join legitimately drops it then.
        row.foreach { r =>
          (r \ "n_panos").as[Int] mustBe 3
          (r \ "newest_capture").as[String] mustBe "2025-06-01"
          (r \ "region_name").as[String] must not be empty
          (r \ "last_detected_at").asOpt[String] mustBe defined
        }
      } finally {
        run(sqlu"DELETE FROM street_reopen_candidate WHERE street_edge_id = $streetId")
        val _ =
          run(sqlu"UPDATE street_edge SET status = ${original}::street_edge_status WHERE street_edge_id = $streetId")
      }
    }

    "stamp the window start with the offset that date actually had, not today's" in {
      // A window reaching back across a daylight-saving change starts on a Monday whose offset differs from today's.
      // Taking today's would place the cutoff late on the preceding Sunday, pulling in rows Postgres then buckets
      // under a week the client never draws — so they vanish from the charts with nothing to explain the gap.
      val trend    = Await.result(streetLifecycleService.getStreetStatusTrend(52), 120.seconds)
      val expected = java.time.ZoneId.systemDefault.getRules.getOffset(trend.since.toLocalDateTime)
      trend.since.getOffset mustBe expected
      trend.since.toLocalTime mustBe java.time.LocalTime.MIDNIGHT
    }
  }

  "reopenStreet" should {
    "flip a no_imagery street back to open with its change row, priority, and caches all handled" in {
      // An ordinary open street with a routing weight, retired the way mark_streets_no_imagery retires one.
      val picked = run(sql"""
        SELECT street_edge.street_edge_id, street_edge_priority.priority
        FROM street_edge
        JOIN street_edge_priority ON street_edge.street_edge_id = street_edge_priority.street_edge_id
        WHERE street_edge.status = 'open'
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        ORDER BY street_edge.street_edge_id
        LIMIT 1""".as[(Int, Double)].headOption)
      assume(picked.isDefined, "no open street with a priority row in the connected database")
      val (streetId, originalPriority) = picked.get

      try {
        run(sqlu"UPDATE street_edge SET status = 'no_imagery' WHERE street_edge_id = $streetId")
        run(sqlu"DELETE FROM street_edge_priority WHERE street_edge_id = $streetId")
        run(sqlu"INSERT INTO street_reopen_candidate (street_edge_id, n_panos) VALUES ($streetId, 2)")

        Await.result(streetLifecycleService.reopenStreet(streetId), 120.seconds) mustBe
          StreetLifecycleService.Reopened

        run(sql"SELECT status::text FROM street_edge WHERE street_edge_id = $streetId".as[String].head) mustBe "open"
        run(sql"""SELECT COUNT(*) FROM street_edge_status_change
                  WHERE street_edge_id = $streetId AND old_status = 'no_imagery' AND new_status = 'open'
                      AND source = 'admin_reopen'""".as[Int].head) mustBe 1
        // Without this row the street would be open yet unroutable: task selection INNER JOINs on priority, and the
        // nightly recalc only ever updates rows that exist.
        run(sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = $streetId".as[Double].head) mustBe 1.0
        run(sql"SELECT COUNT(*) FROM street_reopen_candidate WHERE street_edge_id = $streetId".as[Int].head) mustBe 0
        // The completion cache must not survive the reopen: the street's region now has more total distance.
        run(sql"SELECT COUNT(*) FROM region_completion".as[Int].head) mustBe 0
      } finally {
        run(sqlu"DELETE FROM street_edge_status_change WHERE street_edge_id = $streetId AND source = 'admin_reopen'")
        run(sqlu"DELETE FROM street_reopen_candidate WHERE street_edge_id = $streetId")
        run(sqlu"UPDATE street_edge SET status = 'open' WHERE street_edge_id = $streetId")
        run(sqlu"""INSERT INTO street_edge_priority (street_edge_id, priority)
                   VALUES ($streetId, $originalPriority)
                   ON CONFLICT (street_edge_id) DO UPDATE SET priority = EXCLUDED.priority""")
        // Refill the completion cache so later suites that assume a populated one aren't cancelled.
        val _ = Await.result(regionService.initializeRegionCompletionTable, 120.seconds)
      }
    }

    "refuse a street that isn't retired, naming its current status, and change nothing" in {
      val openStreet = run(
        sql"SELECT street_edge_id FROM street_edge WHERE status = 'open' ORDER BY street_edge_id LIMIT 1"
          .as[Int]
          .headOption
      )
      assume(openStreet.isDefined, "no open street in the connected database")
      Await.result(streetLifecycleService.reopenStreet(openStreet.get), 120.seconds) mustBe
        StreetLifecycleService.NotNoImagery("open")
      run(sql"""SELECT COUNT(*) FROM street_edge_status_change
                WHERE street_edge_id = ${openStreet.get} AND source = 'admin_reopen'""".as[Int].head) mustBe 0
    }

    "answer StreetNotFound for an id that doesn't exist" in {
      Await.result(streetLifecycleService.reopenStreet(Int.MaxValue), 120.seconds) mustBe
        StreetLifecycleService.StreetNotFound
    }
  }

  "dismissReopenCandidate" should {
    "delete the candidate row, and stay idempotent when there is nothing to delete" in {
      assume(streetEdgeId.isDefined, "no streets in the connected database to queue")
      val streetId = streetEdgeId.get
      run(sqlu"""INSERT INTO street_reopen_candidate (street_edge_id, n_panos)
                 VALUES ($streetId, 1) ON CONFLICT (street_edge_id) DO NOTHING""")
      try {
        Await.result(streetLifecycleService.dismissReopenCandidate(streetId), 120.seconds) mustBe 1
        Await.result(streetLifecycleService.dismissReopenCandidate(streetId), 120.seconds) mustBe 0
      } finally {
        val _ = run(sqlu"DELETE FROM street_reopen_candidate WHERE street_edge_id = $streetId")
      }
    }
  }
}
