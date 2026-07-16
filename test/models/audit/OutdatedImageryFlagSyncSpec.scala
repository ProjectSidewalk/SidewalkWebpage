package models.audit

import models.label.{Label, LabelTableDef}
import models.pano.{PanoData, PanoDataTable, PanoSource}
import models.street.{StreetEdgeTableDef, StreetImagery, StreetImageryTable, StreetImageryTableDef}
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile.api._
import models.utils.{ConfigTableDef, MyPostgresProfile}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.time.{LocalDate, OffsetDateTime}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Failure, Success, Try}

/**
 * DB-backed tests for the nightly imagery-freshness sync (#4384): AuditTaskTable.syncOutdatedImageryFlags and
 * StreetImageryTable.refreshFromPanoData, the two DBIO steps composed by ImageryFreshnessService.
 *
 * Every mutating case runs inside a deliberately rolled-back transaction (runRolledBack), so the connected DB is left
 * byte-for-byte untouched -- important because the sync's set-pass operates on the whole audit_task table, not just
 * this spec's synthetic rows. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD,
 * as in dev/CI); cases cancel gracefully when the connected DB lacks the rows they need (a user, a street, a label).
 * Scheduling actors are disabled so the real nightly sync can't race the tests.
 */
class OutdatedImageryFlagSyncSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  private val auditTaskTable                = app.injector.instanceOf[AuditTaskTable]
  private val streetImageryTable            = app.injector.instanceOf[StreetImageryTable]
  private val panoDataTable                 = app.injector.instanceOf[PanoDataTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val labels        = TableQuery[LabelTableDef]
  private val streetEdges   = TableQuery[StreetEdgeTableDef]
  private val configTable   = TableQuery[ConfigTableDef]
  private val userStats     = TableQuery[UserStatTableDef]

  /** Sentinel used to abort (and thus roll back) the wrapping transaction after the test body has run. */
  private object RollbackSentinel extends RuntimeException("intentional rollback -- leave the DB untouched")

  /**
   * Runs a test body (a composed DBIO) inside a transaction that is always rolled back.
   *
   * The body's result is captured before the sentinel failure aborts the transaction, so assertions can run either
   * inside the DBIO (a failed assertion propagates instead of the sentinel) or on the returned value.
   */
  private def runRolledBack[T](action: DBIO[T]): T = {
    var result: Option[T] = None
    val tx                = action.flatMap { r => result = Some(r); DBIO.failed(RollbackSentinel) }.transactionally
    Try(run(tx)) match {
      case Failure(RollbackSentinel) => result.get
      case Failure(other)            => throw other
      case Success(_)                => throw new IllegalStateException("rollback sentinel did not propagate")
    }
  }

  private lazy val tutorialStreetId: Int        = run(configTable.map(_.tutorialStreetEdgeID).result.head)
  private lazy val someUserId: Option[String]   = run(userStats.map(_.userId).result.headOption)
  private lazy val nonTutorialStreets: Seq[Int] =
    run(streetEdges.filter(_.streetEdgeId =!= tutorialStreetId).map(_.streetEdgeId).take(2).result)
  private lazy val someLabel: Option[Label] = run(labels.result.headOption)

  /** A non-tutorial street with no labels at all, so refreshFromPanoData sees only this spec's synthetic pano. */
  private lazy val labelFreeStreetId: Option[Int] = run(
    streetEdges
      .filter(_.streetEdgeId =!= tutorialStreetId)
      .filterNot(_.streetEdgeId in labels.map(_.streetEdgeId))
      .map(_.streetEdgeId)
      .result
      .headOption
  )

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

    "create a street's imagery row from a recently-labeled pano" in {
      assume(someLabel.isDefined && labelFreeStreetId.isDefined)
      val streetId = labelFreeStreetId.get

      val row = runRolledBack(for {
        _ <- panoDataTable.insert(
          PanoData(testPanoId, None, None, None, None, "2024-06", None, None, None, None, None, None, expired = false,
            OffsetDateTime.now, None, OffsetDateTime.now, PanoSource.Gsv, None, None)
        )
        _ <- labels += someLabel.get.copy(
          labelId = 0,
          panoId = testPanoId,
          streetEdgeId = streetId,
          timeCreated = OffsetDateTime.now,
          deleted = false,
          tutorial = false,
          temporaryLabelId = Int.MaxValue - 4384
        )
        _   <- streetImagery.filter(_.streetEdgeId === streetId).delete
        _   <- streetImageryTable.refreshFromPanoData
        row <- streetImageryTable.getForStreet(streetId)
      } yield row)

      row.isDefined mustBe true
      // The month-precision "2024-06" capture date standardizes to the 1st.
      row.get.newestCapture mustBe Some(LocalDate.parse("2024-06-01"))
      row.get.oldestCapture mustBe Some(LocalDate.parse("2024-06-01"))
      row.get.dataSource mustBe "pano_data"
    }

    "only widen the capture-date range on conflict, leaving n_panos and data_source alone" in {
      assume(someLabel.isDefined && labelFreeStreetId.isDefined)
      val streetId   = labelFreeStreetId.get
      val staleStamp = OffsetDateTime.now.minusYears(1)

      val row = runRolledBack(for {
        _ <- panoDataTable.insert(
          PanoData(testPanoId, None, None, None, None, "2024-06", None, None, None, None, None, None, expired = false,
            OffsetDateTime.now, None, OffsetDateTime.now, PanoSource.Gsv, None, None)
        )
        _ <- labels += someLabel.get.copy(
          labelId = 0,
          panoId = testPanoId,
          streetEdgeId = streetId,
          timeCreated = OffsetDateTime.now,
          deleted = false,
          tutorial = false,
          temporaryLabelId = Int.MaxValue - 4384
        )
        // Pre-existing scan row with a wider date range and a richer pano count than the labeled pano provides.
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
