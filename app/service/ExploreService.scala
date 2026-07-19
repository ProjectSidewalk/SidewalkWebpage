package service

import com.google.inject.ImplementedBy
import formats.json.ExploreFormats._
import models.audit._
import models.label.{Tag, _}
import models.mission.{Mission, MissionTable, MissionType}
import models.pano.PanoSource.PanoSource
import models.pano._
import models.region.{Region, RegionCompletionTable, RegionTable}
import models.route._
import models.street._
import models.survey.{SurveyQuestionTable, SurveyQuestionWithOptions}
import models.user.SidewalkUserTable.aiUserId
import models.user._
import models.utils.MyPostgresProfile.api._
import models.utils.{ConfigTable, MyPostgresProfile, WebpageActivityTable}
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Point, PrecisionModel}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.{Configuration, Logger}

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

case class ExplorePageData(
    task: Option[NewTask],
    mission: Mission,
    region: Region,
    userRoute: Option[UserRoute],
    hasCompletedAMission: Boolean,
    nextTempLabelId: Int,
    surveyData: Seq[SurveyQuestionWithOptions],
    tutorialStreetId: Int,
    makeCrops: Boolean
)

/** Core facts about a label inserted during an Explore submission, for post-submission side effects (AI, SciStarter). */
case class NewLabelData(
    labelId: Int,
    temporaryLabelId: Int,
    labelType: LabelTypeEnum.Base,
    panoSource: PanoSource,
    tutorial: Boolean,
    timeCreated: OffsetDateTime
)
case class ExploreTaskPostReturnValue(
    auditTaskId: Int,
    mission: Option[Mission],
    newLabels: Seq[NewLabelData],
    updatedStreets: Option[UpdatedStreets],
    refreshPage: Boolean
)
case class UpdatedStreets(lastPriorityUpdateTime: OffsetDateTime, updatedStreetPriorities: Seq[StreetEdgePriority])

/**
 * Companion object with constants that are shared throughout codebase.
 */
object ExploreService {
  // Max distance from a searched point to the nearest open street for an exploreAddress session (#4451). Beyond this,
  // the caller falls back to the normal explore flow rather than dropping the user somewhere unrelated.
  val exploreAddressMaxDistM: Double = 500d

  // Fraction of a street a free-exploration session must cover — beyond where it dropped in — before the street counts
  // as audited (#4451). A normal audit completes when the client gets within 25m of the endpoint, which is a proximity
  // test rather than a fraction, so no single fraction reproduces it — 25m is ~88% of a 200m street but only ~75% of a
  // 100m one (streets much longer than 250m imply a slightly higher fraction, where the few-meter difference is
  // immaterial). 0.9 sits at the strict end of that band: completing a street credits the user its full length, so
  // under-crediting a session costs a user nothing while over-crediting corrupts city-wide coverage.
  val streetWalkedThreshold: Double = 0.9d
}

@ImplementedBy(classOf[ExploreServiceImpl])
trait ExploreService {
  def getDataForExplorePage(
      userId: String,
      retakingTutorial: Boolean,
      newRegion: Boolean,
      routeId: Option[Int],
      resumeRoute: Boolean,
      regionId: Option[Int],
      streetEdgeId: Option[Int]
  ): Future[ExplorePageData]

  /**
   * Gets data for an address-drop-in Explore session at the given lat/lng under an exploreAddress mission (#4451).
   *
   * @return None if no street is within range of the point (caller should fall back to the normal explore flow).
   */
  def getDataForExploreAddressPage(userId: String, lat: Double, lng: Double): Future[Option[ExplorePageData]]
  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]]
  def insertEnvironment(env: AuditTaskEnvironment): Future[Int]
  def insertMultipleInteractions(interactions: Seq[AuditTaskInteraction]): Future[Unit]

  /**
   * Takes data submitted from the Explore page updates the pano_data, pano_link, and pano_history tables accordingly.
   * @param panos All pano-related data submitted from the Explore page front-end.
   */
  def savePanoInfo(panos: Seq[PanoSubmission]): Future[Unit]
  def insertComment(comment: AuditTaskComment): Future[Int]

  /**
   * Logs to the street_edge_issue table and, for regular audit missions, marks the task as complete as if it were
   * completed normally. For exploreAddress missions only the issue is logged — the task never completes (#4451).
   * @param taskSubmission The audit task associated with the imagery issue
   * @param streetIssue The StreetIssue object to submit
   * @param missionId The mission_id for the task
   * @return The number of rows added to the street_edge_issue table (should always be 1)
   */
  def insertNoImagery(taskSubmission: TaskSubmission, streetIssue: StreetEdgeIssue, missionId: Int): Future[Int]

  /**
   * Inserts a set of AI-generated labels into the database, filling in appropriate tables with dummy data.
   * @param data The AiLabelsSubmission object submitted through a POST request.
   * @return A Future containing a sequence of Unit values, one for each label submitted.
   */
  def submitAiLabelData(data: AiLabelsSubmission): Future[Seq[Unit]]

  /**
   * Takes data submitted from the Explore page and updates the database accordingly.
   * @param data All data submitted from front-end.
   * @param userId The user_id of the user who submitted the data.
   */
  def submitExploreData(data: AuditTaskSubmission, userId: String): Future[ExploreTaskPostReturnValue]
  def secondsSpentAuditing(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: OffsetDateTime): Future[Double]
  def selectTasksInRoute(userRouteId: Int): Future[Seq[NewTask]]

  /**
   * Check if the user should be shown the survey. It's shown exactly once, in the middle of the 2nd mission.
   * @param userId User ID of the user to check.
   * @return True if the user should be shown the survey, false otherwise.
   */
  def shouldDisplaySurvey(userId: String): Future[Boolean]

  /**
   * Submit the survey data to the database.
   * @param userId User ID of the user submitting the survey.
   * @param ipAddress IP address of the user submitting the survey.
   * @param data Data submitted from the survey.
   */
  def submitSurvey(userId: String, ipAddress: String, data: Seq[SurveySingleSubmission]): Future[Seq[Int]]
}

