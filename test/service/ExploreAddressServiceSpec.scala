package service

import formats.json.ExploreFormats._
import formats.json.MissionFormats._
import models.audit.AuditTaskTableDef
import models.mission.{Mission, MissionTableDef, MissionType}
import models.region.RegionCompletionTableDef
import models.street.{
  StreetEdgeIssue,
  StreetEdgeIssueTableDef,
  StreetEdgeIssueType,
  StreetEdgePriorityTableDef,
  StreetEdgeTable
}
import models.user.SidewalkUserWithRole
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.silhouette.api.util.PasswordInfo
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for the exploreAddress (address-drop-in) flow (#4451).
 *
 * The core invariant under test: a free-exploration session parents labels to a mission + audit_task that NEVER
 * complete, so street priority and region_completion.audited_distance are untouched no matter what the session does —
 * including a hostile client submitting completed=true or reporting the street as having no imagery. Also pins the
 * session lifecycle (resume returns the same mission/task), the nearest-street distance cap, the mission-type JSON
 * serialization of the new mission type, and the
 * getCurrentMissionInRegion type filter that keeps a stray incomplete mission out of the normal audit-resume path.
 *
 * Creates one throwaway anonymous user (same approach as UserAuthControllerSpec's happy path). All mission/audit_task/
 * issue rows the tests create are deleted in afterAll — mandatory, not just tidy: leftover exploreAddress missions
 * are rows this evolution's !Downs has to delete to rebuild the mission_type enum without that value, so residue turns
 * an autoApplyDowns on a shared dev DB into silent data loss for whoever else is using it. Requires Postgres+PostGIS (DATABASE_URL / DATABASE_USER /
 * DATABASE_PASSWORD, as in dev/CI); cancels gracefully if the connected DB has no streets. Scheduling actors are
 * disabled so background jobs can't race the tests.
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class ExploreAddressServiceSpec extends PlaySpec with org.scalatest.BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val exploreService  = app.injector.instanceOf[ExploreService]
  private val authService     = app.injector.instanceOf[AuthenticationService]
  private val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  private val missions         = TableQuery[MissionTableDef]
  private val auditTasks       = TableQuery[AuditTaskTableDef]
  private val priorities       = TableQuery[StreetEdgePriorityTableDef]
  private val regionCompletion = TableQuery[RegionCompletionTableDef]
  private val streetIssues     = TableQuery[StreetEdgeIssueTableDef]

  /** One throwaway anonymous user for the whole suite; its never-completing missions/tasks are inert residue. */
  private lazy val testUser: SidewalkUserWithRole = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
  }

  /** A real street start point to use as the "searched address" (whichever open street is nearest gets the task). */
  private lazy val addressLatLng: Option[(Double, Double)] =
    run(streetEdgeTable.streets.map(s => (s.y1, s.x1)).result.headOption)

  private def priorityOf(streetEdgeId: Int): Option[Double] =
    run(priorities.filter(_.streetEdgeId === streetEdgeId).map(_.priority).result.headOption)

  private def auditedDistanceOf(regionId: Int): Option[Double] =
    run(regionCompletion.filter(_.regionId === regionId).map(_.auditedDistance).result.headOption)

  /**
   * Deletes every row the suite created under the throwaway user. Mission and audit_task reference each other
   * (mission.current_audit_task_id / audit_task.current_mission_id), so the mission->task pointer is nulled first.
   * The bare user/auth rows are left behind, matching UserAuthControllerSpec's happy-path precedent.
   */
  override def afterAll(): Unit = {
    val userId = testUser.userId
    val _      = run(
      DBIO
        .seq(
          missions.filter(_.userId === userId).map(_.currentAuditTaskId).update(None),
          auditTasks.filter(_.userId === userId).delete,
          missions.filter(_.userId === userId).delete,
          streetIssues.filter(_.userId === userId).delete,
          TableQuery[models.user.UserCurrentRegionTableDef].filter(_.userId === userId).delete
        )
        .transactionally
    )
    super.afterAll()
  }

  /** A minimal, label-free explore submission for the given session state. */
  private def submission(
      missionId: Int,
      auditTaskId: Int,
      streetEdgeId: Int,
      regionId: Int,
      completed: Boolean,
      auditedDistanceM: Option[Double]
  ): AuditTaskSubmission = {
    val now = OffsetDateTime.now
    AuditTaskSubmission(
      missionProgress = AuditMissionProgress(missionId, Some(0d), regionId, completed, Some(auditTaskId), false),
      auditTask = TaskSubmission(streetEdgeId, now, Some(auditTaskId), Some(completed), 0d, 0d,
        startPointReversed = false, None, now, requestUpdatedStreetPriority = false, auditedDistanceM),
      labels = Seq.empty,
      interactions = Seq.empty,
      environment = EnvironmentSubmission(None, None, None, None, None, None, None, None, None, "en", 100),
      panos = Seq.empty,
      userRouteId = None,
      timestamp = now
    )
  }

  "getDataForExploreAddressPage" should {
    "create an exploreAddress mission (region-less, never-completing) with a completed=false task at the address" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value

          data.mission.missionType mustBe MissionType.ExploreAddress
          data.mission.regionId mustBe None
          data.mission.completed mustBe false
          data.mission.currentAuditTaskId mustBe defined

          val task = data.task.value
          task.auditTaskId mustBe data.mission.currentAuditTaskId
          task.completed mustBe false
          run(auditTasks.filter(_.auditTaskId === task.auditTaskId.get).map(_.completed).result.head) mustBe false

          // The new type id must serialize (Map.apply in MissionFormats throws if it's missing from the Scala map).
          (Json.toJson(data.mission) \ "mission_type").as[String] mustBe "exploreAddress"
      }
    }

    "resume the same mission and task on a second visit to the same address" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val first  = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          val second = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value

          second.mission.missionId mustBe first.mission.missionId
          second.task.value.auditTaskId mustBe first.task.value.auditTaskId
      }
    }

    "return None for a point with no street within the distance cap" in {
      // Null Island is nowhere near any deployment city's street network.
      await(exploreService.getDataForExploreAddressPage(testUser.userId, 0.0, 0.0)) mustBe None
    }
  }

  "submitExploreData for an exploreAddress mission" should {
    "persist audited_distance_m and leave the task, street priority, and region completion untouched" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val regionId     = data.region.regionId

          val priorityBefore   = priorityOf(streetEdgeId)
          val completionBefore = auditedDistanceOf(regionId)

          val result = await(
            exploreService.submitExploreData(
              submission(data.mission.missionId, auditTaskId, streetEdgeId, regionId, completed = false, Some(12.3)),
              testUser.userId
            )
          )
          result.auditTaskId mustBe auditTaskId

          val taskRow = run(auditTasks.filter(_.auditTaskId === auditTaskId).result.head)
          taskRow.completed mustBe false
          taskRow.auditedDistanceM mustBe Some(12.3)
          priorityOf(streetEdgeId) mustBe priorityBefore
          auditedDistanceOf(regionId) mustBe completionBefore
      }
    }

    "ignore a forged completed=true: no task completion, no priority/coverage movement, no next mission" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val regionId     = data.region.regionId

          val priorityBefore   = priorityOf(streetEdgeId)
          val completionBefore = auditedDistanceOf(regionId)
          val missionsBefore   = run(missions.filter(_.userId === testUser.userId).length.result)

          val result = await(
            exploreService.submitExploreData(
              submission(data.mission.missionId, auditTaskId, streetEdgeId, regionId, completed = true, None),
              testUser.userId
            )
          )

          run(auditTasks.filter(_.auditTaskId === auditTaskId).map(_.completed).result.head) mustBe false
          run(missions.filter(_.missionId === data.mission.missionId).map(_.completed).result.head) mustBe false
          priorityOf(streetEdgeId) mustBe priorityBefore
          auditedDistanceOf(regionId) mustBe completionBefore
          // Honoring the flag would have completed the mission and minted a replacement audit mission.
          result.mission mustBe None
          run(missions.filter(_.userId === testUser.userId).length.result) mustBe missionsBefore
      }
    }
  }

  "insertNoImagery for an exploreAddress mission" should {
    "record the street_edge_issue without completing the task or moving street priority" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val regionId     = data.region.regionId

          val priorityBefore = priorityOf(streetEdgeId)
          val issuesBefore   = run(streetIssues.filter(_.userId === testUser.userId).length.result)

          val sub   = submission(data.mission.missionId, auditTaskId, streetEdgeId, regionId, false, None)
          val issue =
            StreetEdgeIssue(0, streetEdgeId, StreetEdgeIssueType.PanoNotAvailable, testUser.userId, "127.0.0.1",
              OffsetDateTime.now)
          await(exploreService.insertNoImagery(sub.auditTask, issue, data.mission.missionId))

          run(streetIssues.filter(_.userId === testUser.userId).length.result) mustBe issuesBefore + 1
          run(auditTasks.filter(_.auditTaskId === auditTaskId).map(_.completed).result.head) mustBe false
          priorityOf(streetEdgeId) mustBe priorityBefore
      }
    }
  }

  "getCurrentMissionInRegion" should {
    "not hand a stray incomplete non-audit mission to the normal audit-resume path" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val regionId =
            await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value.region.regionId

          // A fresh user, so the stray row is this user's only mission and can't be confused with the one testUser
          // already has open. This user gets ONLY the stray row below — what a bug (or older data) could leave
          // behind: an incomplete NON-audit mission that, unlike the ones this feature creates, carries a region_id.
          // Without the mission-type filter it would be resumed as their "current audit mission" in the region.
          val strayUser = {
            val g = await(authService.generateUniqueAnonUser())
            await(
              authService.createUser(
                g,
                "credentials",
                PasswordInfo("bcrypt-sha256", "spec-only", None),
                oldUserId = None
              )
            )
          }
          val now = OffsetDateTime.now
          val _   = run(
            missions += Mission(0, MissionType.ExploreAddress, strayUser.userId, now, now, completed = false, 0d,
              paid = false, None, None, Some(regionId), None, None, None, skipped = false, None)
          )
          try {
            val missionTable = app.injector.instanceOf[models.mission.MissionTable]
            run(missionTable.getCurrentMissionInRegion(strayUser.userId, regionId)) mustBe None
          } finally {
            val _ = run(missions.filter(_.userId === strayUser.userId).delete)
          }
      }
    }
  }
}
