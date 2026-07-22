package service

import formats.json.ExploreFormats._
import formats.json.MissionFormats._
import models.audit.{AuditTask, AuditTaskTable, AuditTaskTableDef}
import models.label.{LabelHistoryTableDef, LabelPointTableDef, LabelTableDef}
import models.mission.{Mission, MissionTableDef, MissionType}
import models.pano.PanoSource
import models.region.RegionCompletionTableDef
import models.userdashboard.TrophyTable
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
import play.api.i18n.{Lang, MessagesApi, MessagesImpl}
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
 * The core invariant under test: the SERVER decides when a free-exploration street counts as audited — from the
 * distance covered beyond the drop-in point, never from the client's completed flag. So a hostile client can't mark a
 * street audited (a forged completed=true is ignored), and an honest one can't be credited for street it never saw
 * (the drop-in point's own offset from the street start is excluded from the walked distance). Below the threshold
 * nothing moves; at the threshold the task completes and street priority shifts exactly once, staying put on every
 * later submission. Also pins the session lifecycle (resume returns the same mission/task, including after the street
 * completes), the nearest-street distance cap, the mission-type JSON serialization of the new mission type, the
 * free-exploration dashboard trophy flags, and the getCurrentMissionInRegion type filter that keeps a stray
 * incomplete mission out of the normal audit-resume path.
 *
 * Creates throwaway anonymous users (same approach as UserAuthControllerSpec's happy path). Every mission/audit_task/
 * label/issue row the tests create is deleted in afterAll, and the street priority + region completion moved by the
 * completion tests are restored — mandatory, not just tidy: the dev DB is shared, so residue would pollute stats and
 * coverage for whoever else is using it. Requires Postgres+PostGIS (DATABASE_URL / DATABASE_USER /
 * DATABASE_PASSWORD, as in dev/CI); cancels gracefully if the connected DB has no streets. Scheduling actors are
 * disabled so background jobs can't race the tests.
 *
 * Ordering note: like the session-lifecycle tests, the server-derived-completion tests share one drop-in session and
 * run in declaration order — the over-credit guard must run before the test that legitimately completes the street.
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class ExploreAddressServiceSpec extends PlaySpec with org.scalatest.BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val exploreService  = app.injector.instanceOf[ExploreService]
  private val authService     = app.injector.instanceOf[AuthenticationService]
  private val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]
  private val auditTaskTable  = app.injector.instanceOf[AuditTaskTable]
  private val trophyTable     = app.injector.instanceOf[TrophyTable]
  private val userService     = app.injector.instanceOf[UserService]
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
  private val labels           = TableQuery[LabelTableDef]
  private val labelPoints      = TableQuery[LabelPointTableDef]
  private val labelHistories   = TableQuery[LabelHistoryTableDef]

  /** Every throwaway user the suite creates, so afterAll can sweep all of their rows uniformly. */
  private val createdUserIds = scala.collection.mutable.Set[String]()

  /** Creates a throwaway anonymous user and registers it for afterAll cleanup. */
  private def newAnonUser(): SidewalkUserWithRole = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    val user      = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
    createdUserIds += user.userId
    user
  }

  /** One throwaway anonymous user shared by the session-lifecycle tests. */
  private lazy val testUser: SidewalkUserWithRole = newAnonUser()

  /** A second throwaway user for the completion tests, so their completed street can't leak into the shared tests. */
  private lazy val completionUser: SidewalkUserWithRole = newAnonUser()

  // Street state the completion tests move and afterAll must put back (the dev DB is shared).
  private var priorityRestore: Option[(Int, Double)]        = None
  private var auditedDistanceRestore: Option[(Int, Double)] = None

  /** A real street start point to use as the "searched address" (whichever open street is nearest gets the task). */
  private lazy val addressLatLng: Option[(Double, Double)] =
    run(streetEdgeTable.streets.map(s => (s.y1, s.x1)).result.headOption)

  private def priorityOf(streetEdgeId: Int): Option[Double] =
    run(priorities.filter(_.streetEdgeId === streetEdgeId).map(_.priority).result.headOption)

  private def auditedDistanceOf(regionId: Int): Option[Double] =
    run(regionCompletion.filter(_.regionId === regionId).map(_.auditedDistance).result.headOption)

  /** Geodesic street length in meters — the same measure `streetWalkedFarEnough` compares the walked distance to. */
  private def streetLengthM(streetEdgeId: Int): Double =
    run(sql"""SELECT ST_Length(geom::geography) FROM street_edge
              WHERE street_edge_id = $streetEdgeId""".as[Double].head)

  private def taskRow(auditTaskId: Int): AuditTask =
    run(auditTasks.filter(_.auditTaskId === auditTaskId).result.head)

  /**
   * Deletes every row the suite created under its throwaway users and restores the street priority / region
   * completion the completion tests moved. Mission and audit_task reference each other
   * (mission.current_audit_task_id / audit_task.current_mission_id), so the mission->task pointer is nulled first;
   * label children (point, history) go before the labels themselves. The bare user/auth rows are left behind,
   * matching UserAuthControllerSpec's happy-path precedent.
   */
  override def afterAll(): Unit = {
    val userIds  = createdUserIds.toSeq
    val labelIds = labels.filter(_.userId inSet userIds).map(_.labelId)
    val _        = run(
      DBIO
        .seq(
          labelPoints.filter(_.labelId in labelIds).delete,
          labelHistories.filter(_.labelId in labelIds).delete,
          labels.filter(_.userId inSet userIds).delete,
          missions.filter(_.userId inSet userIds).map(_.currentAuditTaskId).update(None),
          auditTasks.filter(_.userId inSet userIds).delete,
          missions.filter(_.userId inSet userIds).delete,
          streetIssues.filter(_.userId inSet userIds).delete,
          TableQuery[models.user.UserCurrentRegionTableDef].filter(_.userId inSet userIds).delete
        )
        .transactionally
    )
    priorityRestore.foreach { case (streetEdgeId, p) =>
      val _ = run(priorities.filter(_.streetEdgeId === streetEdgeId).map(_.priority).update(p))
    }
    auditedDistanceRestore.foreach { case (regionId, d) =>
      val _ = run(regionCompletion.filter(_.regionId === regionId).map(_.auditedDistance).update(d))
    }
    super.afterAll()
  }

  /** A minimal explore submission for the given session state, label-free unless labels are passed. */
  private def submission(
      missionId: Int,
      auditTaskId: Int,
      streetEdgeId: Int,
      regionId: Int,
      completed: Boolean,
      auditedDistanceM: Option[Double],
      labels: Seq[LabelSubmission] = Seq.empty
  ): AuditTaskSubmission = {
    val now = OffsetDateTime.now
    AuditTaskSubmission(
      missionProgress = AuditMissionProgress(missionId, Some(0d), regionId, completed, Some(auditTaskId), false),
      auditTask = TaskSubmission(streetEdgeId, now, Some(auditTaskId), Some(completed), 0d, 0d,
        startPointReversed = false, None, now, requestUpdatedStreetPriority = false, auditedDistanceM),
      labels = labels,
      interactions = Seq.empty,
      environment = EnvironmentSubmission(None, None, None, None, None, None, None, None, None, "en", 100),
      panos = Seq.empty,
      userRouteId = None,
      timestamp = now
    )
  }

  /** A minimal non-tutorial label placement, as the Explore client would submit during a drop-in session. */
  private def labelSubmission(temporaryLabelId: Int): LabelSubmission =
    LabelSubmission(
      panoId = "explore-address-spec-pano",
      panoSource = PanoSource.Gsv,
      labelType = "Obstacle",
      deleted = false,
      severity = Some(1),
      description = None,
      tagIds = Seq.empty,
      point = LabelPointSubmission(0, 0, 0, 0, 0d, 0d, 1d, None, None, None),
      temporaryLabelId = temporaryLabelId,
      timeCreated = Some(OffsetDateTime.now),
      tutorial = false
    )

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
          val row = taskRow(task.auditTaskId.get)
          row.completed mustBe false
          // The drop-in point's along-street offset must be recorded at creation: completion subtracts it so the
          // unwalked prefix from the street's start to the drop-in point can't be credited.
          row.startOffsetM.value must be >= 0d
          row.startOffsetM.value must be <= streetLengthM(task.edgeId) + 1d

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

  "findTaskForMission" should {
    "return the newest row when duplicates exist for the same (user, street, mission)" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          val missionId    = data.mission.missionId
          val streetEdgeId = data.task.value.edgeId
          val originalId   = data.task.value.auditTaskId.get

          // Nothing in the schema forbids this duplicate (the invariant lives in an advisory lock), so the DAO's
          // deterministic newest-row pick is what keeps a session resuming onto one consistent task if it ever occurs.
          val now   = OffsetDateTime.now
          val dupId = run(
            auditTaskTable.insert(
              AuditTask(0, None, testUser.userId, streetEdgeId, now, now, completed = false, lat, lng,
                startPointReversed = false, Some(missionId), None, lowQuality = false, incomplete = false,
                stale = false, auditedDistanceM = None)
            )
          )
          try {
            val found = run(auditTaskTable.findTaskForMission(testUser.userId, streetEdgeId, missionId)).value
            found.auditTaskId mustBe dupId
          } finally {
            val _ = run(auditTasks.filter(_.auditTaskId === dupId).delete)
          }
          run(
            auditTaskTable.findTaskForMission(testUser.userId, streetEdgeId, missionId)
          ).value.auditTaskId mustBe originalId
      }
    }
  }

  "submitExploreData for an exploreAddress mission" should {
    "persist a below-threshold audited_distance_m and leave the task, street priority, and region completion alone" in {
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

  // These share one drop-in session (completionUser) and run in declaration order: the over-credit guard must run
  // while the street is still incomplete, before the test that legitimately completes it.
  "server-derived street completion for an exploreAddress mission" should {
    "not credit the unwalked prefix before the drop-in point" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(completionUser.userId, lat, lng)).value
          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val len          = streetLengthM(streetEdgeId)
          val origOffset   = taskRow(auditTaskId).startOffsetM

          // Pretend the session dropped in halfway along the street. A reported distance of 0.95 * length then passes
          // a naive walked >= 0.9 * length check while the user has actually covered less than half the street.
          val _ = run(auditTasks.filter(_.auditTaskId === auditTaskId).map(_.startOffsetM).update(Some(len * 0.5)))
          try {
            val priorityBefore = priorityOf(streetEdgeId)
            val res            = await(
              exploreService.submitExploreData(
                submission(
                  data.mission.missionId,
                  auditTaskId,
                  streetEdgeId,
                  data.region.regionId,
                  completed = false,
                  Some(len * 0.95)
                ),
                completionUser.userId
              )
            )
            res.auditTaskId mustBe auditTaskId
            taskRow(auditTaskId).completed mustBe false
            priorityOf(streetEdgeId) mustBe priorityBefore
          } finally {
            val _ = run(auditTasks.filter(_.auditTaskId === auditTaskId).map(_.startOffsetM).update(origOffset))
          }
      }
    }

    "complete the task and move street priority once the covered distance reaches the threshold" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data         = await(exploreService.getDataForExploreAddressPage(completionUser.userId, lat, lng)).value
          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val regionId     = data.region.regionId
          val len          = streetLengthM(streetEdgeId)
          val offset       = taskRow(auditTaskId).startOffsetM.getOrElse(0d)

          val priorityBefore   = priorityOf(streetEdgeId)
          val completionBefore = auditedDistanceOf(regionId)
          // Remember what to put back: this test deliberately shifts shared street/region state.
          priorityRestore = priorityBefore.map(streetEdgeId -> _)
          auditedDistanceRestore = completionBefore.map(regionId -> _)

          val walked = offset + len * ExploreService.streetWalkedThreshold + 0.5
          val _      = await(
            exploreService.submitExploreData(
              submission(data.mission.missionId, auditTaskId, streetEdgeId, regionId, completed = false, Some(walked)),
              completionUser.userId
            )
          )

          taskRow(auditTaskId).completed mustBe true
          // The mission itself never completes: only the street gets credited.
          run(missions.filter(_.missionId === data.mission.missionId).map(_.completed).result.head) mustBe false
          // partiallyUpdatePriority strictly decreases any positive priority; 0 stays 0.
          if (priorityBefore.exists(_ > 0d)) {
            priorityOf(streetEdgeId).value must be < priorityBefore.value
          } else {
            priorityOf(streetEdgeId) mustBe priorityBefore
          }
      }
    }

    "leave street priority where it is on every submission after completion" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data           = await(exploreService.getDataForExploreAddressPage(completionUser.userId, lat, lng)).value
          val streetEdgeId   = data.task.value.edgeId
          val auditTaskId    = data.task.value.auditTaskId.get
          val len            = streetLengthM(streetEdgeId)
          val offset         = taskRow(auditTaskId).startOffsetM.getOrElse(0d)
          val priorityBefore = priorityOf(streetEdgeId)

          // The user keeps wandering and the client keeps flushing: the threshold stays satisfied on every POST, and
          // the completed-flag guard is what stops the priority from being decremented again each time.
          val walked = offset + len * ExploreService.streetWalkedThreshold + 1.0
          val _      = await(
            exploreService.submitExploreData(
              submission(data.mission.missionId, auditTaskId, streetEdgeId, data.region.regionId, completed = false,
                Some(walked)),
              completionUser.userId
            )
          )

          taskRow(auditTaskId).completed mustBe true
          priorityOf(streetEdgeId) mustBe priorityBefore
      }
    }

    "resume the completed task on a fresh page load instead of losing it" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          val data = await(exploreService.getDataForExploreAddressPage(completionUser.userId, lat, lng)).value

          // Regression guard: the page-data path must reload the finished street (the client needs the task to
          // initialize), not fall through to the no-task branch.
          val task = data.task.value
          task.completed mustBe true
          task.auditTaskId mustBe data.mission.currentAuditTaskId

          // The DAO split underneath: the default lookup serves flows that only ever see active tasks, while the
          // resume path opts into completed ones.
          val auditTaskId = task.auditTaskId.get
          run(auditTaskTable.selectTaskFromTaskId(auditTaskId)) mustBe None
          run(auditTaskTable.selectTaskFromTaskId(auditTaskId, includeCompleted = true)) mustBe defined
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

  "free-exploration dashboard trophies" should {
    "report (false, false) for a user with no free-exploration history" in {
      run(trophyTable.getFreeExplorationTrophyFlags(newAnonUser().userId)) mustBe ((false, false))
    }

    "flip tried once a mission exists, and labeled once a label lands during one" in {
      addressLatLng match {
        case None             => cancel("No streets in the connected DB; nothing to exercise.")
        case Some((lat, lng)) =>
          // testUser's exploreAddress mission exists from the earlier session tests, but no labels yet.
          val data = await(exploreService.getDataForExploreAddressPage(testUser.userId, lat, lng)).value
          run(trophyTable.getFreeExplorationTrophyFlags(testUser.userId)) mustBe ((true, false))

          val streetEdgeId = data.task.value.edgeId
          val auditTaskId  = data.task.value.auditTaskId.get
          val _            = await(
            exploreService.submitExploreData(
              submission(data.mission.missionId, auditTaskId, streetEdgeId, data.region.regionId, completed = false,
                auditedDistanceM = None, labels = Seq(labelSubmission(data.nextTempLabelId))),
              testUser.userId
            )
          )
          run(trophyTable.getFreeExplorationTrophyFlags(testUser.userId)) mustBe ((true, true))
      }
    }

    "surface both participation trophies after any ranked trophies in getTrophies" in {
      addressLatLng match {
        case None    => cancel("No streets in the connected DB; nothing to exercise.")
        case Some(_) =>
          val messages = MessagesImpl(Lang("en"), app.injector.instanceOf[MessagesApi])
          val trophies = await(userService.getTrophies(testUser.userId, "Test City", messages))

          val freeExplore = trophies.filter(_.variant == "freeExplore")
          freeExplore.map(_.title) mustBe Seq("Free explorer", "Explorer's eye")
          // Participation trophies sit last, after everything earned against other mappers.
          trophies.takeRight(freeExplore.size) mustBe freeExplore
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
          val strayUser = newAnonUser()
          val now       = OffsetDateTime.now
          val _         = run(
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
