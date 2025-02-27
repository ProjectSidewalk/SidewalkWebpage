package controllers

import javax.inject.{Inject, Singleton}
import controllers.base._
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import org.locationtech.jts.geom._
import controllers.helper.ControllerUtils.isAdmin
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.label.LabelTable
import models.mission.{Mission, MissionSetProgress, MissionTable, MissionTypeTable}
import play.api.Configuration

import scala.concurrent.ExecutionContext
//import models.attribute.ConfigTable
import models.region._
//import models.route.{Route, RouteTable, UserRoute, UserRouteTable}
import models.street.StreetEdgeRegionTable
import models.user._
//import models.utils.{CityInfo, Configs}
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.mvc._

import scala.concurrent.Future

@Singleton
class AuditController @Inject() (
                                  cc: CustomControllerComponents,
                                  val silhouette: Silhouette[DefaultEnv],
                                  val config: Configuration,
                                  configService: service.utils.ConfigService,
                                  exploreService: service.ExploreService
                                )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns an explore page.
    */
  def explore(newRegion: Boolean, retakeTutorial: Option[Boolean], routeId: Option[Int], resumeRoute: Boolean) = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    for {
      exploreData <- exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion, routeId, resumeRoute)
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      // Log visit to the Explore page.
      val activityStr: String =
        if (exploreData.userRoute.isDefined) s"Visit_Audit_RouteId=${exploreData.userRoute.get.routeId}"
        else if (newRegion)                   "Visit_Audit_NewRegionSelected"
        else                                  "Visit_Audit"
      cc.loggingService.insert(user.userId, request.remoteAddress, activityStr)

      Ok(views.html.explore(commonData, "Project Sidewalk - Explore", user, exploreData))
    }
  }

  /**
    * Explore a given region.
    */
//  def exploreRegion(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val userId: UUID = user.userId
//        val timestamp: OffsetDateTime = OffsetDateTime.now
//        val ipAddress: String = request.remoteAddress
//        val regionOption: Option[Region] = RegionTable.getRegion(regionId)
//        cc.loggingService.insert(WebpageActivity(0, userId.toString, ipAddress, "Visit_Audit", timestamp))
//
//        // Update the currently assigned region for the user.
//        regionOption match {
//          case Some(region) =>
//            UserCurrentRegionTable.insertOrUpdate(userId, regionId)
//            val role: String = user.role.getOrElse("")
//            val payPerMeter: Double =
//              if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
//            val tutorialPay: Double =
//              if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
//            val mission: Mission =
//              MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
//
//            val missionSetProgress: MissionSetProgress =
//              if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
//              else MissionTable.defaultAuditMissionSetProgress
//
//            // If there is a partially completed task in this mission, get that, o/w make a new one.
//            val task: Option[NewTask] =
//              if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding")
//                Some(AuditTaskTable.getATutorialTask(mission.missionId))
//              else if (mission.currentAuditTaskId.isDefined)
//                AuditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get)
//              else
//                AuditTaskTable.selectANewTaskInARegion(regionId, user.userId, mission.missionId)
//            val nextTempLabelId: Int = LabelTable.nextTempLabelId(userId)
//
//            // Check if they have already completed an audit mission. We send them to /validate after their first audit.
//            // mission, but only after every third explore mission after that.
//            val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0
//
//            val cityInfo: List[CityInfo] = Configs.getAllCityInfo(request2Messages.lang)
//            val tutorialStreetId: Int = ConfigTable.getTutorialStreetId
//            val makeCrops: Boolean = ConfigTable.getMakeCrops
//            if (missionSetProgress.missionType != "audit") {
//              Future.successful(Redirect("/validate"))
//            } else {
//              Future.successful(Ok(views.html.explore("Project Sidewalk - Audit", task, mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityInfo, tutorialStreetId, makeCrops)))
//            }
//          case None =>
//            Logger.error(s"Tried to explore region $regionId, but there is no neighborhood with that id.")
//            Future.successful(Redirect("/explore"))
//        }
//
//      case None =>
//        Future.successful(Redirect(s"/anonSignUp?url=/explore/region/$regionId"))
//    }
//  }

  /**
    * Explore a given street. Optionally, a researcher can be placed at a specific lat/lng or panorama.
    */
