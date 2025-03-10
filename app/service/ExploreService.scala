package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import formats.json.TaskSubmissionFormats._
import models.amt.AMTAssignmentTable.VOLUNTEER_PAY
import models.audit.{AuditTask, AuditTaskEnvironment, AuditTaskEnvironmentTable, AuditTaskIncomplete, AuditTaskIncompleteTable, AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable, NewTask}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable, PanoHistory, PanoHistoryTable}
import models.label.{Label, LabelPoint, LabelPointTable, LabelTable, LabelTypeTable, Tag}
import models.mission.{Mission, MissionTable, MissionTypeTable}
import models.region.{Region, RegionCompletionTable, RegionTable}
import models.route.{AuditTaskUserRouteTable, Route, RouteTable, UserRoute, UserRouteTable}
import models.street.{StreetEdgePriority, StreetEdgePriorityTable}
import models.user.UserCurrentRegionTable
import models.utils.{ConfigTable, MyPostgresProfile}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import org.geotools.geometry.jts.JTSFactoryFinder
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Point}
import play.api.Logger

import java.time.OffsetDateTime

case class ExplorePageData(task: Option[NewTask], mission: Mission, region: Region, userRoute: Option[UserRoute], hasCompletedAMission: Boolean, nextTempLabelId: Int, tutorialStreetId: Int, makeCrops: Boolean)
case class ExploreTaskPostReturnValue(auditTaskId: Int, mission: Option[Mission], newLabels: Seq[(Int, Int, OffsetDateTime)], updatedStreets: Option[UpdatedStreets])
case class UpdatedStreets(lastPriorityUpdateTime: OffsetDateTime, updatedStreetPriorities: Seq[StreetEdgePriority])

@ImplementedBy(classOf[ExploreServiceImpl])
trait ExploreService {
  def getDataForExplorePage(userId: String, retakingTutorial: Boolean, newRegion: Boolean, routeId: Option[Int], resumeRoute: Boolean): Future[ExplorePageData]
  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]]
  def insertEnvironment(env: AuditTaskEnvironment): Future[Int]
  def insertMultipleInteractions(interactions: Seq[AuditTaskInteraction]): Future[Unit]
  def savePanoInfo(gsvPanoramas: Seq[GSVPanoramaSubmission]): Future[Unit]
  def submitExploreData(data: AuditTaskSubmission, userId: String): Future[ExploreTaskPostReturnValue]
  def secondsSpentAuditing(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: OffsetDateTime): Future[Float]
}

