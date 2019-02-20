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
import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import models.mission.{Mission, MissionTable}
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable}
import models.survey.{SurveyOptionTable, SurveyQuestionTable}
import models.user._
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.mvc._

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

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
        val regionFuture: Future[Option[NamedRegion]] = nextRegion match {
          case Some("easy") => // Assign an easy region if the query string has nextRegion=easy.
            UserCurrentRegionTable.assignEasyRegion(user.userId)
          case Some("regular") => // Assign any region if nextRegion=regular and the user is experienced.
            UserCurrentRegionTable.assignRegion(user.userId)
          case Some(illformedString) => // Log warning, assign new region if one is not already assigned.
            Logger.warn(s"Parameter to audit must be \'easy\' or \'regular\', but \'$illformedString\' was passed.")
            UserCurrentRegionTable.isAssigned(user.userId).flatMap {
              case true   => RegionTable.selectTheCurrentNamedRegion(user.userId)
              case false  => UserCurrentRegionTable.assignRegion(user.userId)
            }
          case None => // Assign new region if one is not already assigned.
            UserCurrentRegionTable.isAssigned(user.userId).flatMap {
              case true   => RegionTable.selectTheCurrentNamedRegion(user.userId)
              case false  => UserCurrentRegionTable.assignRegion(user.userId)
            }
        }

        // Check if a user still has tasks available in this region. This also should never really happen.
        val region1 = regionFuture.flatMap {
          case Some(r) =>
            AuditTaskTable.isTaskAvailable(user.userId, r.regionId).map {
              case true   => regionFuture
              case false  => UserCurrentRegionTable.assignRegion(user.userId)
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

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            for {
              region <- regionFuture
              task <- AuditTaskTable.selectANewTaskInARegion(region.get.regionId, user.userId)
              mission <- (if(retakingTutorial) MissionTable.resumeOrCreateNewAuditOnboardingMission(user.userId, tutorialPay)
                else MissionTable.resumeOrCreateNewAuditMission(user.userId, region.get.regionId, payPerMeter, tutorialPay))
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              hasCompletedMissionInAmtAsmt <- MissionTable.hasCompletedMissionInThisAmtAssignment(user.username)
            } yield {
              Ok(views.html.audit(
                "Project Sidewalk - Audit", task, mission.get, region.get, Some(user), cityShortName,tutorialStreetId,
                surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, hasCompletedMissionInAmtAsmt
              ))
            }
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

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            for {
              task <- AuditTaskTable.selectANewTaskInARegion(regionId, userId)
              mission <- MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay)
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              hasCompletedMissionInAmtAsmt <- MissionTable.hasCompletedMissionInThisAmtAssignment(user.username)
              _ <- UserCurrentRegionTable.saveOrUpdate(userId, regionId)
            } yield {
              Ok(views.html.audit(
                "Project Sidewalk - Audit", task, mission.get, namedRegion, Some(user), cityShortName, tutorialStreetId,
                surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, hasCompletedMissionInAmtAsmt
              ))
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
  def auditStreet(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
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

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            for {
              task <- AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
              mission <- MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay)
              surveyQuestions <- SurveyQuestionTable.listAll
              surveyOptions <- SurveyOptionTable.listAll
              asmtId <- AMTAssignmentTable.getMostRecentAssignmentId(user.username)
              amtAsmtId <- AMTAssignmentTable.getMostRecentAMTAssignmentId(user.username)
              confirmationCode <- AMTAssignmentTable.getConfirmationCode(user.username, asmtId.getOrElse(""))
              hasCompletedMissionInAmtAsmt <- MissionTable.hasCompletedMissionInThisAmtAssignment(user.username)
            } yield {
              Ok(views.html.audit(
                "Project Sidewalk - Audit", Some(task), mission.get, region, Some(user), cityShortName, tutorialStreetId,
                surveyQuestions, surveyOptions, asmtId, amtAsmtId, confirmationCode, hasCompletedMissionInAmtAsmt
              ))
            }
          }
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId"))
    }
  }

  /**
    * Drops a researcher at a given location on the given street edge.
    *
    * @param streetEdgeId
    * @param lat
    * @param lng
    * @param panoId
    * @return
    */
  def auditLocation(streetEdgeId: Int, lat: Option[Double], lng: Option[Double], panoId: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // val regions: List[Region] = RegionTable.getRegionsIntersectingAStreet(streetEdgeId)
        val userId: UUID = user.userId
        RegionTable.selectNamedRegionsIntersectingAStreet(streetEdgeId).flatMap { regions =>
          val region: NamedRegion = regions.head

          val role: String = user.role.getOrElse("")
          val payPerMeter: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
          val tutorialPay: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY

          val cityStr: String = Play.configuration.getString("city-id").get
          val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
          val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
          for {
            task <- AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
            missionOption <- MissionTable.resumeOrCreateNewAuditMission(userId, region.regionId, payPerMeter, tutorialPay)
            surveyQuestions <- SurveyQuestionTable.listAll
            surveyOptions <- SurveyOptionTable.listAll
          } yield {
            val mission: Mission = missionOption.get
            if (isAdmin(request.identity)) {
              panoId match {
                case Some(panoId) =>
                  Ok(views.html.audit(
                    "Project Sidewalk - Audit", Some(task), mission, region, Some(user), cityShortName, tutorialStreetId,
                    surveyQuestions, surveyOptions, None, None, None, false, None, None, Some(panoId)
                  ))
                case None =>
                  (lat, lng) match {
                    case (Some(lat), Some(lng)) =>
                      Ok(views.html.audit(
                        "Project Sidewalk - Audit", Some(task), mission, region, Some(user), cityShortName,
                        tutorialStreetId, surveyQuestions, surveyOptions, None, None, None, false, Some(lat), Some(lng)
                      ))
                    case (_, _) =>
                      Ok(views.html.audit(
                        "Project Sidewalk - Audit", Some(task), mission, region, None, cityShortName, tutorialStreetId,
                        surveyQuestions, surveyOptions, None, None, None, false
                      ))
                  }
              }
            } else {
              Ok(views.html.audit(
                "Project Sidewalk - Audit", Some(task), mission, region, Some(user), cityShortName, tutorialStreetId,
                surveyQuestions, surveyOptions
              ))
            }
          }
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
    request.body.validate[CommentSubmission].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val ipAddress: String = request.remoteAddress
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

        (request.identity match {
          case Some(user) => Future.successful(user.userId.toString)
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
      }
    )
  }

  /**
    * This method handles a POST request in which user reports a missing Street View image
    * @return
    */
  def postNoStreetView = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    request.body.validate[NoStreetView].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        (request.identity match {
          case Some(user) => Future.successful(user.userId.toString)
          case None =>
            Logger.warn("User without a user_id reported no SV, but every user should have a user_id.")
            UserTable.find("anonymous")
              .map(_.get.userId.toString)
        }).flatMap { userId =>
          val issue = StreetEdgeIssue(0, submission.streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
          StreetEdgeIssueTable.save(issue)
              .map(_ => Ok)
        }
      }
    )
  }
}
