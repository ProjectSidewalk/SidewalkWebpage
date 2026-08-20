package models.street

import models.audit.{AuditTask, AuditTaskTable, AuditTaskTableDef}
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.OffsetDateTime

/**
 * DB-backed tests pinning the admin imagery panel's per-street read (#4908) to the priority formula it explains.
 *
 * The panel renders `street_edge_priority.priority` alongside the audit counts the formula derives it from, and those
 * counts are re-expressed in SQL rather than reusing the Slick query, which is a standing drift risk: a change to how
 * `selectGoodBadUserCompletionCountPriority` weighs an audit would silently desynchronize the map from the routing it
 * explains. The first case is the guard -- it recomputes the formula from the panel's counts and requires the result
 * to match the Slick query's parameter for every street in the connected city.
 *
 * Mutating cases run inside a deliberately rolled-back transaction, leaving the connected DB untouched. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); cases cancel gracefully
 * when the connected DB lacks the rows they need. Scheduling actors are disabled so nightly jobs can't race the tests.
 */
class StreetPriorityAdminSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val streetEdgePriorityTable = app.injector.instanceOf[StreetEdgePriorityTable]
  private val auditTaskTable          = app.injector.instanceOf[AuditTaskTable]

  private val auditTasks   = TableQuery[AuditTaskTableDef]
  private val userStats    = TableQuery[UserStatTableDef]
  private val streetEdges  = TableQuery[StreetEdgeTableDef]
  private val streetRegion = TableQuery[StreetEdgeRegionTableDef]

  private val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]

  /** The priority formula, in the terms the panel exposes: see StreetEdgePriorityTable's ScalaDoc for the weights. */
  private def expectedParameter(fresh: Int, outdated: Int, bad: Int): Double = {
    if (fresh == 0 && outdated == 0) 1.0
    else 1.0 / (1.0 + fresh + (if (outdated > 0) 0.5 else 0.0) + 0.25 * bad)
  }

  /** An open, non-tutorial street that a region owns, i.e. one the panel is expected to return. */
  private lazy val someRoutableStreet: Option[Int] = run(
    streetEdges
      .filter(_.status === StreetEdgeStatus.Open)
      .join(streetRegion)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map(_._1.streetEdgeId)
      .result
      .headOption
  )

  private def newCompletedTask(streetEdgeId: Int, userId: String): AuditTask =
    AuditTask(0, None, userId, streetEdgeId, OffsetDateTime.now.minusHours(1), OffsetDateTime.now, completed = true,
      0.0, 0.0, startPointReversed = false, None, None, lowQuality = false, incomplete = false, stale = false,
      auditedDistanceM = None)

  "getPriorityWithInputs" should {
    "expose counts that reproduce the priority formula for every street" in {
      val (panelRows, formulaParams) = run(for {
        rows   <- streetEdgePriorityTable.getPriorityWithInputs
        params <- streetEdgePriorityTable.selectGoodBadUserCompletionCountPriority
      } yield (rows, params))
      assume(panelRows.nonEmpty)

      val paramByStreet = formulaParams.map(param => param.streetEdgeId -> param.priorityParameter).toMap
      val mismatches    = panelRows.flatMap { row =>
        val expected = expectedParameter(row.freshGoodCount, row.outdatedGoodCount, row.badCount)
        paramByStreet.get(row.streetEdgeId).filterNot(actual => math.abs(actual - expected) < 1e-9).map { actual =>
          s"street ${row.streetEdgeId}: formula says $actual, panel counts " +
            s"(${row.freshGoodCount}/${row.outdatedGoodCount}/${row.badCount}) imply $expected"
        }
      }
      mismatches mustBe empty
    }

    "count a newly flagged audit as outdated rather than current" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(1).result)
      assume(userIds.nonEmpty)
      val userId = userIds.head

      val (fresh, outdated) = runRolledBack(
        for {
          _ <- userStats.filter(_.userId === userId).map(_.highQuality).update(true)
          // Neutralize the street's pre-existing audits so the counts under test are exactly the one inserted here.
          _      <- auditTasks.filter(t => t.streetEdgeId === streetId && t.completed).map(_.completed).update(false)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          beforeRows <- streetEdgePriorityTable.getPriorityWithInputs
          _          <- auditTasks.filter(_.auditTaskId === taskId).map(_.outdatedImagery).update(true)
          afterRows  <- streetEdgePriorityTable.getPriorityWithInputs
        } yield (
          beforeRows.find(_.streetEdgeId == streetId),
          afterRows.find(_.streetEdgeId == streetId)
        )
      )

      fresh.map(row => (row.freshGoodCount, row.outdatedGoodCount)) mustBe Some((1, 0))
      outdated.map(row => (row.freshGoodCount, row.outdatedGoodCount)) mustBe Some((0, 1))
      // The panel's own re-audit definition is the app-wide one (audited, no up-to-date audit left), so it flips with
      // the flag even though the flagged audit still counts toward the street's audit history.
      fresh.map(_.outdated) mustBe Some(false)
      outdated.map(_.outdated) mustBe Some(true)
    }

    "weigh an audit by the user who did it, not by the fact it happened" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(2).result)
      assume(userIds.size >= 2)

      val row = runRolledBack(
        for {
          _ <- auditTasks
            .filter(task => task.streetEdgeId === streetId && task.completed)
            .map(_.completed)
            .update(false)
          _    <- userStats.filter(_.userId === userIds.head).map(_.highQuality).update(true)
          _    <- userStats.filter(_.userId === userIds(1)).map(_.highQuality).update(false)
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds(1)))
          rows <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      // A low-quality user's audit contributes a quarter weight, so it must land in its own bucket rather than
      // counting as coverage -- a street whose only walkers were flagged still needs a real audit.
      row.map(r => (r.freshGoodCount, r.outdatedGoodCount, r.badCount)) mustBe Some((1, 0, 1))
    }

    "count an incomplete or low-quality audit as a weak one, whoever did it" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(1).result)
      assume(userIds.nonEmpty)

      val row = runRolledBack(
        for {
          _ <- auditTasks
            .filter(task => task.streetEdgeId === streetId && task.completed)
            .map(_.completed)
            .update(false)
          _      <- userStats.filter(_.userId === userIds.head).map(_.highQuality).update(true)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          _      <- auditTasks.filter(_.auditTaskId === taskId).map(_.incomplete).update(true)
          rows   <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      row.map(r => (r.freshGoodCount, r.badCount)) mustBe Some((0, 1))
    }

    "ignore an excluded user's audits entirely, rather than weighing them lightly" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(1).result)
      assume(userIds.nonEmpty)

      val row = runRolledBack(
        for {
          _ <- auditTasks
            .filter(task => task.streetEdgeId === streetId && task.completed)
            .map(_.completed)
            .update(false)
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          _    <- userStats.filter(_.userId === userIds.head).map(_.excluded).update(true)
          rows <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      // Excluded accounts are removed from the record rather than discounted, which is what the priority formula
      // does; counting them as bad audits would keep lowering a street's priority for work that was thrown away.
      row.map(r => (r.freshGoodCount, r.outdatedGoodCount, r.badCount)) mustBe Some((0, 0, 0))
    }

    "collapse one user's repeat audits of a street, the way the priority formula does" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(1).result)
      assume(userIds.nonEmpty)

      val row = runRolledBack(
        for {
          _ <- auditTasks
            .filter(task => task.streetEdgeId === streetId && task.completed)
            .map(_.completed)
            .update(false)
          _    <- userStats.filter(_.userId === userIds.head).map(_.highQuality).update(true)
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          _    <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head))
          rows <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      // The formula groups by (street, user, flags) before counting, so one person walking a street three times is
      // one audit's worth of coverage. Counting three would drop the street off the queue on one labeler's word.
      row.map(_.freshGoodCount) mustBe Some(1)
    }

    "report the most recent completed audit, including one flagged for a re-audit" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get
      val userIds  = run(userStats.filterNot(_.excluded).map(_.userId).take(1).result)
      assume(userIds.nonEmpty)
      val newest = OffsetDateTime.now

      val row = runRolledBack(
        for {
          _ <- auditTasks
            .filter(task => task.streetEdgeId === streetId && task.completed)
            .map(_.completed)
            .update(false)
          _ <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head).copy(taskEnd = newest.minusDays(400)))
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userIds.head).copy(taskEnd = newest))
          _      <- auditTasks.filter(_.auditTaskId === taskId).map(_.outdatedImagery).update(true)
          rows   <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      // The date answers "when was this street last walked", which a flagged audit answers as well as any other --
      // the flag says the imagery moved on, not that the visit never happened.
      row.flatMap(_.lastAuditDate) mustBe Some(newest.atZoneSameInstant(java.time.ZoneOffset.UTC).toLocalDate)
    }

    "read a street with no stored priority as the highest, not as the lowest" in {
      assume(someRoutableStreet.isDefined)
      val streetId = someRoutableStreet.get

      val row = runRolledBack(
        for {
          _    <- streetEdgePriorities.filter(_.streetEdgeId === streetId).delete
          rows <- streetEdgePriorityTable.getPriorityWithInputs
        } yield rows.find(_.streetEdgeId == streetId)
      )

      // A missing row means the recalculation has never reached this street, which is the state a brand-new street
      // is in; defaulting to 0 would bury it at the bottom of the queue forever.
      row.map(_.priority) mustBe Some(1.0)
    }

    "return only streets Explore can route to" in {
      val rows     = run(streetEdgePriorityTable.getPriorityWithInputs)
      val tutorial = run(sql"SELECT tutorial_street_edge_id FROM config".as[Int].head)
      val nonOpen  = run(streetEdges.filterNot(_.status === StreetEdgeStatus.Open).map(_.streetEdgeId).result).toSet
      assume(rows.nonEmpty)

      rows.map(_.streetEdgeId) must not contain tutorial
      rows.map(_.streetEdgeId).filter(nonOpen.contains) mustBe empty
      rows.map(_.streetEdgeId).distinct.size mustBe rows.size
      all(rows.map(_.lengthMeters)) must be > 0.0
      all(rows.map(_.priority)) must be <= 1.0
    }
  }
}
