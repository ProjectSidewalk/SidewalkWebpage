package models.street

import models.audit.{AuditTask, AuditTaskTableDef}
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
 * DB-backed tests for the imagery-age poller's table methods (#4384): StreetImageryTable.streetsToPoll (rotation
 * order) and upsertFromPoll (widen-only date merge). Mutating cases run inside rolled-back transactions, leaving the
 * connected DB untouched; requires Postgres+PostGIS like the other DB-backed specs. Actors are disabled.
 */
class StreetImageryPollSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  private val streetImageryTable            = app.injector.instanceOf[StreetImageryTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val configTable   = TableQuery[ConfigTableDef]
  private val userStats     = TableQuery[UserStatTableDef]

  /** Sentinel used to abort (and thus roll back) the wrapping transaction after the test body has run. */
  private object RollbackSentinel extends RuntimeException("intentional rollback -- leave the DB untouched")

  /** Runs a test body inside a transaction that is always rolled back; see OutdatedImageryFlagSyncSpec. */
  private def runRolledBack[T](action: DBIO[T]): T = {
    var result: Option[T] = None
    val tx                = action.flatMap { r => result = Some(r); DBIO.failed(RollbackSentinel) }.transactionally
    Try(run(tx)) match {
      case Failure(RollbackSentinel) => result.get
      case Failure(other)            => throw other
      case Success(_)                => throw new IllegalStateException("rollback sentinel did not propagate")
    }
  }

  private lazy val tutorialStreetId: Int      = run(configTable.map(_.tutorialStreetEdgeID).result.head)
  private lazy val someUserId: Option[String] = run(userStats.map(_.userId).result.headOption)

  "streetsToPoll" should {
    "return open non-tutorial streets with three sample points each, respecting the limit" in {
      val streets = run(streetImageryTable.streetsToPoll(10))
      streets.size must be <= 10
      streets.foreach { s =>
        s.streetEdgeId must not equal tutorialStreetId
        s.points.size mustBe 3
        s.points.foreach { case (lat, lng) =>
          lat must (be >= -90.0 and be <= 90.0)
          lng must (be >= -180.0 and be <= 180.0)
        }
      }
    }

    "put a street with no street_imagery row ahead of freshly-polled streets, and audited ahead of unaudited" in {
      assume(someUserId.isDefined)
      val (first, freshlyPolledLast) = runRolledBack(for {
        candidates <- streetImageryTable.streetsToPoll(3).map(_.map(_.streetEdgeId))
        target = candidates.head
        // Make the target street audited with NO imagery row, and give every other candidate a just-polled row.
        _ <- auditTasks += AuditTask(0, None, someUserId.get, target, OffsetDateTime.now.minusHours(1),
          OffsetDateTime.now, completed = true, 0.0, 0.0, startPointReversed = false, None, None, lowQuality = false,
          incomplete = false, stale = false, auditedDistanceM = None)
        _ <- streetImagery.filter(_.streetEdgeId === target).delete
        _ <- DBIO.sequence(candidates.tail.map { id =>
          streetImagery.filter(_.streetEdgeId === id).delete andThen
            (streetImagery += StreetImagery(id, None, None, 0, "imagery_poll", OffsetDateTime.now))
        })
        reordered <- streetImageryTable.streetsToPoll(1000).map(_.map(_.streetEdgeId))
      } yield (reordered.headOption.contains(target), reordered.indexOf(candidates.tail.headOption.getOrElse(-1))))

      first mustBe true
      // The just-polled unaudited streets fall to the back of the rotation (or out of a bounded batch entirely).
      freshlyPolledLast must not be 0
    }
  }

  "upsertFromPoll" should {
    val newest = LocalDate.parse("2025-05-01")
    val oldest = LocalDate.parse("2015-05-01")

    "insert a fresh row with the observed range and the imagery_poll source" in {
      val row = runRolledBack(for {
        streetId <- streetImageryTable.streetsToPoll(1).map(_.head.streetEdgeId)
        _        <- streetImagery.filter(_.streetEdgeId === streetId).delete
        _        <- streetImageryTable.upsertFromPoll(streetId, Some(oldest), Some(newest), 3)
        row      <- streetImageryTable.getForStreet(streetId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(oldest))
      row.map(_.newestCapture) mustBe Some(Some(newest))
      row.map(_.nPanos) mustBe Some(3)
      row.map(_.dataSource) mustBe Some("imagery_poll")
    }

    "only widen an existing row's range, keep n_panos/data_source, and always bump updated_at" in {
      val staleStamp = OffsetDateTime.now.minusYears(1)
      val row        = runRolledBack(for {
        streetId <- streetImageryTable.streetsToPoll(1).map(_.head.streetEdgeId)
        _        <- streetImagery.filter(_.streetEdgeId === streetId).delete
        _        <- streetImagery += StreetImagery(streetId, Some(LocalDate.parse("2010-01-01")),
          Some(LocalDate.parse("2030-01-01")), 42, "imagery_scan", staleStamp)
        // This poll's narrower range must not shrink the stored one; a no-imagery poll (None, None, 0) still bumps.
        _   <- streetImageryTable.upsertFromPoll(streetId, Some(oldest), Some(newest), 1)
        _   <- streetImageryTable.upsertFromPoll(streetId, None, None, 0)
        row <- streetImageryTable.getForStreet(streetId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(LocalDate.parse("2010-01-01")))
      row.map(_.newestCapture) mustBe Some(Some(LocalDate.parse("2030-01-01")))
      row.map(_.nPanos) mustBe Some(42)
      row.map(_.dataSource) mustBe Some("imagery_scan")
      row.map(_.updatedAt.isAfter(staleStamp)) mustBe Some(true)
    }
  }
}
