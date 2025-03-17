package controllers

import javax.inject.{Inject, Singleton}
import controllers.base._
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import org.locationtech.jts.geom._
import controllers.helper.ControllerUtils.isAdmin
import formats.json.CommentSubmissionFormats._
import models.audit._
import models.label.LabelTable
import models.mission.{Mission, MissionTable, MissionTypeTable}
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
  def explore(newRegion: Boolean, retakeTutorial: Option[Boolean], routeId: Option[Int], resumeRoute: Boolean, regionId: Option[Int], streetEdgeId: Option[Int], lat: Option[Double], lng: Option[Double], panoId: Option[String]) = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val pageTitle: String = "Project Sidewalk - Explore"

    // NOTE: streetEdgeId takes precedence over routeId, which takes precedence over regionId.
    for {
      exploreData <- (routeId, streetEdgeId, regionId) match {
        case (Some(routeId), _, _) => exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion = false, Some(routeId), resumeRoute, None, None)
        case (_, Some(streetEdgeId), _) => exploreService.getDataForExplorePage(user.userId, retakingTutorial = false, newRegion = false, None, resumeRoute = false, None, Some(streetEdgeId))
        case (_, _, Some(regionId)) => exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion = false, None, resumeRoute = resumeRoute, Some(regionId), None)
        case (_, _, _) => exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion, None, resumeRoute, None, None)
      }
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      // Log visit to the Explore page.
      val activityStr: String =
        if (exploreData.userRoute.isDefined) s"Visit_Audit_RouteId=${exploreData.userRoute.get.routeId}"
        else if (streetEdgeId.isDefined)     s"Visit_Audit_StreetEdgeId=${streetEdgeId.get}"
        else if (regionId.isDefined)         s"Visit_Audit_RegionId=${regionId.get}"
        else if (newRegion)                   "Visit_Audit_NewRegionSelected"
        else                                  "Visit_Audit"
      cc.loggingService.insert(user.userId, request.remoteAddress, activityStr)

      // Load the Explore page. The match statement below just passes along any extra params when using `streetEdgeId`.
      // If user is an admin and a panoId or lat/lng are supplied, send to that location, o/w send to street.
      (streetEdgeId, isAdmin(Some(user)), panoId, lat, lng) match {
        case (Some(s), true, Some(p), _, _) => Ok(views.html.explore(commonData, pageTitle, user, exploreData, None, None, Some(p)))
        case (Some(s), true, _, Some(lt), Some(lg)) => Ok(views.html.explore(commonData, pageTitle, user, exploreData, Some(lt), Some(lg)))
        case _ => Ok(views.html.explore(commonData, pageTitle, user, exploreData))
      }
    }
  }

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
