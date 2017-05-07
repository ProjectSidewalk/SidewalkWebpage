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
import models.amt.{AMTAssignment, AMTAssignmentTable, AMTRouteAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.route._
import models.region._
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable}
import models.turker.{Turker, TurkerTable}
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws._
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

    // Get mTurk parameters
    // Map with keys ["assignmentId","hitId","turkSubmitTo","workerId"]
    val qString = request.queryString.map { case (k, v) => k.mkString -> v.mkString }
    //println(timestamp + " " + qString)

    var screenStatus: String = null
    var hitId: String = null
    var assignmentId: String = null
    var workerId: String = null
    if (qString.nonEmpty && qString.contains("assignmentId")) {

      assignmentId = qString("assignmentId")

      if (qString("assignmentId") != "ASSIGNMENT_ID_NOT_AVAILABLE") {
        // User clicked the ACCEPT HIT button
        hitId = qString("hitId")
        workerId = qString("workerId")
        screenStatus = "Assigned"
      }
      else {
        screenStatus = "Preview"
      }
    }
    else {
      screenStatus = "Blank"
    }

    val completionRates = StreetEdgeAssignmentCountTable.computeNeighborhoodCompletionRate(1).sortWith(_.rate < _.rate)

    request.identity match {
      case Some(user) =>
        // This code block doesn't work route by route
        // Future TODO: Make mission-route mechanism for users

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Check and make sure that the user has been assigned to a region
        if (!UserCurrentRegionTable.isAssigned(user.userId)) {
          UserCurrentRegionTable.assignRandomly(user.userId)
        }
        // val region: Option[Region] = RegionTable.getCurrentRegion(user.userId)
        var region: Option[NamedRegion] = RegionTable.selectTheCurrentNamedRegion(user.userId)

        // Check if a user still has tasks available in this region.
        if (!AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId) ||
          !MissionTable.isMissionAvailable(user.userId, region.get.regionId)) {
          UserCurrentRegionTable.assignNextRegion(user.userId)
          region = RegionTable.selectTheCurrentNamedRegion(user.userId)
        }

        val task: NewTask = if (region.isDefined) AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user) else AuditTaskTable.selectANewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>

        screenStatus match {
          case "Assigned" =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Audit", timestamp))

            // HITs are associated with routes at the time of HIT creation
            // Retrieve the route based on HIT ID
            val routeId: Option[Int] = AMTRouteAssignmentTable.findRouteByHITId(hitId)
            val route: Option[Route] = RouteTable.getRoute(routeId)
            println(route)
            val routeStreetId: Option[Int] = RouteStreetTable.getFirstRouteStreetId(routeId.getOrElse(0))
            println(routeStreetId.getOrElse(0))


            // Load the first task from the selected route
            val regionId = route.get.regionId
            val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
            val regionName = region.get.name
            println(f"RegionName: $regionName%s")
            val task: NewTask = AuditTaskTable.selectANewTask(routeStreetId.getOrElse(0))
            print("Task: ")
            println(task)


            // Save Turker details
            //val turker: Turker = Turker(workerId, "routeId")
            // TODO: Fix bug: turker id is taken as null
            // TODO: Find how to append new routes to existing turker
            //TurkerTable.save(turker)

            // Save HIT assignment details
            val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, None, workerId, 1, routeId, false)
            AMTAssignmentTable.save(asg)

            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
          case "Preview" =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Index", timestamp))
            Future.successful(Ok(views.html.index("Project Sidewalk")))
          case "Blank" =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Blank", timestamp))
            Future.successful(Ok(views.html.blankIndex("Project Sidewalk")))
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
    // val region: Option[Region] = RegionTable.getRegion(regionId)
    val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
    request.identity match {
      case Some(user) =>
        // Update the currently assigned region for the user
        UserCurrentRegionTable.update(user.userId, regionId)

        val task: NewTask = AuditTaskTable.selectANewTaskInARegion(regionId, user)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
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
