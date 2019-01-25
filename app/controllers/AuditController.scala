package controllers

import java.sql.Timestamp
import java.util.UUID

import com.mohiva.play.silhouette.api.Silhouette
import com.vividsolutions.jts.geom._
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.mission.MissionTable
import models.region._
import models.street.{ StreetEdgeIssue, StreetEdgeIssueTable }
import models.survey.{ SurveyOptionTable, SurveyQuestionTable }
import models.user._
import org.joda.time.{ DateTime, DateTimeZone }
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._
import play.api.i18n.{ I18nSupport, MessagesApi }

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

/**
 * Audit controller
 */
class AuditController(silhouette: Silhouette[User], messagesApi: MessagesApi) extends Controller with I18nSupport {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * Returns an audit page.
   *
   * @return
   */
  def audit(nextRegion: Option[String], retakeTutorial: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    val retakingTutorial: Boolean = retakeTutorial.isDefined && retakeTutorial.get

    request.identity match {
      case Some(u) =>
        val user = u.asInstanceOf[User]
        // Get current region if we aren't assigning new one; otherwise assign new region
        val regionFuture: Future[Option[NamedRegion]] = nextRegion match {
          case Some("easy") => // Assign an easy region if the query string has nextRegion=easy.
            UserCurrentRegionTable.assignEasyRegion(user.userId)
          case Some("regular") => // Assign any region if nextRegion=regular and the user is experienced.
            UserCurrentRegionTable.assignRegion(user.userId)
          case Some(illformedString) => // Log warning, assign new region if one is not already assigned.
            Logger.warn(s"Parameter to audit must be \'easy\' or \'regular\', but \'$illformedString\' was passed.")
            UserCurrentRegionTable.isAssigned(user.userId).flatMap {
              case true => RegionTable.selectTheCurrentNamedRegion(user.userId)
              case false => UserCurrentRegionTable.assignRegion(user.userId)
            }
          case None => // Assign new region if one is not already assigned.
            UserCurrentRegionTable.isAssigned(user.userId).flatMap {
              case true => RegionTable.selectTheCurrentNamedRegion(user.userId)
              case false => UserCurrentRegionTable.assignRegion(user.userId)
            }
        }

        // Check if a user still has tasks available in this region. This also should never really happen.
        regionFuture.flatMap {
          case Some(r) =>
            AuditTaskTable.isTaskAvailable(user.userId, r.regionId).map {
              case true => regionFuture
              case false => UserCurrentRegionTable.assignRegion(user.userId)
            }
          case None => UserCurrentRegionTable.assignRegion(user.userId)
        }.map {
          case Some(r) => Some(r)
          case None =>
            // This should _really_ never happen.
            Logger.error("Unable to assign a region to a user.")
            None
        }

        nextRegion match {
          case Some("easy") | Some("regular") =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit_NewRegionSelected", timestamp))
            Future.successful(Redirect("/audit"))
          case Some(_) =>
            Future.successful(Redirect("/audit"))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Audit", timestamp))

            val role: String = user.role.getOrElse("")
            val payPerMeter: Double = if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double = if (retakingTutorial || role != "Turker")
              AMTAssignmentTable.VOLUNTEER_PAY
            else
              AMTAssignmentTable.TURKER_TUTORIAL_PAY

            for {
              region <- regionFuture
              task <- AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user.userId)
              mission <- (if (retakingTutorial) MissionTable.resumeOrCreateNewAuditOnboardingMission(user.userId, tutorialPay)
              else MissionTable.resumeOrCreateNewAuditMission(user.userId, region.get.regionId, payPerMeter, tutorialPay))
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              missionCount <- MissionTable.countCompletedMissionsByUserId(user.userId, includeOnboarding = false)
            } yield {
              Ok(views.html.audit("Project Sidewalk - Audit", task, mission.get, region.get, Some(user), surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, missionCount))
            }
        }
      // For anonymous users.
      case None =>
        // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
        val redirectString: String = (nextRegion, retakeTutorial) match {
          case (Some(nextR), Some(retakeT)) => s"/anonSignUp?url=/audit%3FnextRegion=$nextR%26retakeTutorial=$retakeT"
          case (Some(nextR), None) => s"/anonSignUp?url=/audit%3FnextRegion=$nextR"
          case (None, Some(retakeT)) => s"/anonSignUp?url=/audit%3FretakeTutorial=$retakeT"
          case _ => s"/anonSignUp?url=/audit"
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
  def auditRegion(regionId: Int) = silhouette.UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(u) =>
        val user = u.asInstanceOf[User]
        val userId: UUID = user.userId
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        val ipAddress: String = request.remoteAddress

        (for {
          region <- RegionTable.selectANamedRegion(regionId)
          _ <- WebpageActivityTable.save(WebpageActivity(0, userId.toString, ipAddress, "Visit_Audit", timestamp))
        } yield region).flatMap {
          // Update the currently assigned region for the user
          case Some(namedRegion) =>
            val role: String = user.role.getOrElse("")
            val payPerMeter: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY

            for {
              task <- AuditTaskTable.selectANewTaskInARegion(regionId, userId)
              mission <- MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay)
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              missionCount <- MissionTable.countCompletedMissionsByUserId(user.userId, includeOnboarding = false)
              _ <- UserCurrentRegionTable.saveOrUpdate(userId, regionId)
            } yield {
              Ok(views.html.audit("Project Sidewalk - Audit", task, mission.get, namedRegion, Some(user), surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, missionCount))
            }
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
  def auditStreet(streetEdgeId: Int) = silhouette.UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(u) =>
        val user = u.asInstanceOf[User]
        val userId: UUID = user.userId
        RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId).flatMap { regions =>
          if (regions.isEmpty) {
            Logger.error(s"Either there is no region associated with street edge $streetEdgeId, or it is not a valid id.")
            Future.successful(Redirect("/audit"))
          } else {
            val region: NamedRegion = regions.head
            val regionId: Int = region.regionId
            val role: String = user.role.getOrElse("")
            val payPerMeter: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY

            for {
              task <- AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
              mission <- MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay)
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              missionCount <- MissionTable.countCompletedMissionsByUserId(user.userId, includeOnboarding = false)
            } yield {
              Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission.get, region, Some(user), surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, missionCount))
            }
          }
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId"))
    }
  }

  /**
   * This method handles a comment POST request. It parse the comment and insert it into the comment table
   *
   * @return
   */
  def postComment = silhouette.UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    request.body.validate[CommentSubmission].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val ipAddress: String = request.remoteAddress
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)

        (request.identity match {
          case Some(user) => Future.successful(user.asInstanceOf[User].userId.toString)
          case None =>
            Logger.warn("User without a user_id submitted a comment, but every user should have a user_id.")
            UserTable.find("anonymous").map { user =>
              user.get.userId.toString
            }
        }).flatMap { userId =>
          val comment = AuditTaskComment(0, submission.auditTaskId, submission.missionId, submission.streetEdgeId, userId,
            ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
            submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)

          AuditTaskCommentTable.save(comment).map { commentId =>
            Ok(Json.obj("comment_id" -> commentId))
          }
        }
      })
  }

  /**
   * This method handles a POST request in which user reports a missing Street View image
   * @return
   */
  def postNoStreetView = silhouette.UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    request.body.validate[NoStreetView].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        val ipAddress: String = request.remoteAddress

        (request.identity match {
          case Some(user) => Future.successful(user.asInstanceOf[User].userId.toString)
          case None =>
            Logger.warn("User without a user_id reported no SV, but every user should have a user_id.")
            UserTable.find("anonymous")
              .map(_.get.userId.toString)
        }).flatMap { userId =>
          val issue = StreetEdgeIssue(0, submission.streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
          StreetEdgeIssueTable.save(issue)
            .map(_ => Ok)
        }
      })
  }
}
