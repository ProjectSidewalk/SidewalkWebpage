package controllers

import java.sql.Timestamp
import java.util.UUID
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
  def audit(nextRegion: Option[String]) = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>

        // Check and make sure that the user has been assigned to a region
        if (!UserCurrentRegionTable.isAssigned(user.userId)) {
          // Note: This condition is never true because a region is assigned immediately after the user signs up
          UserCurrentRegionTable.assignEasyRegion(user.userId)
        }

        var region: Option[NamedRegion] = RegionTable.selectTheCurrentNamedRegion(user.userId)

        nextRegion match {
          case Some("easy") =>
            // Assign an easy region if the query string has nextRegion=easy
            UserCurrentRegionTable.assignEasyRegion(user.userId)
            region = RegionTable.selectTheCurrentNamedRegion(user.userId)
          case Some("regular") =>
            // Assign a difficult region if the query string has nextRegion=regular and the user is experienced
            UserCurrentRegionTable.assignNextRegion(user.userId)
            region = RegionTable.selectTheCurrentNamedRegion(user.userId)
          case Some(illformedString) =>
            Logger.warn(s"Parameter to audit must be \'easy\' or \'regular\', but \'$illformedString\' was passed.")
          case None =>
            ;
        }

        // Check if a user still has tasks available in this region.
        if (!AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId) ||
            !MissionTable.isMissionAvailable(user.userId, region.get.regionId)) {
          //println("Executing when next is set to: " + nextRegion)
          UserCurrentRegionTable.assignNextRegion(user.userId)
          region = RegionTable.selectTheCurrentNamedRegion(user.userId)
        }

        nextRegion match {
          case Some("easy") | Some("regular") =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit_NewRegionSelected", timestamp))
            Future.successful(Redirect("/audit"))
          case Some(illformedString) =>
            Future.successful(Redirect("/audit"))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

            val task: NewTask = if (region.isDefined) AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user.userId)
            else AuditTaskTable.selectANewTask(user.userId)
            region = RegionTable.selectTheCurrentNamedRegion(user.userId)

            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
        }
      case None =>
        nextRegion match {
          case Some(regionType) =>
            Logger.warn(s"Anon users cannot have region difficulty specified via a parameter, but $regionType was passed")
            Future.successful(Redirect("/audit"))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))

            val region: Option[NamedRegion] = RegionTable.selectALeastAuditedEasyRegion
            val task: NewTask = AuditTaskTable.selectANewTaskInARegion(region.get.regionId)
            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
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

        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(regionId, user.userId)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))
        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(regionId)
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
    val regions: List[NamedRegion] = RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId)
    val region: Option[NamedRegion] = try {
      Some(regions.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None
    }

    // TODO: Should this function be modified?
    val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId, request.identity.map(_.userId))
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
