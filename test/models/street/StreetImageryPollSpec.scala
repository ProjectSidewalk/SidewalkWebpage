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
 * order) and upsertFromPoll (widen-only date merge). Mutating cases run inside rolled-back transactions, leaving the
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

    // A sample point sits ON the polled street's line (distance 0), so the polled street is its nearest street and
    // an observation placed there must always be attributed.
    def onStreet(street: StreetToPoll, pointIdx: Int, capture: Option[LocalDate]): PolledPano = {
      val (lat, lng) = street.points(pointIdx)
      PolledPano(lat, lng, capture)
    }

    "insert a fresh row with the observed range and the imagery_poll source" in {
      val row = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        _      <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)), onStreet(street, 2, Some(newest)))
        )
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(oldest))
      row.map(_.newestCapture) mustBe Some(Some(newest))
      row.map(_.nPanos) mustBe Some(3)
      row.map(_.dataSource) mustBe Some("imagery_poll")
    }

    "not attribute an observation whose nearest street is not the polled street" in {
      val row = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        // ~1.1 km north of the street's midpoint: whatever street is nearest there, it isn't the polled one.
        farAway = PolledPano(street.points(1)._1 + 0.01, street.points(1)._2, Some(newest))
        _   <- streetImageryTable.upsertFromPoll(street.streetEdgeId, Seq(farAway))
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      // The poll is still recorded ("checked"), but nothing was attributable to this street.
      row.map(_.oldestCapture) mustBe Some(None)
      row.map(_.newestCapture) mustBe Some(None)
      row.map(_.nPanos) mustBe Some(0)
      row.map(_.dataSource) mustBe Some("imagery_poll")
    }

    "only widen an existing row's range, keep n_panos/data_source, and always bump updated_at" in {
      val staleStamp = OffsetDateTime.now.minusYears(1)
      val row        = runRolledBack(for {
        street <- streetImageryTable.streetsToPoll(1).map(_.head)
        _      <- streetImagery.filter(_.streetEdgeId === street.streetEdgeId).delete
        _      <- streetImagery += StreetImagery(street.streetEdgeId, Some(LocalDate.parse("2010-01-01")),
          Some(LocalDate.parse("2030-01-01")), 42, "imagery_scan", staleStamp)
        // This poll's narrower range must not shrink the stored one; a no-observation poll still bumps.
        _ <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)))
        )
        _   <- streetImageryTable.upsertFromPoll(street.streetEdgeId, Seq.empty)
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(LocalDate.parse("2010-01-01")))
      row.map(_.newestCapture) mustBe Some(Some(LocalDate.parse("2030-01-01")))
      row.map(_.nPanos) mustBe Some(42)
      row.map(_.dataSource) mustBe Some("imagery_scan")
      row.map(_.updatedAt.isAfter(staleStamp)) mustBe Some(true)
    }
  }
}
