package models.street

import models.audit.{AuditTask, AuditTaskTableDef}
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
 * DB-backed tests for the imagery-age poller's table methods (#4384): StreetImageryTable.streetsToPoll (rotation
 * order) and upsertFromPoll (widen-only date range, per-point median snapshot). Mutating cases run inside
 * rolled-back transactions, leaving the
 * connected DB untouched; requires Postgres+PostGIS like the other DB-backed specs. Actors are disabled.
 */
class StreetImageryPollSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val streetImageryTable = app.injector.instanceOf[StreetImageryTable]

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val configTable   = TableQuery[ConfigTableDef]
  private val userStats     = TableQuery[UserStatTableDef]

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
            (streetImagery += StreetImagery(id, None, None, None, 0, StreetImagerySource.ImageryPoll,
              OffsetDateTime.now))
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

    // A sample point sits ON the polled street's line (distance 0), so the polled street is its nearest street and
    // an observation placed there must always be attributed.
    def onStreet(street: StreetToPoll, pointIdx: Int, capture: Option[LocalDate]): PolledPano = {
      val (lat, lng) = street.points(pointIdx)
      PolledPano(lat, lng, capture, pointIdx)
    }

    "insert a fresh row with the observed range, per-point median, and the imagery_poll source" in {
      val row = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        _      <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)), onStreet(street, 2, Some(newest)))
        )
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(oldest))
      row.map(_.newestCapture) mustBe Some(Some(newest))
      // Per-point newest captures are (oldest, newest, newest): two of the three points reach `newest`.
      row.map(_.medianNewestCapture) mustBe Some(Some(newest))
      row.map(_.nPanos) mustBe Some(3)
      row.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryPoll)
    }

    "leave the median NULL when fewer than half the sampled points have dated imagery" in {
      val (oneDated, sharedPano) = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        // Only 1 of 3 points shows dated imagery: no "half the street" claim can be made.
        _        <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq(onStreet(street, 0, Some(newest))))
        oneDated <- streetImageryTable.getForStreet(street.streetEdgeId)
        // The same pano (same position) genuinely visible from points 0 and 1 informs both points, so the median
        // exists -- while n_panos still counts it once.
        sharedAtPoint0 = onStreet(street, 0, Some(newest))
        _ <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(sharedAtPoint0, sharedAtPoint0.copy(pointIndex = 1))
        )
        sharedPano <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield (oneDated, sharedPano))

      oneDated.map(_.medianNewestCapture) mustBe Some(None)
      sharedPano.map(_.medianNewestCapture) mustBe Some(Some(newest))
      sharedPano.map(_.nPanos) mustBe Some(1)
    }

    "not attribute an observation whose nearest street is not the polled street" in {
      val row = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        // ~1.1 km north of the street's midpoint: whatever street is nearest there, it isn't the polled one.
        farAway = PolledPano(street.points(1)._1 + 0.01, street.points(1)._2, Some(newest), 1)
        _   <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq(farAway))
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      // The poll is still recorded ("checked"), but nothing was attributable to this street.
      row.map(_.oldestCapture) mustBe Some(None)
      row.map(_.newestCapture) mustBe Some(None)
      row.map(_.medianNewestCapture) mustBe Some(None)
      row.map(_.nPanos) mustBe Some(0)
      row.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryPoll)
    }

    "widen the range, replace the median (NULL on an empty poll), keep n_panos/data_source, and bump updated_at" in {
      val staleStamp                 = OffsetDateTime.now.minusYears(1)
      val (afterDatedPoll, finalRow) = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        _      <- streetImagery += StreetImagery(street.streetEdgeId, Some(LocalDate.parse("2010-01-01")),
          Some(LocalDate.parse("2030-01-01")), None, 42, StreetImagerySource.ImageryScan, staleStamp)
        // This poll's narrower range must not shrink the stored one. Its median (2 of 3 points dated -> the older
        // of the two per-point captures) is a snapshot, not a widen.
        _ <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)))
        )
        afterDatedPoll <- streetImageryTable.getForStreet(street.streetEdgeId)
        // A later conclusive poll that sees nothing attributable NULLs the median again -- its honest snapshot.
        _        <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq.empty)
        finalRow <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield (afterDatedPoll, finalRow))

      afterDatedPoll.map(_.medianNewestCapture) mustBe Some(Some(oldest))
      finalRow.map(_.oldestCapture) mustBe Some(Some(LocalDate.parse("2010-01-01")))
      finalRow.map(_.newestCapture) mustBe Some(Some(LocalDate.parse("2030-01-01")))
      finalRow.map(_.medianNewestCapture) mustBe Some(None)
      finalRow.map(_.nPanos) mustBe Some(42)
      finalRow.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryScan)
      finalRow.map(_.updatedAt.isAfter(staleStamp)) mustBe Some(true)
    }
  }
}
