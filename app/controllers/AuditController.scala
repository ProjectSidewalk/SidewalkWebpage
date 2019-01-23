package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.{Mission, MissionTable}
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable}
import models.user._
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

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * Returns an audit page.
    *
    * @return
    */
  def audit(nextRegion: Option[String], retakeTutorial: Option[Boolean]) = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    val retakingTutorial: Boolean = retakeTutorial.isDefined && retakeTutorial.get

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

        // Check if a user still has tasks available in this region. This also should never really happen.
        if (region.isEmpty || !AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId)) {
          region = UserCurrentRegionTable.assignRegion(user.userId)
        }
        // This should _really_ never happen.
        if (region.isEmpty) {
          Logger.error("Unable to assign a region to a user.")
        }

        nextRegion match {
          case Some("easy") | Some("regular") =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit_NewRegionSelected", timestamp))
            Future.successful(Redirect("/audit"))
          case Some(illformedString) =>
            Future.successful(Redirect("/audit"))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))
            val regionId: Int = region.get.regionId

            val task: Option[NewTask] = AuditTaskTable.selectANewTaskInARegion(regionId, user.userId)
            val role: String = user.role.getOrElse("")
            val payPerMeter: Double = if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (retakingTutorial || role != "Turker") AMTAssignmentTable.VOLUNTEER_PAY
              else AMTAssignmentTable.TURKER_TUTORIAL_PAY

            val mission: Mission =
              if(retakingTutorial) MissionTable.resumeOrCreateNewAuditOnboardingMission(user.userId, tutorialPay).get
              else MissionTable.resumeOrCreateNewAuditMission(user.userId, regionId, payPerMeter, tutorialPay).get

            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, region.get, Some(user))))
        }
      // For anonymous users.
      case None =>
        // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
        val redirectString: String = (nextRegion, retakeTutorial) match {
          case (Some(nextR), Some(retakeT)) => s"/anonSignUp?url=/audit%3FnextRegion=$nextR%26retakeTutorial=$retakeT"
          case (Some(nextR), None         ) => s"/anonSignUp?url=/audit%3FnextRegion=$nextR"
          case (None,        Some(retakeT)) => s"/anonSignUp?url=/audit%3FretakeTutorial=$retakeT"
          case _                            => s"/anonSignUp?url=/audit"
        }
        Future.successful(Redirect(redirectString))
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
        val userId: UUID = user.userId
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
        WebpageActivityTable.save(WebpageActivity(0, userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Update the currently assigned region for the user
        region match {
          case Some(namedRegion) =>
            UserCurrentRegionTable.saveOrUpdate(userId, regionId)
            val task: Option[NewTask] = AuditTaskTable.selectANewTaskInARegion(regionId, userId)
            val role: String = user.role.getOrElse("")
            val payPerMeter: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
            val mission: Mission =
              MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, namedRegion, Some(user))))
          case None =>
            Logger.error(s"Tried to audit region $regionId, but there is no neighborhood with that id.")
            Future.successful(Redirect("/audit"))
        }

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
        val userId: UUID = user.userId
        val regions: List[NamedRegion] = RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId)

        if (regions.isEmpty) {
          Logger.error(s"Either there is no region associated with street edge $streetEdgeId, or it is not a valid id.")
          Future.successful(Redirect("/audit"))
        } else {
          val region: NamedRegion = regions.head
          val regionId: Int = region.regionId

          // TODO: Should this function be modified?
          val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
          val role: String = user.role.getOrElse("")
          val payPerMeter: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
          val tutorialPay: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
          val mission: Mission =
            MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
          Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, Some(user))))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId"))
    }
  }

  
  def auditLocation(streetEdgeId: Int, lat: Option[Double], lng: Option[Double], panoId: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // val regions: List[Region] = RegionTable.getRegionsIntersectingAStreet(streetEdgeId)
        val userId: UUID = user.userId
        val regions: List[NamedRegion] = RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId)
        val region: NamedRegion = regions.head

        val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
        val role: String = user.role.getOrElse("")
        val payPerMeter: Double =
          if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
        val tutorialPay: Double =
          if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
        val mission: Mission =
          MissionTable.resumeOrCreateNewAuditMission(userId, region.regionId, payPerMeter, tutorialPay).get

        if(isAdmin(request.identity)){
          panoId match {
            case Some(panoId) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, Some(user), None, None, Some(panoId))))
            case None =>
              (lat, lng) match {
                case (Some(lat), Some(lng)) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, Some(user), Some(lat), Some(lng))))
                case (_, _) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, None)))
              }
          }
        } else {
          Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, Some(user))))
        }
      case None => Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId/location%3Flat=$lat%lng=$lng%3FpanoId=$panoId"))
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
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

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
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        val issue = StreetEdgeIssue(0, submission.streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
        StreetEdgeIssueTable.save(issue)

        Future.successful(Ok)
      }
    )
  }
}
