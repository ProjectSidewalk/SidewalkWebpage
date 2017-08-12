package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.TaskSubmissionFormats._
import formats.json.CommentSubmissionFormats._
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.region._
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable}
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
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

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  /**
    * Returns an audit page.
    *
    * @return
    */
  def audit = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Check and make sure that the user has been assigned to a region
        if (!UserCurrentRegionTable.isAssigned(user.userId)) {
          UserCurrentRegionTable.assignRandomly(user.userId)
        }
        var region: Option[NamedRegion] = RegionTable.selectTheCurrentNamedRegion(user.userId)

        // TODO: Change here for unaudited routes - #839
        // Check if a user still has tasks available in this region.
        if (!AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId) ||
            !MissionTable.isMissionAvailable(user.userId, region.get.regionId)) {
          UserCurrentRegionTable.assignNextRegion(user.userId)
          region = RegionTable.selectTheCurrentNamedRegion(user.userId)
        }

        val task: NewTask = if (region.isDefined) AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user)
                            else AuditTaskTable.selectANewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))
        val region: Option[NamedRegion] = RegionTable.selectAnEasyNamedRegionRoundRobin
        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(region.get.regionId)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
    }
  }

  /**
    * Returns an audit page for an easy region, if any are available.
    *
    * @return
    */
  def auditNewEasyRegion = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

        UserCurrentRegionTable.assignNextEasyRegion(user.userId)
      
        var region: Option[NamedRegion] = RegionTable.selectTheCurrentNamedRegion(user.userId)
        val task: NewTask = if (region.isDefined) AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user) else AuditTaskTable.selectANewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))

        val region: Option[NamedRegion] = RegionTable.selectAnEasyNamedRegionRoundRobin
        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(region.get.regionId)
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
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress
    // val region: Option[Region] = RegionTable.getRegion(regionId)
    val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Update the currently assigned region for the user
        UserCurrentRegionTable.update(user.userId, regionId)

        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(regionId, user)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))
        val task: NewTask = AuditTaskTable.selectANewTask
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
    // val regions: List[Region] = RegionTable.getRegionsIntersectingAStreet(streetEdgeId)
    val regions: List[NamedRegion] = RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId)
    val region: Option[NamedRegion] = try {
      Some(regions.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None
    }

    val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId)
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
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)

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
    var submission = request.body.validate[NoStreetView]

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