//  def exploreStreet(streetEdgeId: Int, lat: Option[Double], lng: Option[Double], panoId: Option[String]) = cc.securityService.SecuredAction { implicit request =>
//    val startAtPano: Boolean = panoId.isDefined
//    val startAtLatLng: Boolean = lat.isDefined && lng.isDefined
//    request.identity match {
//      case Some(user) =>
//        val userId: UUID = user.userId
//        val regionOption: Option[Region] = StreetEdgeRegionTable.getNonDeletedRegionFromStreetId(streetEdgeId)
//
//        if (regionOption.isEmpty) {
//          Logger.error(s"Either there is no region associated with street edge $streetEdgeId, or it is not a valid id.")
//          Future.successful(Redirect("/explore"))
//        } else {
//          val region: Region = regionOption.get
//          val regionId: Int = region.regionId
//          UserCurrentRegionTable.insertOrUpdate(userId, regionId)
//
//          val role: String = user.role.getOrElse("")
//          val payPerMeter: Double =
//            if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
//          val tutorialPay: Double =
//            if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
//          var mission: Mission =
//            MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
//          val task: NewTask =
//            if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding")
//              AuditTaskTable.getATutorialTask(mission.missionId)
//            else
//              AuditTaskTable.selectANewTask(streetEdgeId, mission.missionId)
//          val nextTempLabelId: Int = LabelTable.nextTempLabelId(userId)
//
//          val missionSetProgress: MissionSetProgress =
//            if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
//            else MissionTable.defaultAuditMissionSetProgress
//
//          // Check if they have already completed an explore mission. We send them to /validate after their first audit
//          // mission, but only after every third explore mission after that.
//          val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0
//
//          // Overwrite the current_audit_task_id column to null if it has a value right now. It will be automatically
//          // updated to whatever an audit_task_id associated with the street edge they are about to start on.
//          if (mission.currentAuditTaskId.isDefined) {
//            MissionTable.updateExploreProgressOnly(userId, mission.missionId, mission.distanceProgress.get, None)
//            mission = MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
//          }
//
//          val cityInfo: List[CityInfo] = Configs.getAllCityInfo(request2Messages.lang)
//          val tutorialStreetId: Int = ConfigTable.getTutorialStreetId
//          val makeCrops: Boolean = ConfigTable.getMakeCrops
//          if (missionSetProgress.missionType != "audit") {
//            Future.successful(Redirect("/validate"))
//          } else {
//            // If user is an admin and a panoId or lat/lng are supplied, send to that location, o/w send to street.
//            if (isAdmin(request.identity) && (startAtPano || startAtLatLng)) {
//              panoId match {
//                case Some(panoId) => Future.successful(Ok(views.html.explore("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityInfo, tutorialStreetId, makeCrops, None, None, Some(panoId))))
//                case None =>
//                  (lat, lng) match {
//                    case (Some(lat), Some(lng)) => Future.successful(Ok(views.html.explore("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityInfo, tutorialStreetId, makeCrops, Some(lat), Some(lng))))
//                    case (_, _) => Future.successful(Ok(views.html.explore("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, None, cityInfo, tutorialStreetId, makeCrops)))
//                  }
//              }
//            } else {
//              Future.successful(Ok(views.html.explore("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityInfo, tutorialStreetId, makeCrops)))
//            }
//          }
//        }
//      case None =>
//        Future.successful(Redirect(s"/anonSignUp?url=/explore/street/$streetEdgeId"))
//    }
//  }

  /**
    * This method handles a comment POST request. It parses the comment and inserts it into the comment table.
    */
//  def postComment = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    var submission = request.body.validate[CommentSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//
//        val userId: String = request.identity match {
//          case Some(user) => user.userId.toString
//          case None =>
//            Logger.warn("User without a user_id submitted a comment, but every user should have a user_id.")
//            val user: Option[SidewalkUser] = UserTable.find("anonymous")
//            user.get.userId.toString
//        }
//        val ipAddress: String = request.remoteAddress
//        val timestamp: OffsetDateTime = OffsetDateTime.now
//
//        val comment = AuditTaskComment(0, submission.auditTaskId, submission.missionId, submission.streetEdgeId, userId,
//                                       ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
//                                       submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
//        val commentId: Int = AuditTaskCommentTable.insert(comment)
//
//        Future.successful(Ok(Json.obj("comment_id" -> commentId)))
//      }
//    )
//  }
}
