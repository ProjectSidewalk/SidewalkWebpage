package models.audit

import models.street.{StreetImagery, StreetImagerySource, StreetImageryTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests pinning the dashboard's per-user re-audit list (#4896): the streets a mapper audited that still
 * need a re-audit because no completed audit of them -- theirs or anyone else's -- was made against the current
 * imagery (#4384). The "anyone else's" half is the load-bearing part: once another mapper refreshes the street it
 * leaves every list, so two people are never sent to the same re-audit.
 *
 * Every case seeds the rows it asserts on inside a deliberately rolled-back transaction (runRolledBack), leaving the
 * connected DB untouched. Seeding rather than hunting matters here: nothing is flagged in a fresh dev DB, so a spec
 * that looked for pre-existing flagged audits would pass vacuously. Requires a Postgres+PostGIS database
 * (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI). Scheduling actors are disabled so nightly jobs
 * can't race the tests.
 */
class OutdatedStreetsForUserSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]

  private val ListLimit = 12

  /** An assignable street: open, non-tutorial, and in a non-deleted region, so the list's joins can reach it. */
  private lazy val someStreetId: Option[Int] =
    run(auditTaskTable.nonDeletedStreetEdgeRegions.map(_.streetEdgeId).result.headOption)

  /** Two distinct users, so "someone else refreshed it" can be told apart from "you refreshed it". */
  private lazy val twoUserIds: Seq[String] =
    run(TableQuery[models.user.SidewalkUserTableDef].map(_.userId).take(2).result)

  private def newCompletedTask(streetEdgeId: Int, userId: String): AuditTask =
    AuditTask(0, None, userId, streetEdgeId, OffsetDateTime.now.minusHours(1), OffsetDateTime.now, completed = true,
      0.0, 0.0, startPointReversed = false, None, None, lowQuality = false, incomplete = false, stale = false,
      auditedDistanceM = None)

  private def flagTask(auditTaskId: Int): DBIO[Int] =
    auditTasks.filter(_.auditTaskId === auditTaskId).map(_.outdatedImagery).update(true)

  /** Clears the street's existing completed audits so each case controls the full set the queries see. */
  private def hideExistingAudits(streetEdgeId: Int): DBIO[Int] =
    auditTasks.filter(t => t.streetEdgeId === streetEdgeId && t.completed).map(_.completed).update(false)

  "getOutdatedStreetsForUser" should {
    "list a street only once the user's audit of it is flagged" in {
      assume(someStreetId.isDefined && twoUserIds.nonEmpty)
      val streetId = someStreetId.get
      val userId   = twoUserIds.head

      val (before, after) = runRolledBack(
        for {
          _      <- hideExistingAudits(streetId)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          fresh  <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
          _      <- flagTask(taskId)
          stale  <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        } yield (fresh, stale)
      )

      before.map(_.streetEdgeId) must not contain streetId
      val listed = after.find(_.streetEdgeId == streetId)
      listed mustBe defined
      listed.get.regionName must not be empty
      listed.get.distanceMeters must be > 0.0
      listed.get.lastAuditedAt mustBe defined
    }

    "drop a street once any other mapper audits it against the current imagery" in {
      assume(someStreetId.isDefined && twoUserIds.size >= 2)
      val streetId    = someStreetId.get
      val userId      = twoUserIds.head
      val otherUserId = twoUserIds(1)

      val (mine, afterTheirs) = runRolledBack(
        for {
          _      <- hideExistingAudits(streetId)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          _      <- flagTask(taskId)
          before <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
          // Another mapper redoes the street on the new imagery; the sync leaves their audit unflagged.
          _     <- auditTaskTable.insert(newCompletedTask(streetId, otherUserId))
          after <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        } yield (before, after)
      )

      mine.map(_.streetEdgeId) must contain(streetId)
      afterTheirs.map(_.streetEdgeId) must not contain streetId
    }

    "report the capture date that flagged the street, and still list it when there is none" in {
      assume(someStreetId.isDefined && twoUserIds.nonEmpty)
      val streetId = someStreetId.get
      val userId   = twoUserIds.head
      val captured = LocalDate.of(2025, 8, 1)

      val (withDate, withoutDate) = runRolledBack(
        for {
          _      <- hideExistingAudits(streetId)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          _      <- flagTask(taskId)
          _      <- streetImagery.insertOrUpdate(
            StreetImagery(streetId, None, Some(captured), Some(captured), 1, StreetImagerySource.ImageryPoll,
              OffsetDateTime.now)
          )
          dated <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
          // An empty poll clears the median while the flags it created stand until the next sync.
          _       <- streetImagery.filter(_.streetEdgeId === streetId).map(_.medianNewestCapture).update(None)
          undated <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        } yield (dated, undated)
      )

      withDate.find(_.streetEdgeId == streetId).flatMap(_.newImageryDate) mustBe Some(captured)
      withoutDate.find(_.streetEdgeId == streetId) mustBe defined
      withoutDate.find(_.streetEdgeId == streetId).flatMap(_.newImageryDate) mustBe None
    }
  }

  "countOutdatedStreetsForUser" should {
    "count every needs-re-audit street, including the ones past the list's limit" in {
      assume(someStreetId.isDefined && twoUserIds.nonEmpty)
      val userId = twoUserIds.head

      val (rows, total) = runRolledBack(
        for {
          streetIds <- auditTaskTable.nonDeletedStreetEdgeRegions.map(_.streetEdgeId).take(3).result
          _         <- DBIO.sequence(streetIds.map(hideExistingAudits))
          taskIds   <- DBIO.sequence(streetIds.map(id => auditTaskTable.insert(newCompletedTask(id, userId))))
          _         <- DBIO.sequence(taskIds.map(flagTask))
          rows      <- auditTaskTable.getOutdatedStreetsForUser(userId, 2)
          total     <- auditTaskTable.countOutdatedStreetsForUser(userId)
        } yield (rows, total)
      )

      rows.size mustBe 2
      total must be >= 3
      rows.map(_.streetEdgeId).distinct.size mustBe rows.size
    }
  }

  "getAuditedStreets" should {
    "mark a user's street as needing a re-audit without dropping it from their map" in {
      assume(someStreetId.isDefined && twoUserIds.nonEmpty)
      val streetId = someStreetId.get
      val userId   = twoUserIds.head

      val (before, after) = runRolledBack(
        for {
          _      <- hideExistingAudits(streetId)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          fresh  <- auditTaskTable.getAuditedStreets(userId)
          _      <- flagTask(taskId)
          stale  <- auditTaskTable.getAuditedStreets(userId)
        } yield (fresh, stale)
      )

      before.find(_._1.streetEdgeId == streetId).map(_._2) mustBe Some(false)
      // Still the user's street -- their work is credited either way; only the freshness flag flips.
      after.find(_._1.streetEdgeId == streetId).map(_._2) mustBe Some(true)
    }
  }
}
