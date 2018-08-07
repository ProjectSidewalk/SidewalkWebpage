package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable}
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future

/**
  * Audit controller
  */
class AuditController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns an audit page.
    *
    * @return
    */
  def audit(nextRegion: Option[String]) = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        // Get current region if we aren't assigning new one; otherwise assign new region
        var region: Option[NamedRegion] = nextRegion match {
          case Some("easy") => // Assign an easy region if the query string has nextRegion=easy.
            UserCurrentRegionTable.assignEasyRegion(user.userId)
          case Some("regular") => // Assign any region if nextRegion=regular and the user is experienced.
            UserCurrentRegionTable.assignRegion(user.userId)
          case Some(illformedString) => // Log warning, assign new region if one is not already assigned.
            Logger.warn(s"Parameter to audit must be \'easy\' or \'regular\', but \'$illformedString\' was passed.")
            if (UserCurrentRegionTable.isAssigned(user.userId)) RegionTable.selectTheCurrentNamedRegion(user.userId)
            else UserCurrentRegionTable.assignRegion(user.userId)
          case None => // Assign new region if one is not already assigned.
            if (UserCurrentRegionTable.isAssigned(user.userId)) RegionTable.selectTheCurrentNamedRegion(user.userId)
            else UserCurrentRegionTable.assignRegion(user.userId)
        }

        // Check if a user still has tasks available in this region.
        if (region.isEmpty ||
            !AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId) ||
            !MissionTable.isMissionAvailable(user.userId, region.get.regionId)) {
          region = UserCurrentRegionTable.assignRegion(user.userId)
        }

        nextRegion match {
          case Some("easy") | Some("regular") =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit_NewRegionSelected", timestamp))
            Future.successful(Redirect("/audit"))
          case Some(illformedString) =>
            Future.successful(Redirect("/audit"))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

            val task: Option[NewTask] = AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user.userId)
            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, region, Some(user))))
        }
      // For anonymous users.
      case None =>
        nextRegion match {
          case Some(regionType) =>
            // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
            Future.successful(Redirect("/anonSignUp?url=/audit%3FnextRegion=" + regionType))
          case None =>
            Future.successful(Redirect("/anonSignUp?url=/audit"))
        }
    }
  }


  /**
    * Audit a given region
    *
    * @param regionId region id
    * @return
    */
  def auditRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        val ipAddress: String = request.remoteAddress
        val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Update the currently assigned region for the user
        UserCurrentRegionTable.saveOrUpdate(user.userId, regionId)
        val task: Option[NewTask] = AuditTaskTable.selectANewTaskInARegion(regionId, user.userId)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, region, Some(user))))

      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/region/$regionId"))
    }
  }

  /**
    * Audit a given street
    *
    * @param streetEdgeId street edge id
    * @return
    */
  def auditStreet(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val regions: List[NamedRegion] = RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId)
        val region: Option[NamedRegion] = regions.headOption

        // TODO: Should this function be modified?
        val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId, request.identity.map(_.userId))
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId"))
    }
  }

  /**
    * This method handles a comment POST request. It parse the comment and insert it into the comment table
    *
    * @return
    */
  def postComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[CommentSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {

        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            Logger.warn("User without a user_id submitted a comment, but every user should have a user_id.")
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)

        val comment = AuditTaskComment(0, submission.auditTaskId, submission.missionId, submission.streetEdgeId, userId,
                                       ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
                                       submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
        val commentId: Int = AuditTaskCommentTable.save(comment)

        Future.successful(Ok(Json.obj("comment_id" -> commentId)))
      }
    )
  }

  /**
    * This method handles a POST request in which user reports a missing Street View image
    * @return
    */
  def postNoStreetView = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[NoStreetView]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            Logger.warn("User without a user_id reported no SV, but every user should have a user_id.")
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        val ipAddress: String = request.remoteAddress

        val issue = StreetEdgeIssue(0, submission.streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
        StreetEdgeIssueTable.save(issue)

        Future.successful(Ok)
      }
    )
  }
}
