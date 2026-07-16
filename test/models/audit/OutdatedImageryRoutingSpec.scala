package models.audit

import models.street.StreetEdgePriorityTable
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Failure, Success, Try}

/**
 * DB-backed tests pinning the routing/priority contract of audit_task.outdated_imagery (#4384): an audit flagged as
 * outdated stops counting as street completion, so the street (and its region) re-opens for the user and for the
 * priority formula, while the audit row itself is preserved.
 *
 * Every mutating case runs inside a deliberately rolled-back transaction (runRolledBack), leaving the connected DB
 * untouched. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI);
 * cases cancel gracefully when the connected DB lacks the rows they need. Scheduling actors are disabled so nightly
 * jobs can't race the tests.
 */
class OutdatedImageryRoutingSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  private val auditTaskTable                = app.injector.instanceOf[AuditTaskTable]
  private val streetEdgePriorityTable       = app.injector.instanceOf[StreetEdgePriorityTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  private val auditTasks = TableQuery[AuditTaskTableDef]
  private val userStats  = TableQuery[UserStatTableDef]

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

  /** An assignable (street, region) pair: an open, non-tutorial street in a non-deleted region. */
  private lazy val someStreetRegion: Option[(Int, Int)] =
    run(auditTaskTable.nonDeletedStreetEdgeRegions.map(ser => (ser.streetEdgeId, ser.regionId)).result.headOption)

  /** A high-quality, non-excluded user, so a fresh audit counts as a "good" audit in the priority formula. */
  private lazy val goodUserId: Option[String] =
    run(userStats.filter(u => u.highQuality && !u.excluded).map(_.userId).result.headOption)

  /** A (user, region) pair where the user has a completed audit for every street in the region. */
  private lazy val completedUserRegion: Option[(String, Int)] = {
    val regionStreetCounts = auditTaskTable.nonDeletedStreetEdgeRegions
      .groupBy(_.regionId)
      .map { case (regionId, group) => (regionId, group.length) }
    val userRegionStreetCounts = auditTasks
      .filter(_.completed)
      .join(auditTaskTable.nonDeletedStreetEdgeRegions)
      .on(_.streetEdgeId === _.streetEdgeId)
      .groupBy { case (task, ser) => (task.userId, ser.regionId) }
      .map { case ((userId, regionId), group) => (userId, regionId, group.map(_._2.streetEdgeId).countDistinct) }
    run(
      userRegionStreetCounts
        .join(regionStreetCounts)
        .on(_._2 === _._1)
        .filter { case (userCounts, regionCounts) => userCounts._3 === regionCounts._2 }
        .map { case (userCounts, _) => (userCounts._1, userCounts._2) }
        .result
        .headOption
    )
  }

  private def newCompletedTask(streetEdgeId: Int, userId: String): AuditTask =
    AuditTask(0, None, userId, streetEdgeId, OffsetDateTime.now.minusHours(1), OffsetDateTime.now, completed = true,
      0.0, 0.0, startPointReversed = false, None, None, lowQuality = false, incomplete = false, stale = false,
      auditedDistanceM = None)

  private def flagTask(auditTaskId: Int): DBIO[Int] =
    auditTasks.filter(_.auditTaskId === auditTaskId).map(_.outdatedImagery).update(true)

  "outdated_imagery" should {
    "stop a completed audit from counting for per-user routing once flagged" in {
      assume(someStreetRegion.isDefined && goodUserId.isDefined)
      val (streetId, regionId) = someStreetRegion.get
      val userId               = goodUserId.get

      val (before, after) = runRolledBack(
        for {
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))

          auditedBefore    <- auditTaskTable.userHasAuditedStreet(streetId, userId)
          notAuditedBefore <- auditTaskTable.getStreetEdgeIdsNotAudited(userId, regionId)
          tasksBefore      <- auditTaskTable.selectTasksInARegion(regionId, userId)

          _ <- flagTask(taskId)

          auditedAfter    <- auditTaskTable.userHasAuditedStreet(streetId, userId)
          notAuditedAfter <- auditTaskTable.getStreetEdgeIdsNotAudited(userId, regionId)
          tasksAfter      <- auditTaskTable.selectTasksInARegion(regionId, userId)
        } yield (
          (auditedBefore, notAuditedBefore, tasksBefore.find(_.edgeId === streetId)),
          (auditedAfter, notAuditedAfter, tasksAfter.find(_.edgeId === streetId))
        )
      )

      val (auditedBefore, notAuditedBefore, taskBefore) = before
      auditedBefore mustBe true
      notAuditedBefore must not contain streetId
      taskBefore.map(_.completed) mustBe Some(true)
      taskBefore.flatMap(_.auditTaskId).isDefined mustBe true

      val (auditedAfter, notAuditedAfter, taskAfter) = after
      auditedAfter mustBe false
      notAuditedAfter must contain(streetId)
      // The street comes back as an available task, as if the user had never audited it.
      taskAfter.map(_.completed) mustBe Some(false)
      taskAfter.flatMap(_.auditTaskId) mustBe None
    }

    "return a street whose only audit is outdated to priority 1.0" in {
      assume(someStreetRegion.isDefined && goodUserId.isDefined)
      val streetId = someStreetRegion.get._1
      val userId   = goodUserId.get

      val (priorityBefore, priorityAfter) = runRolledBack(
        for {
          // Neutralize the street's pre-existing audits (rolled back afterward) so the formula's counts are fully
          // controlled: exactly one completed audit, by a high-quality user.
          _ <- auditTasks
            .filter(t => t.streetEdgeId === streetId && t.completed)
            .map(_.completed)
            .update(false)
          taskId <- auditTaskTable.insert(newCompletedTask(streetId, userId))
          before <- streetEdgePriorityTable.selectGoodBadUserCompletionCountPriority
          _      <- flagTask(taskId)
          after  <- streetEdgePriorityTable.selectGoodBadUserCompletionCountPriority
        } yield (
          before.find(_.streetEdgeId == streetId).map(_.priorityParameter),
          after.find(_.streetEdgeId == streetId).map(_.priorityParameter)
        )
      )

      // One good audit: priority = 1 / (1 + 1). Flagged outdated, the street has zero good audits, which pins its
      // priority parameter to 0 -> priority exactly 1.0, the same as a never-audited street.
      priorityBefore mustBe Some(0.5)
      priorityAfter mustBe Some(1.0)
    }

    "re-open a fully-explored region for the user once one of their audits is flagged" in {
      assume(completedUserRegion.isDefined)
      val (userId, regionId) = completedUserRegion.get

      val (regionsBefore, regionsAfter) = runRolledBack(for {
        regionsBefore <- auditTaskTable.getRegionsCompletedByUser(userId)
        // Flag every completed audit this user has on one street of the region.
        streetId <- auditTaskTable.nonDeletedStreetEdgeRegions
          .filter(_.regionId === regionId)
          .map(_.streetEdgeId)
          .result
          .head
        _ <- auditTasks
          .filter(t => t.userId === userId && t.streetEdgeId === streetId && t.completed)
          .map(_.outdatedImagery)
          .update(true)
        regionsAfter <- auditTaskTable.getRegionsCompletedByUser(userId)
      } yield (regionsBefore, regionsAfter))

      regionsBefore must contain(regionId)
      regionsAfter must not contain regionId
    }
  }
}
