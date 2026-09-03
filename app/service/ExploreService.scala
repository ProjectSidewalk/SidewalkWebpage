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
    route: Option[Route],
    routeResumed: Boolean,
    routeUnavailable: Boolean,
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
 * Outcome of route-walk setup for an Explore session: the walk to use (if any) and whether it pre-existed.
 *
 * @param routeUnavailable Whether a ?routeId= was supplied that names no live route, so the request was dropped
 *                         (#5156). The page tells the user rather than passing them off as an ordinary session.
 */
case class RouteWalkSetup(walk: Option[UserRoute], resumed: Boolean, routeUnavailable: Boolean = false)

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
   *
   * Each pano is saved independently and any failure is logged rather than thrown, so one bad pano can't abort the rest
   * of the batch (#4587). This is the lenient path for panos merely *viewed* during a session; a labeled pano's
   * metadata rides its label (LabelSubmission.pano) instead and commits atomically with it in submitExploreData.
   *
   * @param panos All pano-related data submitted from the Explore page front-end.
   * @return Whether every pano in the batch was saved successfully.
   */
  def savePanoInfo(panos: Seq[PanoSubmission]): Future[Boolean]
  def insertComment(comment: AuditTaskComment): Future[Int]

  /**
   * Logs a labeler's report of missing imagery to the street_edge_issue table. Evidence only: the task stays
   * incomplete and the street keeps its priority, whatever the mission type (#4918, #4922).
   * @param streetIssue The StreetIssue object to submit
   * @return The number of rows added to the street_edge_issue table (should always be 1)
   */
  def insertNoImagery(streetIssue: StreetEdgeIssue): Future[Int]

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
    labelEditService: LabelEditService,
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
      routeSetup: RouteWalkSetup <-
        if (regionId.isEmpty && streetEdgeId.isEmpty) {
          setUpPossibleUserRoute(routeId, userId, resumeRoute)
        } else {
          DBIO.successful(RouteWalkSetup(None, resumed = false))
        }
      userRoute = routeSetup.walk
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
        else {
          missionService.resumeOrCreateNewAuditMission(userId, regionId, userRoute).flatMap {
            case Some(m) => DBIO.successful(m)
            // A route with no distance left yields no route-scoped mission. Rather than 500 the page, drop the
            // user into a normal region session in the route's region.
            case None => missionService.resumeOrCreateNewAuditMission(userId, regionId, None).map(_.get)
          }
        }
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
          // If we find no task with the given ID, try to get any new task in the neighborhood. A task the labeler has
          // just reported for missing imagery is passed over the same way: the report leaves it incomplete (#4922),
          // so resuming it would hand back the street whose imagery would not load, on this load and every reload
          // after it. The street keeps its place in the pool for the offline checker to settle (#4918); this only
          // declines to serve it to the labeler who just bounced off it.
          auditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get).flatMap {
            case Some(currTask) =>
              streetEdgeIssueTable.reportedNoImagerySince(currTask.edgeId, userId, currTask.taskStart).flatMap {
                case true  => auditTaskTable.selectANewTaskInARegion(regionId, userId, mission.missionId)
                case false => DBIO.successful(Some(currTask))
              }
            case None => auditTaskTable.selectANewTaskInARegion(regionId, userId, mission.missionId)
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
      // The tutorial takes over the whole session, so a resumable route must not surface mid-tutorial: shipping its
      // id flips the client into route mode and draws the route over the tutorial map (#4816). Only the page payload
      // is suppressed — the walk stays active, so it resumes on the post-tutorial reload of /explore. (An explicit
      // ?routeId= still sets a walk up above, since that is the user asking for one; it just waits for them.)
      val (pageUserRoute, pageRoute) =
        if (updatedMission.missionType == MissionType.AuditOnboarding) (None, None) else (userRoute, routeOption)
      ExplorePageData(
        task,
        updatedMission,
        region.get,
        pageUserRoute,
        pageRoute,
        routeResumed = pageUserRoute.isDefined && routeSetup.resumed,
        routeSetup.routeUnavailable,
        hasCompletedAMission,
        nextTempLabelId,
        surveyData,
        tutorialStreetId,
        makeCrops
      )
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
                  ExplorePageData(task, updatedMission, region, userRoute = None, route = None, routeResumed = false,
                    routeUnavailable = false, hasCompletedAMission, nextTempLabelId, surveyData, tutorialStreetId,
                    makeCrops)
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
        // ST_LineLocatePoint gives the searched point's fraction along the street; the geodesic length of the line up
        // to that fraction converts it to meters directly comparable to the client's audited_distance_m (which turf
        // measures geodesically along the geometry). Scaling the street's total geodesic length by the fraction would
        // drift instead: the fraction is planar (degrees), and meters-per-degree differs by bearing at a given
        // latitude, so it doesn't equal the geodesic fraction on streets that bend.
        sql"""SELECT ST_Length(ST_LineSubstring(
                       street_edge.geom, 0,
                       ST_LineLocatePoint(street_edge.geom, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))
                     )::geography)
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

  /**
   * Resolves which route walk (if any) this Explore session should be in, creating/resuming/pausing as needed.
   *
   * Walks are paused rather than discarded wherever the user hasn't explicitly asked for a restart, so their
   * progress survives and an explicit ?routeId= visit resumes exactly where they left off (#4833). Discarding —
   * which permanently ends a walk, restarting the route from its first street next time — is reserved for
   * ?routeId=X&resumeRoute=false.
   *
   * A ?routeId= naming no live route is dropped instead of obeyed, so the session runs exactly as if none had been
   * supplied, and the caller reports the drop (#5156). It must not reach the exit-route arm: that arm is the
   * deliberate "leave my route" path, and letting a mistyped or since-deleted id land there paused a walk the user
   * was legitimately in.
   *
   * @param routeId     Route explicitly requested via ?routeId=, if any.
   * @param resumeRoute Whether an existing walk may be resumed (the ?resumeRoute= param; defaults to true).
   * @return            The walk this session should use (None for normal exploration), with whether the user is
   *                    resuming a walk they have already been in, and whether a requested route was dropped as
   *                    unresolvable. Existence of the row isn't enough for "resuming" — one can be created and never
   *                    entered, and that user is not resuming anything.
   */
  private def setUpPossibleUserRoute(
      routeId: Option[Int],
      userId: String,
      resumeRoute: Boolean
  ): DBIO[RouteWalkSetup] = {
    (routeId match {
      case Some(rId) => routeTable.getRoute(rId).map(_.isDefined)
      case None      => DBIO.successful(false)
    }).flatMap { routeExists =>
      val resolvedRouteId: Option[Int] = routeId.filter(_ => routeExists)
      val setup: DBIO[RouteWalkSetup]  = (resolvedRouteId, resumeRoute) match {
        // Pause routes that don't match routeId, resume route with given routeId if it exists, o/w make a new one.
        case (Some(rId), true) =>
          for {
            _      <- userRouteTable.pauseOtherActiveRoutes(rId, userId)
            result <- userRouteTable.getActiveRouteOrCreateNew(rId, userId)
            walked <-
              if (result._2) userRouteTable.hasBeenWalked(result._1.userRouteId) else DBIO.successful(false)
          } yield RouteWalkSetup(Some(result._1), resumed = walked)
        // Explicit restart: discard old walks (including any of this route), save a new one with given routeId.
        case (Some(rId), false) =>
          for {
            _      <- userRouteTable.discardAllActiveRoutes(userId)
            result <- userRouteTable.getActiveRouteOrCreateNew(rId, userId)
          } yield RouteWalkSetup(Some(result._1), resumed = false)
        // Get an in progress route (with any routeId) if it exists, otherwise return None.
        case (None, true) =>
          userRouteTable.getInProgressRoute(userId).flatMap {
            case Some(walk) =>
              userRouteTable.hasBeenWalked(walk.userRouteId).map(w => RouteWalkSetup(Some(walk), resumed = w))
            case None => DBIO.successful(RouteWalkSetup(None, resumed = false))
          }
        // The "exit route" path (/explore?resumeRoute=false): pause old walks, return None. Reachable only with an
        // explicit resumeRoute=false, which is the user asking to leave — never as the fallout of a bad routeId.
        case (None, false) =>
          userRouteTable.pauseAllActiveRoutes(userId).map(_ => RouteWalkSetup(None, resumed = false))
      }
      setup.map(_.copy(routeUnavailable = routeId.isDefined && !routeExists))
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
   * Length is measured with `::geography` (geodesic, the codebase-wide convention — #4641) which matters doubly here:
   * the value it is compared against — the client's `audited_distance_m` — is itself computed geodesically (turf), so
   * any other measure would skew the threshold (a fixed-UTM-zone projection inflates lengths ~25% in Amsterdam,
   * pushing it past the street's real length so it could never be reached).
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

    warnIfRecordStale(label, userId)

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
          labelType = LabelTypeEnum.withName(label.labelType),
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

  /**
   * Record-consistency tripwire (#4842): warn if a label's viewport record fails to reproduce its own pano_x/pano_y.
   *
   * The client derives pano_x/pano_y from this same record at click time, so a record that replays somewhere else
   * means a field went stale between click and submission -- the client-side race that silently corrupted records
   * for 18 months (2023-03 -> 2024-09) and that no test can reproduce, because it only exists in live client timing.
   * This is production telemetry, not validation: log-only by design, because a false positive must never cost a
   * contributor their label. Tutorial panos carry fabricated metadata and are skipped, as are submissions without a
   * pano metadata block. AI labels pass through: their records are computed by the inverse of this replay, so a
   * warning from them would flag drift between the two projections.
   *
   * The log line's `Label record mismatch (#4842):` prefix is a grep contract: a tripwire is only worth having if
   * something watches for it, so the sidewalk-panorama-tools log analyzer must track that exact signature (a rollout
   * prerequisite of the #4842 repair — "quiet for N months" is unmeasurable otherwise, see sunset review #4872).
   * Changing the prefix means updating the analyzer in the same change.
   *
   * @param label  The label submission to check, including its pano metadata block.
   * @param userId The submitting user, included in the log line for triage.
   */
  private def warnIfRecordStale(label: LabelSubmission, userId: String): Unit = {
    val point: LabelPointSubmission = label.point
    if (!label.tutorial) {
      for {
        panoData   <- label.pano
        width      <- panoData.width
        height     <- panoData.height
        camHeading <- panoData.cameraHeading
        if width > 0 && height > 0
      } {
        val labelPov =
          PanoDataService.calculatePovIfCentered(
            POV(point.heading, point.pitch, point.zoom),
            point.canvasX.toDouble,
            point.canvasY.toDouble
          )
        val (expectedX, expectedY) = PanoDataService.calculatePanoXYFromPov(labelPov, camHeading, width, height)
        val dxPx                   = { val d = math.abs(point.panoX - expectedX); math.min(d, width - d) }
        val mismatchDeg            = math.hypot(dxPx * 360.0 / width, (point.panoY - expectedY) * 180.0 / height)
        if (mismatchDeg > PanoDataService.RECORD_MISMATCH_TOLERANCE_DEG) {
          logger.warn(
            s"Label record mismatch (#4842): user=$userId tempLabelId=${label.temporaryLabelId} " +
              s"pano=${label.panoId} stored pano_x/y=(${point.panoX}, ${point.panoY}) " +
              s"record replays to=($expectedX, $expectedY) mismatch=${f"$mismatchDeg%.3f"}deg " +
              s"record=(h=${point.heading}, p=${point.pitch}, z=${point.zoom}, " +
              s"canvas=${point.canvasX},${point.canvasY})"
          )
        }
      }
    }
  }

  /**
   * Saves one pano's metadata: an upsert of its pano_data row, then any new pano_link / pano_history rows.
   *
   * The upsert never clears a saved address or source_metadata blob with an absent one (#4806); see
   * PanoDataTable.upsert. Every statement is idempotent, so the action is safe to repeat.
   */
  private def savePanoAction(pano: PanoSubmission, timestamp: OffsetDateTime): DBIO[Unit] = {
    for {
      _ <- panoDataTable.upsert(
        PanoData(pano.panoId, pano.width, pano.height, pano.tileWidth, pano.tileHeight, pano.captureDate,
          pano.copyright, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.cameraRoll, expired = false,
          timestamp, Some(timestamp), timestamp, pano.source, hasBackup = None, address = pano.address,
          sourceMetadata = pano.sourceMetadata)
      )

      // Once panorama is saved, save the links and history. Run the two groups in parallel.
      _ <- DBIO
        .sequence(pano.links.map { link =>
          panoLinkTable.insertIfNew(PanoLink(pano.panoId, link.targetPanoId, link.yawDeg, link.description))
        })
        .zip(DBIO.sequence(pano.history.map { h =>
          panoHistoryTable.insertIfNew(PanoHistory(h.panoId, h.date, pano.panoId))
        }))
    } yield ()
  }

  def savePanoInfo(panos: Seq[PanoSubmission]): Future[Boolean] = {
    val currTime: OffsetDateTime = OffsetDateTime.now
    // asTry so one pano's failure can't abort the rest of the batch; failures are logged below.
    val panoSubmissionActions = panos.map { pano: PanoSubmission => savePanoAction(pano, currTime).asTry }

    db.run(DBIO.sequence(panoSubmissionActions))
      .map { results =>
        results.zip(panos).foreach { case (result, pano) =>
          result.failed.foreach(e => logger.error(s"Failed to save pano metadata for pano ${pano.panoId}.", e))
        }
        results.forall(_.isSuccess)
      }
      .recover {
        case e => // A failure of the batch itself, e.g. no connection available.
          logger.error("Failed to save submitted pano metadata.", e)
          false
      }
  }

  def insertComment(comment: AuditTaskComment): Future[Int] = {
    db.run(auditTaskCommentTable.insert(comment))
  }

  /**
   * Records a labeler's report that a street's imagery failed to load, without crediting anyone with an audit.
   *
   * The report is evidence, not a verdict: one session's failure to load imagery is unreliable (transient GSV
   * failures forge it wholesale, #4918), so it must not complete the task, drop the street's priority, or count
   * toward region completion or the user's audited distance. The street stays open and un-audited for everyone.
   * Streets that genuinely lack imagery leave the pool when the offline checker (check_streets_for_imagery.py ->
   * street_edge.status = 'no_imagery') confirms the accumulated street_edge_issue reports (#4922).
   *
   * The issue row is the whole write. The audit task is deliberately left alone: it stays live and resumable now that
   * a report doesn't complete it, and the report carries no record of where the labeler had walked to — so writing
   * the task's progress from it would rewind their position to the street's start and null out the distance they had
   * covered. street_edge_issue references the street and the user directly, so it stands on its own.
   *
   * @param streetIssue The report itself, one street_edge_issue row.
   * @return The number of street_edge_issue rows inserted (1).
   */
  def insertNoImagery(streetIssue: StreetEdgeIssue): Future[Int] = {
    db.run(streetEdgeIssueTable.insert(streetIssue))
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
        // label_point.canvas_x/y are NOT NULL, but an AI label was never drawn on a canvas. The center is the one
        // value consistent with the heading/pitch stored beside it, which is the POV that centers the label.
        val canvasX = LabelPointTable.canvasWidth / 2
        val canvasY = LabelPointTable.canvasHeight / 2
        val latLng  = PanoDataService.toLatLng(pano.lat.get, pano.lng.get, label.panoX, label.panoY, pano.width.get,
          pano.height.get, pano.cameraHeading.get)
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
            computationMethod = Some(ComputationMethod.Approximation3))
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
            point = labelPoint,
            pano = Some(pano)
          )
          labelId <- insertLabel(labelSubmission, aiUserId, auditTaskId, streetEdgeId, missionId).map(_.labelId)
          _       <- labelAiInfoTable.save(
            LabelAiInfo(0, labelId, label.confidence, data.apiVersion, data.modelId, modelTrainingDate)
          )
        } yield ()
      }
    }
    // The pano's metadata is integral to its labels (#4587): writing it in the same transaction means a label can
    // never be committed without its pano_data row, and a failed pano write fails the whole request.
    db.run(savePanoAction(pano, currTime).andThen(labelSubmitActions).transactionally)
  }

  def submitExploreData(data: AuditTaskSubmission, userId: String): Future[ExploreTaskPostReturnValue] = {
    var refreshPage: Boolean = false // If we notice something out of whack, tell the front-end to refresh the page.
    val streetEdgeId: Int    = data.auditTask.streetEdgeId
    val missionId: Int       = data.missionProgress.missionId

    // Each label's pano metadata is integral to the label (#4587): writing it in the same transaction as the labels
    // means a label can never be committed without its pano_data row, and a failed pano write takes the whole
    // submission with it rather than quietly producing an orphan.
    val labeledPanos: Seq[PanoSubmission]  = data.labels.flatMap(_.pano).distinctBy(_.panoId).sortBy(_.panoId)
    val saveLabeledPanosAction: DBIO[Unit] = DBIO.seq(labeledPanos.map(savePanoAction(_, OffsetDateTime.now)): _*)

    // Update the audit_task table and get the audit_task_id. This is needed to submit all other data.
    val submitAction: DBIO[ExploreTaskPostReturnValue] = updateAuditTaskTable(userId, data.auditTask, missionId)
      .flatMap { auditTaskId: Int =>
        missionTable.getMissionType(missionId).flatMap { missionType: Option[MissionType.Value] =>
          // If task is complete, mark it in the db and update the street priority. A normal audit is completed by the
          // client; a free-exploration drop-in has no such client signal, so the server derives it from how far the
          // user walked (#4451). Deriving it also means a forged completed=true can't mark a drop-in street audited.
          // Ordering is load-bearing: updateStreetPriority skips streets the user already completed, so it must read
          // the completed flag before updateCompleted flips it — flipping first would skip the one legitimate update,
          // and it is also what keeps re-running this action from shifting priority again.
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
                _ <- auditTaskUserRouteTable.insertIfNew(
                  data.userRouteId.get,
                  auditTaskId,
                  data.auditTask.routeStreetId
                )
                routeComplete: Boolean <- userRouteTable.updateCompleteness(data.userRouteId.get)
              } yield routeComplete
            } else DBIO.successful(false)

          // Update the MissionTable.
          val updateMissionAction: DBIO[Option[Mission]] =
            missionService.updateMissionTableExplore(userId, data.missionProgress)

          // Insert any labels.
          val labelSubmitActions: Seq[DBIO[Option[NewLabelData]]] =
            data.labels.map { label: LabelSubmission =>
              val labelType: LabelTypeEnum.Base = LabelTypeEnum.withName(label.labelType)
              labelTable.find(label.temporaryLabelId, userId).flatMap {
                case Some(existingLabel) =>
                  // If there is already a label with this temp id but a mismatched label type, the user probably has the
                  // Explore page open in multiple browsers. Don't add the label; tell the front-end to refresh the page.
                  if (existingLabel.labelType != labelType) {
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
                      _ <- labelEditService.updateLabelFromExplore(existingLabel.labelId, label.deleted, label.severity,
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
              ExploreTaskPostReturnValue(auditTaskId, possibleNewMission, newLabels.flatten, updatedStreets,
                refreshPage)
            }
        }
      }

    db.run(saveLabeledPanosAction.andThen(submitAction).transactionally)
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
