package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.amt.AMTAssignmentTable.VOLUNTEER_PAY
import models.audit.{AuditTaskTable, NewTask}
import models.label.LabelTable
import models.mission.{Mission, MissionTable, MissionTypeTable}
import models.region.{Region, RegionTable}
import models.route.{Route, RouteTable, UserRoute, UserRouteTable}
import models.user.UserCurrentRegionTable
import models.utils.{ConfigTable, MyPostgresProfile}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import play.api.Logger

case class ExplorePageData(task: Option[NewTask], mission: Mission, region: Region, userRoute: Option[UserRoute], hasCompletedAMission: Boolean, nextTempLabelId: Int, tutorialStreetId: Int, makeCrops: Boolean)

@ImplementedBy(classOf[ExploreServiceImpl])
trait ExploreService {
  def getDataForExplorePage(userId: String, retakingTutorial: Boolean, newRegion: Boolean, routeId: Option[Int], resumeRoute: Boolean): Future[ExplorePageData]
  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]]
}

@Singleton
class ExploreServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   configTable: ConfigTable,
                                   missionService: MissionService,
                                   regionTable: RegionTable,
                                   labelTable: LabelTable,
                                   missionTable: MissionTable,
                                   userCurrentRegionTable: UserCurrentRegionTable,
                                   routeTable: RouteTable,
                                   userRouteTable: UserRouteTable,
                                   auditTaskTable: AuditTaskTable,
                                   implicit val ec: ExecutionContext
                                 ) extends ExploreService with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

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
            case false => userCurrentRegionTable.assignRegion(userId)
          }
          case _ => userCurrentRegionTable.assignRegion(userId)
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
   * Check if there are tasks available for the user in the given region.
   */
  private def isTaskAvailable(user: String, regionId: Int): DBIO[Boolean] = {
    auditTaskTable.getStreetEdgeIdsNotAudited(user, regionId).map(_.nonEmpty)
  }

  def selectTasksInARegion(regionId: Int, userId: String): Future[Seq[NewTask]] = {
    db.run(auditTaskTable.selectTasksInARegion(regionId, userId))
  }
}