@Singleton
class ExploreServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
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
                                   auditTaskIncompleteTable: AuditTaskIncompleteTable,
                                   auditTaskUserRouteTable: AuditTaskUserRouteTable,
                                   streetEdgePriorityTable: StreetEdgePriorityTable,
                                   regionCompletionTable: RegionCompletionTable,
                                   gsvDataTable: GSVDataTable,
                                   gsvLinkTable: GSVLinkTable,
                                   panoHistoryTable: PanoHistoryTable,
                                   implicit val ec: ExecutionContext
                                  ) extends ExploreService with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)
  val gf: GeometryFactory = JTSFactoryFinder.getGeometryFactory

  def getDataForExplorePage(userId: String, retakingTutorial: Boolean, newRegion: Boolean, routeId: Option[Int], resumeRoute: Boolean): Future[ExplorePageData] = {
    def getExploreDataAction = for {
      // Check if user has an active route or create a new one if routeId was supplied. If resumeRoute is false and no
      // routeId was supplied, then the function should return None and the user is not sent on a specific route.
      userRoute: Option[UserRoute] <- setUpPossibleUserRoute(routeId, userId, resumeRoute)
      route: Option[Route] <- userRoute.map(ur => routeTable.getRoute(ur.routeId)).getOrElse(DBIO.successful(None))

      // If user is on a specific route, assign them to the correct region. If newRegion is false and they already have
      // an assigned region (that has tasks remaining to do), use their current region. Otherwise, assign a new region.
      currRegion: Option[Region] <- userCurrentRegionTable.getCurrentRegion(userId)
      region: Option[Region] <- {
        (route, newRegion, currRegion) match {
          case (Some(r), _, _) => userCurrentRegionTable.insertOrUpdate(userId, r.regionId).flatMap(rId => regionTable.getRegion(rId))
          case (_, false, Some(r)) => isTaskAvailable(userId, r.regionId).flatMap {
            case true => DBIO.successful(currRegion)
            case false => assignRegion(userId)
          }
          case _ => assignRegion(userId)
        }
      }
      regionId: Int = region.get.regionId

      mission: Mission <- {
        if (retakingTutorial) missionService.resumeOrCreateNewAuditOnboardingMission(userId, VOLUNTEER_PAY).map(_.get)
        else missionService.resumeOrCreateNewAuditMission(userId, regionId, VOLUNTEER_PAY, VOLUNTEER_PAY).map(_.get)
      }

      // If there is a partially completed task in this route or mission, get that, o/w make a new one.
      task: Option[NewTask] <- {
        if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding") {
          auditTaskTable.getATutorialTask(mission.missionId).map(Some(_))
        } else if (route.isDefined) {
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
          missionService.updateExploreProgressOnly(userId, mission.missionId, mission.distanceProgress.getOrElse(0F), task.get.auditTaskId)
            .flatMap(_ => missionTable.getMission(mission.missionId).map(_.get))
        } else {
          DBIO.successful(mission)
        }
      }

      // Check if they have already completed an explore mission. Used on front end to decide whether to suggest a
      // Validate or Explore mission.
      hasCompletedAMission: Boolean <- missionTable.countCompletedMissions(userId, missionType = "audit").map(_ > 0)

      tutorialStreetId: Int <- configTable.getTutorialStreetId
      makeCrops: Boolean <- configTable.getMakeCrops
    } yield {
      ExplorePageData(task, updatedMission, region.get, userRoute, hasCompletedAMission, nextTempLabelId, tutorialStreetId, makeCrops)
    }
    db.run(getExploreDataAction.transactionally)
  }

  private def setUpPossibleUserRoute(routeId: Option[Int], userId: String, resumeRoute: Boolean): DBIO[Option[UserRoute]] = {
    (routeId match {
      case Some(rId) => routeTable.getRoute(rId).map(_.isDefined)
      case None => DBIO.successful(false)
    }).flatMap { routeExists =>
      (routeExists, routeId, resumeRoute) match {
        // Discard routes that don't match routeId, resume route with given routeId if it exists, o/w make a new one.
        case (true, Some(rId), true) =>
          for {
            _ <- userRouteTable.discardOtherActiveRoutes(rId, userId)
            result <- userRouteTable.getActiveRouteOrCreateNew(rId, userId)
          } yield Some(result)
        // Discard old routes, save a new one with given routeId.
        case (true, Some(rId), false) =>
          for {
            _ <- userRouteTable.discardAllActiveRoutes(userId)
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
      highPriorityRegion <- regionTable.selectAHighPriorityRegion(finishedRegions)
    } yield highPriorityRegion
  }

  /**
   * Select a region with high avg street priority where the user hasn't explored every street; assign it to them.
   */
  def assignRegion(userId: String): DBIO[Option[Region]] = {
    for {
      newRegion <- selectAHighPriorityRegion(userId)
      // If region successfully selected, assign it to them.
      regionId <- newRegion match {
        case Some(region) => userCurrentRegionTable.insertOrUpdate(userId, region.regionId)
        case None => DBIO.successful(-1)
      }
    } yield newRegion
  }

  /**
   * Check if there are tasks available for the user in the given region.
   */
  private def isTaskAvailable(user: String, regionId: Int): DBIO[Boolean] = {
    auditTaskTable.getStreetEdgeIdsNotAudited(user, regionId).map(_.nonEmpty)
  }

  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]] = {
    db.run(auditTaskTable.selectTasksInARegion(regionId, userId))
  }

  def insertEnvironment(env: AuditTaskEnvironment): Future[Int] = {
    db.run(auditTaskEnvironmentTable.insert(env))
  }

  def insertMultipleInteractions(interactions: Seq[AuditTaskInteraction]): Future[Unit] = {
    db.run(auditTaskInteractionTable.insertMultiple(interactions))
  }

  /**
   * Insert or update the submitted audit task in the database.
   */
  private def updateAuditTaskTable(userId: String, task: TaskSubmission, missionId: Int): DBIO[Int] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now
    if (task.auditTaskId.isDefined) {
      // Update the existing audit task row (don't update if they are in the tutorial).
      val id: Int = task.auditTaskId.get
      for {
        missionType <- missionTable.getMissionType(missionId)
        _ <- if (missionType.contains("audit")) {
          auditTaskTable.updateTaskProgress(id, timestamp, task.currentLat, task.currentLng, missionId, task.currentMissionStart)
        } else DBIO.successful(())
      } yield {
        id
      }
    } else {
      // Insert the new audit task.
      auditTaskTable.insert(AuditTask(0, None, userId, task.streetEdgeId, task.taskStart, timestamp,
        completed=false, task.currentLat, task.currentLng, task.startPointReversed, Some(missionId),
        task.currentMissionStart, lowQuality=false, incomplete=false, stale=false))
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
      priorityBefore: Option[Double] <- streetEdgePriorityTable.streetPrioritiesFromIds(Seq(streetEdgeId))
        .map(_.headOption.map(_.priority))
      // Update the street's priority only if the user has not completed this street previously.
      userAlreadyAudited: Boolean <- auditTaskTable.userHasAuditedStreet(streetEdgeId, userId)
      priorityAfter: Option[Double] <- if (!userAlreadyAudited) {
        streetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, userId)
      } else DBIO.successful(None)

      // If street priority went from 1 to < 1 due to this audit, update the region_completion table accordingly.
      _ <-
        if (priorityBefore.contains(1.0D) && priorityAfter.exists(_ < 1.0D)) {
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
   * @return (label_id, temporary_label_id, time_created) for the new label. Data used for logging and SciStarter.
   */
  private def insertLabel(label: LabelSubmission, userId: String, auditTaskId: Int, taskStreetId: Int, missionId: Int): DBIO[(Int, Int, OffsetDateTime)] = {
    // Get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp.
    val timeCreated: OffsetDateTime = label.timeCreated match {
      case Some(time) => time
      case None =>
        logger.error("No timestamp given for a new label, using current time instead.")
        OffsetDateTime.now
    }

    // Create the Point geometry from the provided lat/lng.
    val point: LabelPointSubmission = label.point
    val pointGeom: Option[Point] = for {
      _lat <- point.lat
      _lng <- point.lng
    } yield gf.createPoint(new Coordinate(_lng.toDouble, _lat.toDouble))

    for {
      // Use label's lat/lng to determine street_edge_id. If lat/lng isn't defined, use audit_task's as backup.
      calculatedStreetEdgeId: Int <- (point.lat, point.lng) match {
        case (Some(lat), Some(lng)) => labelTable.getStreetEdgeIdClosestToLatLng(lat, lng)
        case _ => DBIO.successful(taskStreetId)
      }

      // Add the new entry to the label table.
      allTags: Seq[Tag] <- labelService.selectAllTags
      newLabelId: Int <- labelService.insertLabel(Label(0, auditTaskId, missionId, userId, label.gsvPanoramaId,
        LabelTypeTable.labelTypeToId(label.labelType), label.deleted, label.temporaryLabelId, timeCreated,
        label.tutorial, calculatedStreetEdgeId, 0, 0, 0, None, label.severity, label.temporary, label.description,
        label.tagIds.distinct.flatMap(t => allTags.filter(_.tagId == t).map(_.tag).headOption).toList))

      // Add an entry to the label_point table.
      _ <- labelPointTable.insert(LabelPoint(0, newLabelId, point.panoX, point.panoY, point.canvasX, point.canvasY,
        point.heading, point.pitch, point.zoom, point.lat, point.lng, pointGeom, point.computationMethod))
    } yield {
      (newLabelId, label.temporaryLabelId, timeCreated)
    }
  }

  /**
   * Takes data submitted from the Explore page updates the gsv_data, gsv_link, and pano_history tables accordingly.
   * @param gsvPanoramas All pano-related data submitted from the Explore page front-end.
   * @return
   */
  def savePanoInfo(gsvPanoramas: Seq[GSVPanoramaSubmission]): Future[Unit] = {
    val currTime: OffsetDateTime = OffsetDateTime.now
    val panoSubmissionActions = gsvPanoramas.map { pano: GSVPanoramaSubmission =>
      (for {
        // Insert new entry to gsv_data table, or update the last_viewed/checked columns if we've already recorded it.
        panoExists: Boolean <- gsvDataTable.panoramaExists(pano.gsvPanoramaId)
        _ <- if (panoExists) {
          gsvDataTable.updateFromExplore(pano.gsvPanoramaId, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, expired = false, currTime, Some(currTime))
        } else {
          gsvDataTable.insert(GSVData(pano.gsvPanoramaId, pano.width, pano.height, pano.tileWidth, pano.tileHeight,
            pano.captureDate, pano.copyright, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, expired = false,
            currTime, Some(currTime), currTime))
        }
      } yield {
        // Once panorama is saved, save the links and history.
        val panoLinkInserts = pano.links.map { link =>
          gsvLinkTable.linkExists(pano.gsvPanoramaId, link.targetGsvPanoramaId).map {
            case false =>
              gsvLinkTable.insert(GSVLink(pano.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, link.description))
            case true => DBIO.successful("")
          }
        }
        val panoHistoryInserts = pano.history.map { h =>
          panoHistoryTable.insertIfNew(PanoHistory(h.panoId, h.date, pano.gsvPanoramaId))
        }

        // Run the gsv_link and pano_history inserts in parallel.
        DBIO.sequence(panoLinkInserts).zip(DBIO.sequence(panoHistoryInserts)).map(_ => ())
      }).flatten
    }
    db.run(DBIO.sequence(panoSubmissionActions).map(_ => ()))
  }

  /**
   * Takes data submitted from the Explore page and updates the database accordingly.
   *
   * @param data All data submitted from front-end.
   * @param userId The user_id of the user who submitted the data.
   * @return
   */
  def submitExploreData(data: AuditTaskSubmission, userId: String): Future[ExploreTaskPostReturnValue] = {
    var refreshPage: Boolean = false // If we notice something out of whack, tell the front-end to refresh the page.
    val streetEdgeId: Int = data.auditTask.streetEdgeId
    val missionId: Int = data.missionProgress.missionId

    // Update the audit_task table and get the audit_task_id and region_id. These are needed to submit all other data.
    db.run((for {
      auditTaskId: Int <- updateAuditTaskTable(userId, data.auditTask, missionId)
      regionId: Int <- userCurrentRegionTable.getCurrentRegion(userId).map(_.get.regionId)
    } yield {
      // If task is complete or the user skipped with `GSVNotAvailable`, mark the task as complete.
      val taskCompletedAction: DBIO[Int] =
        if (data.auditTask.completed.getOrElse(false) || data.incomplete.exists(_.issueDescription == "GSVNotAvailable")) {
          for {
            newPriority: Option[Double] <- updateStreetPriority(streetEdgeId, userId)
            atRowsUpdated: Int <- auditTaskTable.updateCompleted(auditTaskId, completed = true)
          } yield atRowsUpdated
        } else DBIO.successful(0)

      // Add to the audit_task_user_route and user_route tables if we are on a route and not in the tutorial.
      val userRouteAction: DBIO[Boolean] = missionTable.getMissionType(missionId).flatMap { missionType: Option[String] =>
        if (data.userRouteId.isDefined && missionType.contains("audit")) {
          for {
            _ <- auditTaskUserRouteTable.insertIfNew(data.userRouteId.get, auditTaskId)
            routeComplete: Boolean <- userRouteTable.updateCompleteness(data.userRouteId.get)
          } yield routeComplete
        } else DBIO.successful(false)
      }

      // Update the MissionTable.
      val updateMissionAction: DBIO[Option[Mission]] = missionService.updateMissionTableExplore(userId, regionId, data.missionProgress)

      // Insert the skip information.
      val taskIncompleteAction: DBIO[Int] = if (data.incomplete.isDefined) {
        val incomplete: IncompleteTaskSubmission = data.incomplete.get
        auditTaskIncompleteTable.insert(AuditTaskIncomplete(0, auditTaskId, missionId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
      } else DBIO.successful(0)

      // Insert any labels.
      val labelSubmitActions: Seq[DBIO[Option[(Int, Int, OffsetDateTime)]]] = data.labels.map { label: LabelSubmission =>
        val labelTypeId: Int = LabelTypeTable.labelTypeToId(label.labelType)
        labelTable.find(label.temporaryLabelId, userId).flatMap {
          case Some(existingLabel) =>
            // If there is already a label with this temp id but a mismatched label type, the user probably has the
            // Explore page open in multiple browsers. Don't add the label, and tell the front-end to refresh the page.
            // TODO let's just throw an error here?
            if (existingLabel.labelTypeId != labelTypeId) {
              refreshPage = true
              DBIO.successful(None)
            } else {
              // If the label exists and there are no issues, update it.
              for {
                // Map tag IDs to their string representations. Then update the label.
                allTags: Seq[Tag] <- labelService.selectAllTags
                tagStrings: List[String] = label.tagIds.distinct.flatMap(t => allTags.filter(_.tagId == t).map(_.tag).headOption).toList
                _ <- labelService.updateLabelFromExplore(existingLabel.labelId, label.deleted, label.severity, label.temporary, label.description, tagStrings)
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
          streetEdgePriorityTable.streetPrioritiesUpdatedSinceTime(regionId, lastPriorityUpdateTime)
            .map(updatedStreetPriorities => Some(UpdatedStreets(OffsetDateTime.now, updatedStreetPriorities)))
        } else {
          DBIO.successful(None)
        }

      // Zip the actions together so that they can be completed in parallel, returning result once all complete.
      taskCompletedAction.zip(userRouteAction).zip(updateMissionAction)
        .zip(taskIncompleteAction).zip(DBIO.sequence(labelSubmitActions)).zip(updatedStreetsAction).map {
          case (((((_, _), possibleNewMission), _), newLabels), updatedStreets) =>
            ExploreTaskPostReturnValue(auditTaskId, possibleNewMission, newLabels.flatten, updatedStreets)
      }
    }).flatten.transactionally)
  }

  def secondsSpentAuditing(userId: String, timeRangeStartLabelId: Int, timeRangeEnd: OffsetDateTime): Future[Float] = {
    db.run(auditTaskInteractionTable.secondsSpentAuditing(userId, timeRangeStartLabelId, timeRangeEnd))
  }
}
