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
import models.label.LabelTable
import models.mission.{Mission, MissionSetProgress, MissionTable, MissionTypeTable}
import models.region._
import models.route.{UserRoute, UserRouteTable}
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgeRegionTable}
import models.user._
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.mvc._
import scala.concurrent.Future

/**
 * Holds HTTP requests associated with the audit page.
 *
 * @param env The Silhouette environment.
 */
class AuditController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * Returns an audit page.
    */
  def audit(newRegion: Boolean, retakeTutorial: Option[Boolean], routeId: Option[Int], resumeRoute: Boolean) = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    val retakingTutorial: Boolean = retakeTutorial.isDefined && retakeTutorial.get

    request.identity match {
      case Some(user) =>
        // If the user is a Turker and has audited less than 50 meters in the current region, then delete the current region.
        val currentMeters: Option[Float] = MissionTable.getMetersAuditedInCurrentMission(user.userId)
        if (user.role.getOrElse("") == "Turker" &&  currentMeters.isDefined && currentMeters.get < 50) {
          UserCurrentRegionTable.delete(user.userId)
        }

        // Check if user has an active route or create a new one if routeId was supplied. If resumeRoute is false and no
        // routeId was supplied, then the function should return None and the user is not sent on a specific route.
        val userRoute: Option[UserRoute] = UserRouteTable.setUpPossibleUserRoute(routeId, user.userId, resumeRoute)

        // If user is on a specific route, assign them to the correct region. If they have no region assigned or
        // newRegion is set to true, assign a new region. Otherwise, get their previously assigned region.
        var region: Option[Region] =
          if (userRoute.isDefined) {
            val regionId: Int = UserCurrentRegionTable.saveOrUpdate(user.userId, 10)
            RegionTable.getRegion(regionId)
          } else if (newRegion || !UserCurrentRegionTable.isAssigned(user.userId)) {
            UserCurrentRegionTable.assignRegion(user.userId)
          } else {
            RegionTable.getCurrentRegion(user.userId)
          }

        // Log visit to the Explore page.
        val activityStr: String =
          if (userRoute.isDefined) s"Visit_Audit_Route=${userRoute.get.routeId}"
          else if (newRegion)       "Visit_Audit_NewRegionSelected"
          else                       "Visit_Audit"
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityStr, timestamp))

        // Check if a user still has tasks available in this region. This also should never really happen.
        if (userRoute.isDefined && region.isEmpty) {
          Logger.error("Unable to assign a region for the route.")
        } else if (region.isEmpty || !AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId)) {
          region = UserCurrentRegionTable.assignRegion(user.userId)
        } else if (region.isEmpty) {
          Logger.error("Unable to assign a region to a user.") // This should _really_ never happen.
        }

        val regionId: Int = region.get.regionId

        val role: String = user.role.getOrElse("")
        val payPerMeter: Double = if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
        val tutorialPay: Double =
          if (retakingTutorial || role != "Turker") AMTAssignmentTable.VOLUNTEER_PAY
          else AMTAssignmentTable.TURKER_TUTORIAL_PAY

        val missionSetProgress: MissionSetProgress =
          if (role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
          else MissionTable.defaultAuditMissionSetProgress

        var mission: Mission =
          if (retakingTutorial) MissionTable.resumeOrCreateNewAuditOnboardingMission(user.userId, tutorialPay).get
          else MissionTable.resumeOrCreateNewAuditMission(user.userId, regionId, payPerMeter, tutorialPay).get

        // If there is a partially completed task in this route or mission, get that, o/w make a new one.
        val task: Option[NewTask] =
          if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding")
            Some(AuditTaskTable.getATutorialTask(mission.missionId))
          else if (userRoute.isDefined)
            UserRouteTable.getRouteTask(userRoute.get, mission.missionId)
          else if (mission.currentAuditTaskId.isDefined)
            AuditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get)
          else
            AuditTaskTable.selectANewTaskInARegion(regionId, user.userId, mission.missionId)
        val nextTempLabelId: Int = LabelTable.nextTempLabelId(user.userId)

        // If the mission has the wrong audit_task_id, update it.
        if (task.isDefined && task.get.auditTaskId != mission.currentAuditTaskId) {
          MissionTable.updateAuditProgressOnly(user.userId, mission.missionId, mission.distanceProgress.getOrElse(0F), task.get.auditTaskId)
          mission = MissionTable.getMission(mission.missionId).get
        }

        // Check if they have already completed an audit mission. We send them to /validate after their first audit
        // mission, but only after every third audit mission after that.
        val completedMissions: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

        val cityStr: String = Play.configuration.getString("city-id").get
        val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
        val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
        if (missionSetProgress.missionType != "audit") {
          Future.successful(Redirect("/validate"))
        } else {
          Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, region.get, userRoute, missionSetProgress.numComplete, completedMissions, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
        }
      // For anonymous users.
      case None =>
        // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
        val queryParams: String = routeId.map(rId => s"%3FrouteId=$rId").getOrElse("")
        Future.successful(Redirect("/anonSignUp?url=/audit" + queryParams))
    }
  }

  /**
    * Audit a given region.
    */
  def auditRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val userId: UUID = user.userId
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        val regionOption: Option[Region] = RegionTable.getRegion(regionId)
        WebpageActivityTable.save(WebpageActivity(0, userId.toString, ipAddress, "Visit_Audit", timestamp))

        // Update the currently assigned region for the user.
        regionOption match {
          case Some(region) =>
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
              if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding")
                Some(AuditTaskTable.getATutorialTask(mission.missionId))
              else if (mission.currentAuditTaskId.isDefined)
                AuditTaskTable.selectTaskFromTaskId(mission.currentAuditTaskId.get)
              else
                AuditTaskTable.selectANewTaskInARegion(regionId, user.userId, mission.missionId)
            val nextTempLabelId: Int = LabelTable.nextTempLabelId(userId)

            // Check if they have already completed an audit mission. We send them to /validate after their first audit.
            // mission, but only after every third audit mission after that.
            val completedMission: Boolean = MissionTable.countCompletedMissions(user.userId, missionType = "audit") > 0

            val cityStr: String = Play.configuration.getString("city-id").get
            val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get
            val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
            if (missionSetProgress.missionType != "audit") {
              Future.successful(Redirect("/validate"))
            } else {
              Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", task, mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
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
    * Audit a given street. Optionally, a researcher can be placed at a specific lat/lng or panorama.
    */
  def auditStreet(streetEdgeId: Int, lat: Option[Double], lng: Option[Double], panoId: Option[String]) = UserAwareAction.async { implicit request =>
    val startAtPano: Boolean = panoId.isDefined
    val startAtLatLng: Boolean = lat.isDefined && lng.isDefined
    request.identity match {
      case Some(user) =>
        val userId: UUID = user.userId
        val regionOption: Option[Region] = StreetEdgeRegionTable.getNonDeletedRegionFromStreetId(streetEdgeId)

        if (regionOption.isEmpty) {
          Logger.error(s"Either there is no region associated with street edge $streetEdgeId, or it is not a valid id.")
          Future.successful(Redirect("/audit"))
        } else {
          val region: Region = regionOption.get
          val regionId: Int = region.regionId
          UserCurrentRegionTable.saveOrUpdate(userId, regionId)

          val role: String = user.role.getOrElse("")
          val payPerMeter: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
          val tutorialPay: Double =
            if (role == "Turker") AMTAssignmentTable.TURKER_TUTORIAL_PAY else AMTAssignmentTable.VOLUNTEER_PAY
          var mission: Mission =
            MissionTable.resumeOrCreateNewAuditMission(userId, regionId, payPerMeter, tutorialPay).get
          val task: NewTask =
            if (MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId) == "auditOnboarding")
              AuditTaskTable.getATutorialTask(mission.missionId)
            else
              AuditTaskTable.selectANewTask(streetEdgeId, mission.missionId)
          val nextTempLabelId: Int = LabelTable.nextTempLabelId(userId)

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
            // If user is an admin and a panoId or lat/lng are supplied, send to that location, o/w send to street.
            if (isAdmin(request.identity) && (startAtPano || startAtLatLng)) {
              panoId match {
                case Some(panoId) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId, None, None, Some(panoId))))
                case None =>
                  (lat, lng) match {
                    case (Some(lat), Some(lng)) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId, Some(lat), Some(lng))))
                    case (_, _) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, None, cityShortName, tutorialStreetId)))
                  }
              }
            } else {
              Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), mission, region, None, missionSetProgress.numComplete, completedMission, nextTempLabelId, Some(user), cityShortName, tutorialStreetId)))
            }
          }
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/audit/street/$streetEdgeId"))
    }
  }

  /**
    * This method handles a comment POST request. It parses the comment and inserts it into the comment table.
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
    * This method handles a POST request in which user reports a missing Street View image.
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
