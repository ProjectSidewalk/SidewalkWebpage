package controllers

import java.sql.Timestamp
import java.util.{Date, Calendar}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import formats.json.CommentSubmissionFormats._
import formats.json.TaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label._
import models.mission.{MissionStatus, Mission, MissionTable}
import models.region._
import models.street.StreetEdgeAssignmentCountTable
import models.user.{UserCurrentRegionTable, User}
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc._
import play.api.Play.current
import play.extras.geojson

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
  def audit = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // Check and make sure that the user has been assigned to a region
        if (!UserCurrentRegionTable.isAssigned(user.userId)) UserCurrentRegionTable.assign(user.userId)
        val region: Option[Region] = RegionTable.getCurrentRegion(user.userId)

        // Check if a user still has tasks available in this region.
        if (!AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId)) {
          UserCurrentRegionTable.assignNextRegion(user.userId)
        }

        val task: NewTask = if (region.isDefined) AuditTaskTable.getNewTaskInRegion(region.get.regionId, user) else AuditTaskTable.getNewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        val region: Option[Region] = RegionTable.getRegion
        val task: NewTask = AuditTaskTable.getNewTaskInRegion(region.get.regionId)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
    }
  }

  /**
    * Audit a given region
    *
    * @param regionId region id
    * @return
    */
  def auditRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    val region: Option[Region] = RegionTable.getRegion(regionId)
    request.identity match {
      case Some(user) =>
        val task: NewTask = AuditTaskTable.getNewTaskInRegion(regionId, user)

        // Update the currently assigned region for the user
        UserCurrentRegionTable.update(user.userId, regionId)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        val task: NewTask = AuditTaskTable.getNewTask
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
    }
  }

  /**
    * Audit a given street
    *
    * @param streetEdgeId street edge id
    * @return
    */
  def auditStreet(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    val regions: List[Region] = RegionTable.getRegionsIntersectingStreet(streetEdgeId)
    val region: Option[Region] = try {
      Some(regions.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None
    }

    val task: NewTask = AuditTaskTable.getNewTask(streetEdgeId)
    request.identity match {
      case Some(user) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
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
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress

        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val timestamp: Timestamp = new Timestamp(now.getTime)
        val comment = AuditTaskComment(0, submission.streetEdgeId, userId, ipAddress, submission.gsvPanoramaId,
          submission.heading, submission.pitch, submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
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
    var submission = request.body.validate[CommentSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {

        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress

        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val timestamp: Timestamp = new Timestamp(now.getTime)

        // Todo

        Future.successful(Ok)
      }
    )
  }
}
