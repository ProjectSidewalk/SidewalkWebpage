package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.CVGroundTruthSubmissionFormats.{CVGroundTruthPanoIdSubmission, CVGroundTruthPanoidListSubmission}
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.mission.{CVMissionPanoStatus, Mission, MissionProgressCVGroundtruthTable, MissionTable, MissionSetProgress}
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgeRegionTable}
import models.user._
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.Play.current
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
        // If the user is a Turker and has audited less than 50 meters in the current region, then delete the current region.
        val currentMeters = MissionTable.getMetersAuditedInCurrentMission(user.userId);
        if (user.role.getOrElse("") == "Turker" &&  currentMeters.isDefined && currentMeters.get < 50) {
          UserCurrentRegionTable.delete(user.userId)
        }

        // Get current region if we aren't assigning new one; otherwise assign new region.
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

            val role: String = user.role.getOrElse("")
            val payPerMeter: Double = if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (retakingTutorial || role != "Turker") AMTAssignmentTable.VOLUNTEER_PAY
              else AMTAssignmentTable.TURKER_TUTORIAL_PAY

            val missionSetProgress: MissionSetProgress =
              if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
              else MissionTable.defaultAuditMissionSetProgress

            val mission: Mission =
              if(retakingTutorial) MissionTable.resumeOrCreateNewAuditOnboardingMission(user.userId, tutorialPay).get
              else MissionTable.resumeOrCreateNewAuditMission(user.userId, regionId, payPerMeter, tutorialPay).get

            // If there is a partially completed task in this mission, get that, o/w make a new one.
            val task: Option[NewTask] =
              if (mission.currentAuditTaskId.isDefined)
                AuditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get)
              else
                AuditTaskTable.selectANewTaskInARegion(regionId, user.userId)
            val nextTempLabelId: Int = LabelTable.nextTempLabelId(mission.currentAuditTaskId)

            // Check if they have already completed an audit mission. We send them to /validate after their first audit
            // mission, but only after every third audit mission after that.
            val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            if (missionSetProgress.missionType != "audit") {
              Future.successful(Redirect("/validate"))
            } else {
              Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, region.get, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
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
        val region: Option[NamedRegion] = RegionTable.selectANamedRegion(regionId)
        WebpageActivityTable.save(WebpageActivity(0, userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Update the currently assigned region for the user
        region match {
          case Some(namedRegion) =>
            UserCurrentRegionTable.saveOrUpdate(userId, regionId)
            val role: String = user.role.getOrElse("")
            val payPerMeter: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
            val tutorialPay: Double =
              if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
            val mission: Mission =
              MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get

            val missionSetProgress: MissionSetProgress =
              if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
              else MissionTable.defaultAuditMissionSetProgress

            // If there is a partially completed task in this mission, get that, o/w make a new one.
            val task: Option[NewTask] =
              if (mission.currentAuditTaskId.isDefined)
                AuditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get)
              else
                AuditTaskTable.selectANewTaskInARegion(regionId, user.userId)
            val nextTempLabelId: Int = LabelTable.nextTempLabelId(mission.currentAuditTaskId)

            // Check if they have already completed an audit mission. We send them to /validate after their first audit
            // mission, but only after every third audit mission after that.
            val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            if (missionSetProgress.missionType != "audit") {
              Future.successful(Redirect("/validate"))
            } else {
              Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, namedRegion, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
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
    * This endpoint launches the audit tool in CV ground truth auditing mode. This feature allows admin users to
    * submit a list of panoIds and audit those panoIds in sequence. This is useful for comprehensively labeling
    * panos for computer vision applications.
    * @return The audit page in CV ground truth auditing mode
    */
  def auditCVGroundTruth() = UserAwareAction.async { implicit request =>
    val cityStr: String = Play.configuration.getString("city-id").get
    val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
    val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get

    request.identity match {
      case Some(user) =>
        if(isAdmin(request.identity)) {
          val userId: UUID = user.userId
          // See if this user already has an incomplete ground truth auditing mission.
          val lastIncompleteCVMission: Option[Mission] = MissionTable.getIncompleteCVGroundTruthMission(userId)

          // Get user's assigned region or assign new region if none is assigned.
          val region: Option[NamedRegion] = UserCurrentRegionTable.currentRegion(user.userId) match {
            case Some(r) => RegionTable.selectANamedRegion(r)
            case None => UserCurrentRegionTable.assignRegion(user.userId)
          }

          (region, lastIncompleteCVMission) match {
            case (Some(r), Some(m)) =>
              // Create a task from the first incomplete pano in this mission.
              val incompletePanos: List[String] = MissionProgressCVGroundtruthTable.getRemainingPanos(user.userId, m.missionId)
              val firstIncompletePanoId: String = incompletePanos.reverse.head

              // Create a task from the street edge closest to the pano.
              val task: Option[NewTask] = AuditTaskTable.createCVGroundTruthTaskByPanoId(user, firstIncompletePanoId)
              val nextTempLabelId: Int = LabelTable.nextTempLabelId(m.currentAuditTaskId)

              // Check if they have already completed an audit mission. We send them to /validate after their first audit
              // mission, but only after every third audit mission after that.
              val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0
              val missionSetProgress: MissionSetProgress = MissionTable.defaultAuditMissionSetProgress

              Future.successful(Ok(views.html.audit("Project Sidewalk - CV Audit", task, m, r, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId, enableCVGroundTruthLabelingMode = true)))
            case (Some(r), None) =>
              // If no mission is provided, we render a different page containing a form allowing user to enter
              // panoIds to create a new CV audit mission.
              Future.successful(Ok(views.html.auditCreateCVMissionForm("Project Sidewalk - CV Audit", Some(user))))
            case _ =>
              Logger.error(s"Could not get a region.")
              Future.successful(Redirect("/audit"))

          }
        } else {
          Future.successful(Redirect(s"/"))
        }

      case None =>
        Future.successful(Redirect(s"/"))
    }
  }

  /**
    * This endpoint produces a JSON response listing the panoIds that have not yet been audited for the logged-in
    * admin user's most recent incomplete CV ground truth audit mission.
    * @return
    */
  def getCVGroundTruthRemainingPanos() = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        if(isAdmin(request.identity)) {
          val activeMission: Option[Mission] = MissionTable.getIncompleteCVGroundTruthMission(user.userId)
          activeMission match {
            case Some(mission) =>
              val remainingPanoList: List[String] = MissionProgressCVGroundtruthTable.getRemainingPanos(user.userId, mission.missionId)
              val json_response: JsObject = Json.obj(
                "remaining_panos" -> remainingPanoList
              )
              Future.successful(Ok(json_response))

            case None =>
              Future.successful(BadRequest(Json.obj("success" -> false, "message" -> "Cannot get remaining panos because there is no active ground truth mission.")))

          }
        } else {
          Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Only admin users can fetch remaining ground truth audit panos")))
        }

      case None =>
        Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Cannot retrieve remaining ground truth panos for anonymous user")))
    }
  }

  /**
    * This endpoint accepts a JSON payload from the client containing a panoId. It will locate the last incomplete
    * CV Ground truth audit mission for the logged-in admin user and mark the submitted panoId as complete.
    * @return
    */
  def markCVGroundTruthPanoComplete() = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    val submission = request.body.validate[CVGroundTruthPanoIdSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("success" -> false, "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            if(isAdmin(request.identity) && MissionTable.userOwnsMission(user.userId, submission.missionId)) {
              // Get the ongoing CV ground truth mission for this user.
              val currentCVMission: Option[Mission] = MissionTable.getMissionById(submission.missionId)

              // Mark the pano complete.
              currentCVMission match {
                case Some(mission) =>
                  MissionProgressCVGroundtruthTable.markPanoComplete(user.userId, mission.missionId, submission.pano)
                  Future.successful(Ok(Json.obj("success" -> true)))
                case None =>
                  Future.successful(BadRequest(Json.obj("success" -> false, "message" -> "Attempted to mark CV pano as complete, but there is no active CV mission.")))
              }
            } else {
              Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "You are not an admin or an invalid mission id was provided.")))
            }
          case None =>
            Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "An unknown user attempted to mark a CV ground truth pano as completed")))

        }
      }
    )
  }

  /**
    * This endpoint accepts a JSON payload from the client containing a list of panoIds (along with their lat/lng).
    * It will then create a new CV Ground Truth audit mission and save it to the database. It will also add a row
    * to the ground truth mission status table for each panoId and set their statuses to incomplete.
    * @return
    */
  def createGroundTruthAuditMission() = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[CVGroundTruthPanoidListSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("success" -> false, "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            if(isAdmin(request.identity)) {
              // Create a new ground truth auditing mission.
              val newMission: Mission = MissionTable.createNextCVGroundtruthMission(user.userId)
              // Insert a row into the mission_progress_cvgroundtruth table for each pano that needs to be audited.
              submission.panos.foreach { panoData =>
                val newPanoStatus: CVMissionPanoStatus = CVMissionPanoStatus(0, newMission.missionId, panoData.panoId, completed = false, panoData.lat, panoData.lng)
                MissionProgressCVGroundtruthTable.save(newPanoStatus)
              }
              Future.successful(Ok(Json.obj("success" -> true)))
            } else {
              Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Only admin users can create a ground truth audit mission.")))
            }
          case None =>
            Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Anonymous user cannot create a ground truth audit mission.")))
        }
      }
    )
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
        val regions: List[NamedRegion] = StreetEdgeRegionTable.selectByStreetEdgeId(streetEdgeId).flatMap {
          edgeRegion => RegionTable.selectANamedRegion(edgeRegion.regionId)
        }

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
          var mission: Mission =
            MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
          val nextTempLabelId: Int = LabelTable.nextTempLabelId(mission.currentAuditTaskId)

          val missionSetProgress: MissionSetProgress =
            if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
            else MissionTable.defaultAuditMissionSetProgress

          // Check if they have already completed an audit mission. We send them to /validate after their first audit
          // mission, but only after every third audit mission after that.
          val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

          // Overwrite the current_audit_task_id column to null if it has a value right now. It will be automatically
          // updated to whatever an audit_task_id associated with the street edge they are about to start on.
          if (mission.currentAuditTaskId.isDefined) {
            MissionTable.updateAuditProgressOnly(userId, mission.missionId, mission.distanceProgress.get, None)
            mission = MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
          }

          val cityStr: String = Play.configuration.getString("city-id").get
          val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
          val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
          if (missionSetProgress.missionType != "audit") {
            Future.successful(Redirect("/validate"))
          } else {
            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
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
        val userId: UUID = user.userId
        val regions: List[NamedRegion] = StreetEdgeRegionTable.selectByStreetEdgeId(streetEdgeId).flatMap {
          edgeRegion => RegionTable.selectANamedRegion(edgeRegion.regionId)
        }
        val region: NamedRegion = regions.head

        val task: NewTask = AuditTaskTable.selectANewTask(streetEdgeId, Some(userId))
        val role: String = user.role.getOrElse("")
        val payPerMeter: Double =
          if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
        val tutorialPay: Double =
          if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
        val mission: Mission =
          MissionTable.resumeOrCreateNewAuditMission(userId, region.regionId, payPerMeter, tutorialPay).get
        val nextTempLabelId: Int = LabelTable.nextTempLabelId(mission.currentAuditTaskId)

        val missionSetProgress: MissionSetProgress =
          if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
          else MissionTable.defaultAuditMissionSetProgress

        // Check if they have already completed an audit mission. We send them to /validate after their first audit
        // mission, but only after every third audit mission after that.
        val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

        val cityStr: String = Play.configuration.getString("city-id").get
        val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
        val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get

        if (missionSetProgress.missionType != "audit") {
          Future.successful(Redirect("/validate"))
        } else {
          if (isAdmin(request.identity)) {
            panoId match {
              case Some(panoId) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId, None, None, Some(panoId))))
              case None =>
                (lat, lng) match {
                  case (Some(lat), Some(lng)) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId, Some(lat), Some(lng))))
                  case (_, _) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, missionSetProgress.numComplete, completedMission, nextTempLabelId, None, cityShortName, tutorialStreetId)))
                }
            }
          } else {
            Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
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
