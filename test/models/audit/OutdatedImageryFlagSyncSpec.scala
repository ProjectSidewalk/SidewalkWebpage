package models.audit

import models.pano.{PanoData, PanoDataTable, PanoSource}
import models.street.{StreetEdgeTableDef, StreetImagery, StreetImageryTable, StreetImageryTableDef}
import models.user.UserStatTableDef
import models.utils.ConfigTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests for the nightly imagery-freshness sync (#4384): AuditTaskTable.syncOutdatedImageryFlags and
 * StreetImageryTable.refreshFromPanoData, the two DBIO steps composed by ImageryFreshnessService.
 *
 * Every mutating case runs inside a deliberately rolled-back transaction (runRolledBack), so the connected DB is left
 * byte-for-byte untouched -- important because the sync's set-pass operates on the whole audit_task table, not just
 * this spec's synthetic rows. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD,
 * as in dev/CI); cases cancel gracefully when the connected DB lacks the rows they need (a user, a street).
 * Scheduling actors are disabled so the real nightly sync can't race the tests.
 */
class OutdatedImageryFlagSyncSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable     = app.injector.instanceOf[AuditTaskTable]
  private val streetImageryTable = app.injector.instanceOf[StreetImageryTable]
  private val panoDataTable      = app.injector.instanceOf[PanoDataTable]

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val streetEdges   = TableQuery[StreetEdgeTableDef]
  private val configTable   = TableQuery[ConfigTableDef]
  private val userStats     = TableQuery[UserStatTableDef]

  private lazy val tutorialStreetId: Int        = run(configTable.map(_.tutorialStreetEdgeID).result.head)
  private lazy val someUserId: Option[String]   = run(userStats.map(_.userId).result.headOption)
  private lazy val nonTutorialStreets: Seq[Int] =
    run(streetEdges.filter(_.streetEdgeId =!= tutorialStreetId).map(_.streetEdgeId).take(2).result)

  private def newTask(streetEdgeId: Int, userId: String, taskEnd: OffsetDateTime, completed: Boolean): AuditTask =
    AuditTask(0, None, userId, streetEdgeId, taskEnd.minusHours(1), taskEnd, completed, 0.0, 0.0,
      startPointReversed = false, None, None, lowQuality = false, incomplete = false, stale = false,
      auditedDistanceM = None)

  /** Replaces the street's imagery row (if any) with one having the given capture-date range. */
  private def setImagery(streetEdgeId: Int, newest: Option[LocalDate], oldest: Option[LocalDate]): DBIO[Int] = {
    streetImagery.filter(_.streetEdgeId === streetEdgeId).delete andThen
      (streetImagery += StreetImagery(streetEdgeId, oldest, newest, 1, "imagery_scan", OffsetDateTime.now))
  }

  private def flagOf(auditTaskId: Int): DBIO[Boolean] =
    auditTasks.filter(_.auditTaskId === auditTaskId).map(_.outdatedImagery).result.head

  "syncOutdatedImageryFlags" should {
    "flag a completed audit that ended before the street's newest imagery, and be idempotent" in {
      assume(someUserId.isDefined && nonTutorialStreets.nonEmpty)
      val (userId, streetId) = (someUserId.get, nonTutorialStreets.head)

      val (flag, secondRunCounts) = runRolledBack(for {
        taskId <- auditTaskTable.insert(
          newTask(streetId, userId, OffsetDateTime.parse("2020-01-15T12:00:00Z"), completed = true)
        )
        _    <- setImagery(streetId, Some(LocalDate.parse("2024-06-01")), Some(LocalDate.parse("2019-01-01")))
        _    <- auditTaskTable.syncOutdatedImageryFlags
        flag <- flagOf(taskId)
        // A second pass right after the first must find nothing left to change, in either direction.
        secondRun <- auditTaskTable.syncOutdatedImageryFlags
      } yield (flag, secondRun))

      flag mustBe true
      secondRunCounts mustBe ((0, 0))
    }

    "not flag audits at or after the newest capture, incomplete audits, or streets without imagery data" in {
      assume(someUserId.isDefined && nonTutorialStreets.size >= 2)
      val userId             = someUserId.get
      val (streetA, streetB) = (nonTutorialStreets.head, nonTutorialStreets(1))
      val newest             = LocalDate.parse("2024-06-01")

      val flags = runRolledBack(for {
        _ <- setImagery(streetA, Some(newest), Some(newest))
        // street B has no street_imagery row at all.
        _         <- streetImagery.filter(_.streetEdgeId === streetB).delete
        sameDayId <- auditTaskTable.insert(
          newTask(streetA, userId, OffsetDateTime.parse("2024-06-01T09:00:00Z"), completed = true)
        )
        afterId <- auditTaskTable.insert(
          newTask(streetA, userId, OffsetDateTime.parse("2025-03-03T09:00:00Z"), completed = true)
        )
        incompleteId <- auditTaskTable.insert(
          newTask(streetA, userId, OffsetDateTime.parse("2020-01-15T09:00:00Z"), completed = false)
        )
        noRowId <- auditTaskTable.insert(
          newTask(streetB, userId, OffsetDateTime.parse("2020-01-15T09:00:00Z"), completed = true)
        )
        _      <- auditTaskTable.syncOutdatedImageryFlags
        flags1 <- DBIO.sequence(Seq(sameDayId, afterId, incompleteId, noRowId).map(flagOf))
        // A NULL newest_capture must behave like an absent row.
        _          <- setImagery(streetB, None, None)
        _          <- auditTaskTable.syncOutdatedImageryFlags
        nullNewest <- flagOf(noRowId)
      } yield flags1 :+ nullNewest)

      flags mustBe Seq(false, false, false, false, false)
    }

    "clear a flag once the street's imagery data fails the outdated test" in {
      assume(someUserId.isDefined && nonTutorialStreets.nonEmpty)
      val (userId, streetId) = (someUserId.get, nonTutorialStreets.head)

      val (flagBefore, flagAfter, unflaggedCount) = runRolledBack(for {
        taskId <- auditTaskTable.insert(
          newTask(streetId, userId, OffsetDateTime.parse("2020-01-15T12:00:00Z"), completed = true)
        )
        _          <- setImagery(streetId, Some(LocalDate.parse("2024-06-01")), None)
        _          <- auditTaskTable.syncOutdatedImageryFlags
        flagBefore <- flagOf(taskId)
        // The street's newest known imagery now predates the audit (e.g. corrected scan data).
        _         <- setImagery(streetId, Some(LocalDate.parse("2019-06-01")), None)
        counts    <- auditTaskTable.syncOutdatedImageryFlags
        flagAfter <- flagOf(taskId)
      } yield (flagBefore, flagAfter, counts._2))

      flagBefore mustBe true
      flagAfter mustBe false
      unflaggedCount must be >= 1
    }

    "ignore a future capture date, and clear a flag that a future date would otherwise pin forever" in {
      assume(someUserId.isDefined && nonTutorialStreets.nonEmpty)
      val (userId, streetId) = (someUserId.get, nonTutorialStreets.head)
      val future             = LocalDate.now.plusYears(5)

      val (flagFromBadData, flagAfterCorrection) = runRolledBack(for {
        taskId <- auditTaskTable.insert(
          newTask(streetId, userId, OffsetDateTime.parse("2020-01-15T12:00:00Z"), completed = true)
        )
        // A future capture date is bad data (a typo'd scan import, a bogus provider value), not new imagery. Since
        // every writer only widens newest_capture, flagging on it would make the street permanently un-completable:
        // each fresh re-audit would be re-flagged the same night.
        _               <- setImagery(streetId, Some(future), None)
        _               <- auditTaskTable.syncOutdatedImageryFlags
        flagFromBadData <- flagOf(taskId)
        // The clear-pass applies the same guard, so a row already flagged before the data went bad still clears.
        _         <- auditTasks.filter(_.auditTaskId === taskId).map(_.outdatedImagery).update(true)
        _         <- auditTaskTable.syncOutdatedImageryFlags
        flagAfter <- flagOf(taskId)
      } yield (flagFromBadData, flagAfter))

      flagFromBadData mustBe false
      flagAfterCorrection mustBe false
    }

    "never flag audits on the tutorial street" in {
      assume(someUserId.isDefined)
      val userId = someUserId.get

      val flag = runRolledBack(for {
        taskId <- auditTaskTable.insert(
          newTask(tutorialStreetId, userId, OffsetDateTime.parse("2020-01-15T12:00:00Z"), completed = true)
        )
        _    <- setImagery(tutorialStreetId, Some(LocalDate.parse("2024-06-01")), None)
        _    <- auditTaskTable.syncOutdatedImageryFlags
        flag <- flagOf(taskId)
      } yield flag)

      flag mustBe false
    }
  }

  "refreshFromPanoData" should {
    val testPanoId = "test-pano-4384-flag-sync-spec"

    /** Ages every real pano out of the 7-day lookback so the refresh sees only this spec's synthetic pano. */
    def ageOutRealPanos: DBIO[Int] = sqlu"UPDATE pano_data SET last_viewed = now() - interval '30 days'"

    /** (lat, lng) of the street's midpoint: on the street's own line, so this street is its nearest street. */
    def streetMidpoint(streetEdgeId: Int): DBIO[(Double, Double)] =
      sql"""
        SELECT ST_Y(ST_LineInterpolatePoint(geom, 0.5)), ST_X(ST_LineInterpolatePoint(geom, 0.5))
        FROM street_edge
        WHERE street_edge_id = $streetEdgeId
      """.as[(Double, Double)].head

    def panoAt(lat: Double, lng: Double): PanoData =
      PanoData(testPanoId, None, None, None, None, "2024-06", None, Some(lat), Some(lng), None, None, None,
        expired = false, OffsetDateTime.now, None, OffsetDateTime.now, PanoSource.Gsv, None, None)

    "create a street's imagery row from a recently-viewed pano on it" in {
      assume(nonTutorialStreets.nonEmpty)
      val streetId = nonTutorialStreets.head

      val row = runRolledBack(for {
        _        <- ageOutRealPanos
        midpoint <- streetMidpoint(streetId)
        _        <- panoDataTable.insert(panoAt(midpoint._1, midpoint._2))
        _        <- streetImagery.filter(_.streetEdgeId === streetId).delete
        _        <- streetImageryTable.refreshFromPanoData
        row      <- streetImageryTable.getForStreet(streetId)
      } yield row)

      row.isDefined mustBe true
      // The month-precision "2024-06" capture date standardizes to the 1st.
      row.get.newestCapture mustBe Some(LocalDate.parse("2024-06-01"))
      row.get.oldestCapture mustBe Some(LocalDate.parse("2024-06-01"))
      row.get.dataSource mustBe "pano_data"
    }

    "only widen the capture-date range on conflict, leaving n_panos and data_source alone" in {
      assume(nonTutorialStreets.nonEmpty)
      val streetId   = nonTutorialStreets.head
      val staleStamp = OffsetDateTime.now.minusYears(1)

      val row = runRolledBack(for {
        _        <- ageOutRealPanos
        midpoint <- streetMidpoint(streetId)
        _        <- panoDataTable.insert(panoAt(midpoint._1, midpoint._2))
        // Pre-existing scan row with a wider date range and a richer pano count than the viewed pano provides.
        _ <- streetImagery.filter(_.streetEdgeId === streetId).delete
        _ <- streetImagery += StreetImagery(streetId, Some(LocalDate.parse("2010-01-01")),
          Some(LocalDate.parse("2030-01-01")), 42, "imagery_scan", staleStamp)
        _   <- streetImageryTable.refreshFromPanoData
        row <- streetImageryTable.getForStreet(streetId)
      } yield row)

      row.get.oldestCapture mustBe Some(LocalDate.parse("2010-01-01")) // LEAST keeps the earlier scan date.
      row.get.newestCapture mustBe Some(LocalDate.parse("2030-01-01")) // GREATEST keeps the later scan date.
      row.get.nPanos mustBe 42
      row.get.dataSource mustBe "imagery_scan"
      row.get.updatedAt.isAfter(staleStamp) mustBe true
    }
  }
}