@Singleton
class ExploreServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    val config: Configuration,
    configTable: ConfigTable,
    missionService: MissionService,
    regionTable: RegionTable,
    labelTable: LabelTable,
    labelPointTable: LabelPointTable,
    missionTable: MissionTable,
    userCurrentRegionTable: UserCurrentRegionTable,
    routeTable: RouteTable,
    userRouteTable: UserRouteTable,
    labelService: LabelService,
    auditTaskTable: AuditTaskTable,
    auditTaskEnvironmentTable: AuditTaskEnvironmentTable,
    auditTaskInteractionTable: AuditTaskInteractionTable,
    auditTaskCommentTable: AuditTaskCommentTable,
    auditTaskUserRouteTable: AuditTaskUserRouteTable,
    streetEdgePriorityTable: StreetEdgePriorityTable,
    regionCompletionTable: RegionCompletionTable,
    streetEdgeTable: StreetEdgeTable,
    streetEdgeRegionTable: StreetEdgeRegionTable,
    panoDataTable: PanoDataTable,
    panoLinkTable: PanoLinkTable,
    panoHistoryTable: PanoHistoryTable,
    labelAiInfoTable: LabelAiInfoTable,
    streetEdgeIssueTable: StreetEdgeIssueTable,
    webpageActivityTable: WebpageActivityTable,
    surveyQuestionTable: SurveyQuestionTable,
    userSurveyOptionSubmissionTable: UserSurveyOptionSubmissionTable,
    userSurveyTextSubmissionTable: UserSurveyTextSubmissionTable,
    implicit val ec: ExecutionContext
) extends ExploreService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)
  // SRID 4326 is baked into the factory so points it creates match label_point.geom's lat/lng coordinate system.
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  def getDataForExplorePage(
      userId: String,
      retakingTutorial: Boolean,
      newRegion: Boolean,
      routeId: Option[Int],
      resumeRoute: Boolean,
      regionId: Option[Int],
      streetEdgeId: Option[Int]
  ): Future[ExplorePageData] = {
    def getExploreDataAction = for {
      // Check if user has an active route or create a new one if routeId was supplied. If resumeRoute is false and no
      // routeId was supplied, then the function should return None and the user is not sent on a specific route.
      // However, region or street id params take precedence.
      userRoute: Option[UserRoute] <-
        if (regionId.isEmpty && streetEdgeId.isEmpty) {
          setUpPossibleUserRoute(routeId, userId, resumeRoute)
        } else {
          DBIO.successful(None)
        }
      routeOption: Option[Route] <- userRoute
        .map(ur => routeTable.getRoute(ur.routeId))
        .getOrElse(DBIO.successful(None))

      // Get the appropriate region the user is going to explore, and update their user_current_region entry.
      currRegion: Option[Region] <- userCurrentRegionTable.getCurrentRegion(userId)
      region: Option[Region]     <- {
        (streetEdgeId, regionId, routeOption, newRegion, currRegion) match {
          // If user is exploring a specific street, get the region associated with that street and assign it to them.
          case (Some(streetId), _, _, _, _) =>
            streetEdgeRegionTable.getNonDeletedRegionFromStreetId(streetId).flatMap {
              case Some(region) => userCurrentRegionTable.insertOrUpdate(userId, region.regionId).map(_ => Some(region))
              case None         =>
                logger.error(
                  s"Either there is no region associated with street edge $streetId, or it is not a valid id."
                )
                DBIO.successful(None)
            }
          // If user is exploring a specific region, assign it to them.
          case (_, Some(r), _, _, _) =>
            regionTable.getRegion(r).flatMap {
              case Some(region) => userCurrentRegionTable.insertOrUpdate(userId, region.regionId).map(_ => Some(region))
              case None         =>
                logger.error(s"Tried to explore region $r, but there is no neighborhood with that id.")
                DBIO.successful(None)
            }
          // If user is on a route, assign them to the region associated with the route.
          case (_, _, Some(route), _, _) =>
            userCurrentRegionTable.insertOrUpdate(userId, route.regionId).flatMap(rId => regionTable.getRegion(rId))
          // If we aren't trying to do anything special and user already has a region assigned, use that region.
          case (_, _, _, false, Some(r)) =>
            isTaskAvailable(userId, r.regionId).flatMap {
              case true  => DBIO.successful(currRegion)
              case false => assignRegion(userId)
            }
          // If we aren't trying to do anything special and the user has no region assigned, assign one to them.
          case _ => assignRegion(userId)
        }
      }
      // TODO we should throw some error here so that the user knows if a region wasn't found.
      _             = if (region.isEmpty) logger.error(s"Could not find region for $userId!!")
      regionId: Int = region.get.regionId

      mission: Mission <- {
        if (retakingTutorial) missionService.resumeOrCreateNewAuditOnboardingMission(userId).map(_.get)
        else missionService.resumeOrCreateNewAuditMission(userId, regionId).map(_.get)
      }

      // If there is a partially completed task in this route or mission, get that, o/w make a new one.
      task: Option[NewTask] <- {
        if (mission.missionType == MissionType.AuditOnboarding) {
          auditTaskTable.getATutorialTask(mission.missionId).map(Some(_))
        } else if (streetEdgeId.isDefined) {
          auditTaskTable.selectANewTask(streetEdgeId.get, mission.missionId).map(Some(_))
        } else if (routeOption.isDefined) {
          userRouteTable.getRouteTask(userRoute.get, mission.missionId)
        } else if (mission.currentAuditTaskId.isDefined) {
          // If we find no task with the given ID, try to get any new task in the neighborhood.
          auditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get).flatMap { currTask =>
            if (currTask.isDefined) DBIO.successful(currTask)
            else auditTaskTable.selectANewTaskInARegion(regionId, userId, mission.missionId)
          }
        } else {
          auditTaskTable.selectANewTaskInARegion(regionId, userId, mission.missionId)
        }
      }
      nextTempLabelId: Int <- labelTable.nextTempLabelId(userId)

      // If the mission has the wrong audit_task_id, update it.
      updatedMission: Mission <- {
        if (task.isDefined && task.get.auditTaskId != mission.currentAuditTaskId) {
          missionService
            .updateExploreProgressOnly(
              userId,
              mission.missionId,
              mission.distanceProgress.getOrElse(0d),
              task.get.auditTaskId
            )
            .flatMap(_ => missionTable.getMission(mission.missionId).map(_.get))
        } else {
          DBIO.successful(mission)
        }
      }

      // Check if they've already completed an explore mission. Used to suggest Validate/Explore missions on front-end.
      hasCompletedAMission: Boolean <- missionTable.countCompletedMissions(userId, MissionType.Audit).map(_ > 0)

      surveyData: Seq[SurveyQuestionWithOptions] <- surveyQuestionTable.listAllWithOptions
      tutorialStreetId: Int                      <- configTable.getTutorialStreetId
      makeCrops: Boolean                         <- configTable.getMakeCrops
    } yield {
      ExplorePageData(task, updatedMission, region.get, userRoute, hasCompletedAMission, nextTempLabelId, surveyData,
        tutorialStreetId, makeCrops)
    }
    db.run(getExploreDataAction.transactionally)
  }

  def getDataForExploreAddressPage(userId: String, lat: Double, lng: Double): Future[Option[ExplorePageData]] = {
    val exploreAddressAction = lockUserForExploreAddress(userId)
      .andThen(labelTable.getStreetEdgeIdClosestToLatLng(lat, lng, ExploreService.exploreAddressMaxDistM))
      .flatMap {
        case None               => DBIO.successful(None)
        case Some(streetEdgeId) =>
          streetEdgeRegionTable.getNonDeletedRegionFromStreetId(streetEdgeId).flatMap {
            case None         => DBIO.successful(None)
            case Some(region) =>
              // Deliberately does NOT reassign user_current_region: an address drop-in is a lightweight "look here"
              // action and must not abandon a partial audit the user has going in another region (#4451). The page
              // still renders this region's context via ExplorePageData.region.
              for {
                mission: Mission <- missionService.resumeOrCreateNewExploreAddressMission(userId)
                auditTaskId: Int <- resumeOrCreateExploreAddressTask(userId, mission.missionId, streetEdgeId, lat, lng)
                _                <- missionTable.updateCurrentAuditTaskId(mission.missionId, Some(auditTaskId))
                updatedMission: Mission <- missionTable.getMission(mission.missionId).map(_.get)
                // includeCompleted: a drop-in street the session already finished must still load on resume (#4451).
                task: Option[NewTask] <- auditTaskTable.selectTaskFromTaskId(auditTaskId, includeCompleted = true)
                nextTempLabelId: Int  <- labelTable.nextTempLabelId(userId)
                hasCompletedAMission: Boolean <-
                  missionTable.countCompletedMissions(userId, missionType = MissionType.Audit).map(_ > 0)
                surveyData: Seq[SurveyQuestionWithOptions] <- surveyQuestionTable.listAllWithOptions
                tutorialStreetId: Int                      <- configTable.getTutorialStreetId
                makeCrops: Boolean                         <- configTable.getMakeCrops
              } yield {
                Some(
                  ExplorePageData(task, updatedMission, region, userRoute = None, hasCompletedAMission, nextTempLabelId,
                    surveyData, tutorialStreetId, makeCrops)
                )
              }
          }
      }
    db.run(exploreAddressAction.transactionally)
  }

  /**
   * Serializes a user's concurrent address drop-ins so get-or-create can't produce a second open mission (#4451).
   *
   * The invariant is "at most one open exploreAddress mission per user", which would naturally be a partial unique
   * index. It can't be: the index predicate needs the 'exploreAddress' enum literal, and because evolutions run with
   * autocommit=false, every pending evolution shares the transaction that adds the value -- Postgres forbids using a
   * new enum value there, so any DB applying both at once (fresh installs, CI, a new city schema) would fail to
   * migrate. A transaction-scoped advisory lock enforces the same invariant without the schema hazard. The lock is
   * namespaced by issue number so it can't collide with an unrelated advisory lock elsewhere.
   */
  private def lockUserForExploreAddress(userId: String): DBIO[Unit] = {
    sql"SELECT pg_advisory_xact_lock(4451, ${userId.hashCode})::text".as[String].map(_ => ())
  }

  /**
   * Returns the user's task on the given street within the given exploreAddress mission, creating one if none exists
   * (#4451).
   *
   * The searched lat/lng is used as the task's current position so the pano opens at the address itself. Its offset
   * along the street is stored on the task so completion can credit only the distance covered beyond the drop-in
   * point (see `streetWalkedFarEnough`).
   */
  private def resumeOrCreateExploreAddressTask(
      userId: String,
      missionId: Int,
      streetEdgeId: Int,
      lat: Double,
      lng: Double
  ): DBIO[Int] = {
    auditTaskTable.findTaskForMission(userId, streetEdgeId, missionId).flatMap {
      case Some(existingTask) => DBIO.successful(existingTask.auditTaskId)
      case _                  =>
        // ST_LineLocatePoint gives the searched point's fraction along the street; geodesic length converts it to
        // meters so it is directly comparable to the client's audited_distance_m.
        sql"""SELECT ST_LineLocatePoint(street_edge.geom, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))
                     * ST_Length(street_edge.geom::geography)
              FROM street_edge
              WHERE street_edge.street_edge_id = $streetEdgeId"""
          .as[Double]
          .headOption
          .flatMap { startOffsetM: Option[Double] =>
            auditTaskTable.insert(
              AuditTask(0, None, userId, streetEdgeId, OffsetDateTime.now, OffsetDateTime.now, completed = false, lat,
                lng, startPointReversed = false, Some(missionId), None, lowQuality = false, incomplete = false,
                stale = false, auditedDistanceM = None, startOffsetM = startOffsetM)
            )
          }
    }
  }

  private def setUpPossibleUserRoute(
      routeId: Option[Int],
      userId: String,
      resumeRoute: Boolean
  ): DBIO[Option[UserRoute]] = {
    (routeId match {
      case Some(rId) => routeTable.getRoute(rId).map(_.isDefined)
      case None      => DBIO.successful(false)
    }).flatMap { routeExists =>
      (routeExists, routeId, resumeRoute) match {
        // Discard routes that don't match routeId, resume route with given routeId if it exists, o/w make a new one.
        case (true, Some(rId), true) =>
          for {
            _      <- userRouteTable.discardOtherActiveRoutes(rId, userId)
            result <- userRouteTable.getActiveRouteOrCreateNew(rId, userId)
          } yield Some(result)
        // Discard old routes, save a new one with given routeId.
        case (true, Some(rId), false) =>
          for {
            _      <- userRouteTable.discardAllActiveRoutes(userId)
            result <- userRouteTable.getActiveRouteOrCreateNew(rId, userId)
          } yield Some(result)
        // Get an in progress route (with any routeId) if it exists, otherwise return None.
        case (_, None, true) =>
          userRouteTable.getInProgressRoute(userId)
        // Discard old routes, return None.
        case (_, _, _) =>
          userRouteTable.discardAllActiveRoutes(userId).map(_ => None)
      }
    }
  }

  /**
   * Picks one of the regions with the highest average priority out of those that the user has not completed.
   */
  private def selectAHighPriorityRegion(userId: String): DBIO[Option[Region]] = {
    for {
      finishedRegions: Seq[Int] <- auditTaskTable.getRegionsCompletedByUser(userId)
      highPriorityRegion        <- regionTable.selectAHighPriorityRegion(finishedRegions)
    } yield highPriorityRegion
  }

  /**
   * Select a region with high avg street priority where the user hasn't explored every street; assign it to them.
   */
  private def assignRegion(userId: String): DBIO[Option[Region]] = {
    for {
      newRegion <- selectAHighPriorityRegion(userId)
      // If region successfully selected, assign it to them.
      regionId <- newRegion match {
        case Some(region) => userCurrentRegionTable.insertOrUpdate(userId, region.regionId)
        case None         => DBIO.successful(-1)
      }
    } yield newRegion
  }

  /**
   * Check if there are tasks available for the user in the given region.
   */
  private def isTaskAvailable(user: String, regionId: Int): DBIO[Boolean] =
    auditTaskTable.getStreetEdgeIdsNotAudited(user, regionId).map(_.nonEmpty)

  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]] =
    db.run(auditTaskTable.selectTasksInARegion(regionId, userId))

  def insertEnvironment(env: AuditTaskEnvironment): Future[Int] = db.run(auditTaskEnvironmentTable.insert(env))

  def insertMultipleInteractions(interactions: Seq[AuditTaskInteraction]): Future[Unit] =
    db.run(auditTaskInteractionTable.insertMultiple(interactions))

  /**
   * Insert or update the submitted audit task in the database.
   * @return {Int} auditTaskId
   */
  private def updateAuditTaskTable(userId: String, task: TaskSubmission, missionId: Int): DBIO[Int] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now
    if (task.auditTaskId.isDefined) {
      // Update the existing audit task row (don't update if they are in the tutorial).
      val id: Int = task.auditTaskId.get
      for {
        missionType <- missionTable.getMissionType(missionId)
        _           <-
          if (missionType.exists(Set(MissionType.Audit, MissionType.ExploreAddress).contains)) {
            auditTaskTable.updateTaskProgress(id, timestamp, task.currentLat, task.currentLng, missionId,
              task.currentMissionStart, task.auditedDistanceM)
          } else DBIO.successful(())
      } yield {
        id
      }
    } else {
      // Insert the new audit task.
      auditTaskTable.insert(
        AuditTask(0, None, userId, task.streetEdgeId, task.taskStart, timestamp, completed = false, task.currentLat,
          task.currentLng, task.startPointReversed, Some(missionId), task.currentMissionStart, lowQuality = false,
          incomplete = false, stale = false, task.auditedDistanceM)
      )
    }
  }

  /**
   * Whether a free-exploration session has covered enough of a street to count as having audited it (#4451).
   *
   * A normal audit is completed by the client, which marks the task done once the user gets within 25m of the street's
   * endpoint. A drop-in has no equivalent client signal, so the server decides from the distance the user actually
   * walked. Deriving it here rather than trusting a submitted flag also means a forged `completed=true` still can't
   * shift coverage, so the invariant holds without a separate anti-forgery guard.
   *
   * `audited_distance_m` measures from the street's start coordinate to the furthest point reached, so for a drop-in
   * it begins at the drop-in point's own offset rather than 0. The task's `start_offset_m` is subtracted so only
   * ground actually covered counts — otherwise a session dropped near the far end of a street would complete it
   * without walking at all. A consequence is that only sessions dropped near a street's start can ever complete it;
   * mid-street drop-ins never do, which errs on the cheap side (under-crediting costs nothing, over-crediting
   * corrupts coverage).
   *
   * Length is measured with `::geography` (geodesic) rather than a projected CRS because the value it is compared
   * against — the client's `audited_distance_m` — is itself computed geodesically. Projecting to a fixed UTM zone the
   * way `RegionCompletionTable` does would inflate the length outside that zone (~25% in Amsterdam), pushing the
   * threshold past the street's real length so it could never be reached.
   *
   * @param auditTaskId      The session's task, holding where along the street it dropped in.
   * @param streetEdgeId     The street being explored.
   * @param auditedDistanceM How far along the street the client reports the user has gotten, in meters.
   * @return `true` once the distance covered beyond the drop-in point reaches `ExploreService.streetWalkedThreshold`
   *         of the street's length; `false` when the client sent no distance or the street has no geometry.
   */
  private def streetWalkedFarEnough(
      auditTaskId: Int,
      streetEdgeId: Int,
      auditedDistanceM: Option[Double]
  ): DBIO[Boolean] = {
    auditedDistanceM match {
      case None          => DBIO.successful(false)
      case Some(walkedM) =>
        sql"""SELECT ST_Length(street_edge.geom::geography),
                     (SELECT audit_task.start_offset_m FROM audit_task WHERE audit_task.audit_task_id = $auditTaskId)
              FROM street_edge
              WHERE street_edge.street_edge_id = $streetEdgeId"""
          .as[(Double, Option[Double])]
          .headOption
          .map { row: Option[(Double, Option[Double])] =>
            row.exists { case (len, startOffsetM) =>
              len > 0d && walkedM - startOffsetM.getOrElse(0d) >= len * ExploreService.streetWalkedThreshold
            }
          }
    }
  }

  /**
   * Update the street priority for the given street edge ID assuming that the given user just audited the street.
   * @param streetEdgeId The street_edge_id of the street that was audited.
   * @param userId The user_id of the user who audited the street.
   * @return The new priority value of the street.
   */
  private def updateStreetPriority(streetEdgeId: Int, userId: String): DBIO[Option[Double]] = {
    for {
      priorityBefore: Option[Double] <- streetEdgePriorityTable
        .streetPrioritiesFromIds(Seq(streetEdgeId))
        .map(_.headOption.map(_.priority))
      // Update the street's priority only if the user has not completed this street previously.
      userAlreadyAudited: Boolean   <- auditTaskTable.userHasAuditedStreet(streetEdgeId, userId)
      priorityAfter: Option[Double] <-
        if (!userAlreadyAudited) {
          streetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, userId)
        } else DBIO.successful(None)

      // If street priority went from 1 to < 1 due to this audit, update the region_completion table accordingly.
      _ <-
        if (priorityBefore.contains(1.0d) && priorityAfter.exists(_ < 1.0d)) {
          regionCompletionTable.updateAuditedDistance(streetEdgeId)
        } else DBIO.successful(())
    } yield {
      priorityAfter
    }
  }

  /**
   * Insert a new label into the database.
   * @param label The metadata for the label being submitted.
   * @param userId The user_id of the user who added the label.
   * @param auditTaskId The audit_task_id of the task the label was added during.
   * @param taskStreetId The street_edge_id of the street for the associated audit_task.
   * @param missionId The mission_id of the mission the label was added during.
   * @return The new label's core facts, used for post-submission side effects (AI validation, SciStarter, logging).
   */
  private def insertLabel(
      label: LabelSubmission,
      userId: String,
      auditTaskId: Int,
      taskStreetId: Int,
      missionId: Int
  ): DBIO[NewLabelData] = {
    // Get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp.
    val timeCreated: OffsetDateTime = label.timeCreated match {
      case Some(time) => time
      case None       =>
        logger.error("No timestamp given for a new label, using current time instead.")
        OffsetDateTime.now
    }

    val point: LabelPointSubmission = label.point
    val pointGeom: Option[Point]    = for {
      _lat <- point.lat
      _lng <- point.lng
    } yield gf.createPoint(new Coordinate(_lng, _lat))

    for {
      // Use label's lat/lng to determine street_edge_id. If lat/lng isn't defined, use audit_task's as backup.
      calculatedStreetEdgeId: Int <- (point.lat, point.lng) match {
        case (Some(lat), Some(lng)) => labelTable.getStreetEdgeIdClosestToLatLng(lat, lng)
        case _                      => DBIO.successful(taskStreetId)
      }

      // Add the new entry to the label table.
      allTags: Seq[Tag] <- labelService.selectAllTags
      newLabelId: Int   <- labelService.insertLabel(
        Label(
          labelId = 0,
          auditTaskId = auditTaskId,
          missionId = missionId,
          userId = userId,
          panoId = label.panoId,
          labelTypeId = LabelTypeEnum.labelTypeToId(label.labelType),
          deleted = label.deleted,
          temporaryLabelId = label.temporaryLabelId,
          timeCreated = timeCreated,
          tutorial = label.tutorial,
          streetEdgeId = calculatedStreetEdgeId,
          agreeCount = 0,
          disagreeCount = 0,
          unsureCount = 0,
          correct = None,
          severity = label.severity,
          description = label.description,
          tags = label.tagIds.distinct.flatMap(t => allTags.filter(_.tagId == t).map(_.tag).headOption).toList
        )
      )

      // Add an entry to the label_point table.
      _ <- labelPointTable.insert(
        LabelPoint(0, newLabelId, point.panoX, point.panoY, point.canvasX, point.canvasY, point.heading, point.pitch,
          point.zoom, point.lat, point.lng, pointGeom, point.computationMethod)
      )
    } yield {
      NewLabelData(newLabelId, label.temporaryLabelId, LabelTypeEnum.byName(label.labelType), label.panoSource,
        label.tutorial, timeCreated)
    }
  }

  def savePanoInfo(panos: Seq[PanoSubmission]): Future[Unit] = {
    val currTime: OffsetDateTime = OffsetDateTime.now
    val panoSubmissionActions    = panos.map { pano: PanoSubmission =>
      (for {
        // Insert new entry to pano_data table, or update the last_viewed/checked columns if we've already recorded it.
        panoExists: Boolean <- panoDataTable.panoramaExists(pano.panoId)
        _                   <-
          if (panoExists) {
            panoDataTable.updateFromExplore(pano.panoId, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch,
              pano.cameraRoll, pano.address, expired = false, currTime, Some(currTime))
          } else {
            panoDataTable.insert(
              PanoData(pano.panoId, pano.width, pano.height, pano.tileWidth, pano.tileHeight, pano.captureDate,
                pano.copyright, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.cameraRoll,
                expired = false, currTime, Some(currTime), currTime, pano.source, hasBackup = None,
                address = pano.address)
            )
          }
      } yield {
        // Once panorama is saved, save the links and history.
        val panoLinkInserts = pano.links.map { link =>
          panoLinkTable.insertIfNew(PanoLink(pano.panoId, link.targetPanoId, link.yawDeg, link.description))
        }
        val panoHistoryInserts = pano.history.map { h =>
          panoHistoryTable.insertIfNew(PanoHistory(h.panoId, h.date, pano.panoId))
        }

        // Run the pano_link and pano_history inserts in parallel.
        DBIO.sequence(panoLinkInserts).zip(DBIO.sequence(panoHistoryInserts)).map(_ => ())
      }).flatten
    }
    db.run(DBIO.sequence(panoSubmissionActions).map(_ => ()))
  }

  def insertComment(comment: AuditTaskComment): Future[Int] = {
    db.run(auditTaskCommentTable.insert(comment))
  }

  def insertNoImagery(taskSubmission: TaskSubmission, streetIssue: StreetEdgeIssue, missionId: Int): Future[Int] = {
    // Record the imagery issue for any mission type, but only mark the street complete (with the priority update that
    // entails) for regular audits: an exploreAddress task must never complete, so that a drop-in session at a spot
    // with no imagery can't mark the whole street as audited (#4451).
    def completeTaskAction(auditTaskId: Int, missionType: Option[MissionType.Value]): DBIO[Int] = {
      if (missionType.contains(MissionType.ExploreAddress)) DBIO.successful(0)
      else {
        for {
          _                  <- updateStreetPriority(streetIssue.streetEdgeId, streetIssue.userId)
          atRowsUpdated: Int <- auditTaskTable.updateCompleted(auditTaskId, completed = true)
        } yield atRowsUpdated
      }
    }

    db.run(missionTable.getMissionType(missionId).flatMap { missionType: Option[MissionType.Value] =>
      updateAuditTaskTable(streetIssue.userId, taskSubmission, missionId).flatMap { auditTaskId: Int =>
        completeTaskAction(auditTaskId, missionType)
          .zip(streetEdgeIssueTable.insert(streetIssue))
          .map(_._2)
      }
    })
  }

  /**
   * Returns existing entry in audit_task table for the AI user on the given street, or creates one if none exists.
   * @param missionId The mission_id to associate with the task if a new one is created
   * @param streetEdgeId The street_edge_id of the street to get/create a task for
   * @return The audit_task_id of the existing or newly created task, wrapped in a DBIO action
   */
  private def resumeOrCreateNewAiAuditTask(missionId: Int, streetEdgeId: Int): DBIO[Int] = {
    auditTaskTable
      .find(aiUserId, streetEdgeId)
      .flatMap {
        case Some(existingTask) =>
          DBIO.successful(existingTask.auditTaskId)
        case _ =>
          streetEdgeTable.getStreet(streetEdgeId).flatMap {
            case None =>
              DBIO.failed(new Exception(s"Street edge with ID $streetEdgeId not found."))
            case Some(street) =>
              // No existing task found, create a new one.
              auditTaskTable.insert(
                AuditTask(0, None, aiUserId, streetEdgeId, OffsetDateTime.now, OffsetDateTime.now, completed = false,
                  street.x1, street.y1, startPointReversed = false, Some(missionId), None, lowQuality = false,
                  incomplete = false, stale = false, auditedDistanceM = None)
              )
          }
      }
  }

  def submitAiLabelData(data: AiLabelsSubmission): Future[Seq[Unit]] = {
    val currTime: OffsetDateTime          = OffsetDateTime.now
    val dateFormatter                     = DateTimeFormatter.ofPattern("MM-dd-yyyy")
    val modelTrainingDate: OffsetDateTime = LocalDate
      .parse(data.modelTrainingDate, dateFormatter)
      .atStartOfDay(ZoneOffset.UTC)
      .toOffsetDateTime
    val pano = data.pano

    val labelSubmitActions = DBIO.sequence {
      data.labels.map { label =>
        // Calculate the label's lat/lng and theoretical user's heading/pitch from its panoX/panoY coordinates.
        val pov = PanoDataService.calculatePovFromPanoXY(label.panoX, label.panoY, pano.width.get, pano.height.get,
          pano.cameraHeading.get)
        val canvasX = LabelPointTable.canvasWidth / 2
        val canvasY = LabelPointTable.canvasHeight / 2
        val latLng  = PanoDataService.toLatLng(pano.lat.get, pano.lng.get, pov.heading, pov.zoom, canvasX, canvasY,
          label.panoY, pano.height.get)
        for {
          // Create necessary associated data for the label to fit in PS (mission, audit_task, etc.).
          streetEdgeId <- labelTable.getStreetEdgeIdClosestToLatLng(latLng._1, latLng._2)
          regionId     <- streetEdgeRegionTable.getNonDeletedRegionFromStreetId(streetEdgeId).map(_.get.regionId)
          missionId    <- missionService.resumeOrCreateNewAiExploreMission(regionId).map(_.missionId)
          auditTaskId  <- resumeOrCreateNewAiAuditTask(missionId, streetEdgeId)
          tempLabelId  <- labelTable.nextTempLabelId(aiUserId)

          // Create and insert the label and label_point entries.
          labelPoint: LabelPointSubmission = LabelPointSubmission(label.panoX, label.panoY, canvasX, canvasY,
            heading = pov.heading, pitch = pov.pitch, pov.zoom, lat = Some(latLng._1), lng = Some(latLng._2),
            computationMethod = Some(ComputationMethod.Approximation2))
          labelSubmission: LabelSubmission = LabelSubmission(
            panoId = pano.panoId,
            panoSource = pano.source,
            labelType = data.labelType,
            deleted = false,
            temporaryLabelId = tempLabelId,
            timeCreated = Some(currTime),
            tutorial = false,
            severity = None,
            description = None,
            tagIds = Seq.empty[Int],
            point = labelPoint
          )
          labelId <- insertLabel(labelSubmission, aiUserId, auditTaskId, streetEdgeId, missionId).map(_.labelId)
          _       <- labelAiInfoTable.save(
            LabelAiInfo(0, labelId, label.confidence, data.apiVersion, data.modelId, modelTrainingDate)
          )
        } yield ()
      }
    }
    db.run(labelSubmitActions.transactionally)
  }

  def submitExploreData(data: AuditTaskSubmission, userId: String): Future[ExploreTaskPostReturnValue] = {
    var refreshPage: Boolean = false // If we notice something out of whack, tell the front-end to refresh the page.
    val streetEdgeId: Int    = data.auditTask.streetEdgeId
    val missionId: Int       = data.missionProgress.missionId

    // Update the audit_task table and get the audit_task_id. This is needed to submit all other data.
    db.run(updateAuditTaskTable(userId, data.auditTask, missionId).flatMap { auditTaskId: Int =>
      missionTable.getMissionType(missionId).flatMap { missionType: Option[MissionType.Value] =>
        // If task is complete, mark it in the db and update the street priority. A normal audit is completed by the
        // client; a free-exploration drop-in has no such client signal, so the server derives it from how far the user
        // walked (#4451). Deriving it also means a forged completed=true can't mark a drop-in street audited.
        // Ordering is load-bearing: updateStreetPriority skips streets the user already completed, so it must read the
        // completed flag before updateCompleted flips it — flipping first would skip the one legitimate update, and it
        // is also what keeps re-running this action (every post-completion submission) from shifting priority again.
        val completeTaskAction: DBIO[Int] = for {
          newPriority: Option[Double] <- updateStreetPriority(streetEdgeId, userId)
          atRowsUpdated: Int          <- auditTaskTable.updateCompleted(auditTaskId, completed = true)
        } yield atRowsUpdated

        val taskCompletedAction: DBIO[Int] = missionType match {
          case Some(MissionType.Audit) if data.auditTask.completed.getOrElse(false) => completeTaskAction
          case Some(MissionType.ExploreAddress)                                     =>
            streetWalkedFarEnough(auditTaskId, streetEdgeId, data.auditTask.auditedDistanceM).flatMap {
              farEnough: Boolean => if (farEnough) completeTaskAction else DBIO.successful(0)
            }
          case _ => DBIO.successful(0)
        }

        // Add to the audit_task_user_route and user_route tables if we are on a route and not in the tutorial.
        val userRouteAction: DBIO[Boolean] =
          if (data.userRouteId.isDefined && missionType.contains(MissionType.Audit)) {
            for {
              _                      <- auditTaskUserRouteTable.insertIfNew(data.userRouteId.get, auditTaskId)
              routeComplete: Boolean <- userRouteTable.updateCompleteness(data.userRouteId.get)
            } yield routeComplete
          } else DBIO.successful(false)

        // Update the MissionTable.
        val updateMissionAction: DBIO[Option[Mission]] =
          missionService.updateMissionTableExplore(userId, data.missionProgress)

        // Insert any labels.
        val labelSubmitActions: Seq[DBIO[Option[NewLabelData]]] =
          data.labels.map { label: LabelSubmission =>
            val labelTypeId: Int = LabelTypeEnum.labelTypeToId(label.labelType)
            labelTable.find(label.temporaryLabelId, userId).flatMap {
              case Some(existingLabel) =>
                // If there is already a label with this temp id but a mismatched label type, the user probably has the
                // Explore page open in multiple browsers. Don't add the label; tell the front-end to refresh the page.
                if (existingLabel.labelTypeId != labelTypeId) {
                  refreshPage = true
                  DBIO.successful(None)
                } else {
                  // If the label exists and there are no issues, update it.
                  for {
                    // Map tag IDs to their string representations. Then update the label.
                    allTags: Seq[Tag] <- labelService.selectAllTags
                    tagStrings: List[String] = label.tagIds.distinct
                      .flatMap(t => allTags.filter(_.tagId == t).map(_.tag).headOption)
                      .toList
                    _ <- labelService.updateLabelFromExplore(existingLabel.labelId, label.deleted, label.severity,
                      label.description, tagStrings)
                  } yield None
                }
              // If there is no existing label with this temp id, insert a new one.
              case None => insertLabel(label, userId, auditTaskId, streetEdgeId, missionId).map(Some(_))
            }
          }

        // Check for streets in the user's neighborhood that have been audited by other users while they were auditing.
        val updatedStreetsAction: DBIO[Option[UpdatedStreets]] =
          if (data.auditTask.requestUpdatedStreetPriority) {
            // Get streetEdgeIds and priority values for streets that have been updated since lastPriorityUpdateTime.
            val lastPriorityUpdateTime: OffsetDateTime = data.auditTask.lastPriorityUpdateTime
            streetEdgePriorityTable
              .streetPrioritiesUpdatedSinceTime(data.missionProgress.regionId, lastPriorityUpdateTime)
              .map(updatedStreetPriorities => Some(UpdatedStreets(OffsetDateTime.now, updatedStreetPriorities)))
          } else {
            DBIO.successful(None)
          }

        // Zip the actions together so that they can be completed in parallel, returning result once all complete.
        taskCompletedAction
          .zip(userRouteAction)
          .zip(updateMissionAction)
          .zip(DBIO.sequence(labelSubmitActions))
          .zip(updatedStreetsAction)
          .map { case ((((_, _), possibleNewMission), newLabels), updatedStreets) =>
            ExploreTaskPostReturnValue(auditTaskId, possibleNewMission, newLabels.flatten, updatedStreets, refreshPage)
          }
      }
    }.transactionally)
  }

  def secondsSpentAuditing(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: OffsetDateTime): Future[Double] =
    db.run(auditTaskInteractionTable.secondsSpentAuditing(userId, timeRangeStartLabelId, timeRangeEnd))

  def selectTasksInRoute(userRouteId: Int): Future[Seq[NewTask]] =
    db.run(auditTaskTable.selectTasksInRoute(userRouteId))

  def shouldDisplaySurvey(userId: String): Future[Boolean] = {
    val numMissionsBeforeSurvey = 1
    db.run(for {
      surveyShown: Boolean   <- webpageActivityTable.findUserActivity("SurveyShown", userId).map(_.nonEmpty)
      completedMissions: Int <- missionTable
        .countCompletedMissions(userId, includeOnboarding = false, includeSkipped = true)
    } yield {
      completedMissions == numMissionsBeforeSurvey && !surveyShown
    })
  }

  def submitSurvey(userId: String, ipAddress: String, data: Seq[SurveySingleSubmission]): Future[Seq[Int]] = {
    db.run((for {
      numMissionsCompleted: Int <- missionTable
        .countCompletedMissions(userId, includeOnboarding = false, includeSkipped = true)
      allQuestions: Seq[SurveyQuestionWithOptions] <- surveyQuestionTable.listAllWithOptions
    } yield {
      val answeredQuestionIds: Seq[Int] = data.map(_.surveyQuestionId.toInt)
      val unansweredQuestions           = allQuestions.filter(q => !answeredQuestionIds.contains(q.surveyQuestionId))
      val timestamp: OffsetDateTime     = OffsetDateTime.now

      // Insert data on questions that were filled out.
      val answeredQuestionSubmits: Seq[DBIO[Int]] = data.map { q =>
        val question: SurveyQuestionWithOptions = allQuestions.find(_.surveyQuestionId == q.surveyQuestionId.toInt).get
        if (question.surveyInputType != "free-text-feedback") {
          val userSurveyOptionSubmission = UserSurveyOptionSubmission(0, userId, question.surveyQuestionId,
            Some(q.answerText.toInt), timestamp, numMissionsCompleted)
          userSurveyOptionSubmissionTable.insert(userSurveyOptionSubmission)
        } else {
          val userSurveyTextSubmission = UserSurveyTextSubmission(0, userId, question.surveyQuestionId,
            Some(q.answerText), timestamp, numMissionsCompleted)
          userSurveyTextSubmissionTable.insert(userSurveyTextSubmission)
        }
      }

      // Insert data on questions that were not filled out.
      val unansweredQuestionSubmits: Seq[DBIO[Int]] = unansweredQuestions.map { question =>
        if (question.surveyInputType != "free-text-feedback") {
          val userSurveyOptionSubmission =
            UserSurveyOptionSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
          userSurveyOptionSubmissionTable.insert(userSurveyOptionSubmission)
        } else {
          val userSurveyTextSubmission =
            UserSurveyTextSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
          userSurveyTextSubmissionTable.insert(userSurveyTextSubmission)
        }
      }
      DBIO.sequence(answeredQuestionSubmits ++ unansweredQuestionSubmits)
    }).flatten)
  }
}
