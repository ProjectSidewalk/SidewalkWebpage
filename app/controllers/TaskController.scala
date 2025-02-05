package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import models.auth.DefaultEnv
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import com.vividsolutions.jts.geom._
//import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.amt.AMTAssignmentTable
//import models.audit.AuditTaskInteractionTable.secondsAudited
import models.audit._
//import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable, PanoHistory, PanoHistoryTable}
import models.label._
import models.mission.{Mission, MissionTable}
import models.region._
//import models.route.{AuditTaskUserRouteTable, UserRouteTable}
//import models.street.StreetEdgePriorityTable.streetPrioritiesFromIds
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgePriority, StreetEdgePriorityTable}
import models.user.{SidewalkUserWithRole, UserCurrentRegionTable}
import models.utils.CommonUtils.ordered
import play.api.i18n.{I18nSupport, MessagesApi}
import play.api.{Logger, Play}
import play.api.libs.json._
import play.api.mvc._

import scala.collection.mutable.ListBuffer
//import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.Future

@Singleton
class TaskController @Inject() (
                                 cc: ControllerComponents,
                                 val silhouette: Silhouette[DefaultEnv]
                               ) extends AbstractController(cc) with I18nSupport {
//  implicit val context: ExecutionContext = play.api.libs.concurrent.Execution.Implicits.defaultContext

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  case class UpdatedStreets(lastPriorityUpdateTime: Long, updatedStreetPriorities: List[StreetEdgePriority]) {
//    def toJSON: JsObject = {
//      Json.obj(
//        "last_priority_update_time" -> lastPriorityUpdateTime,
//        "updated_street_priorities" -> updatedStreetPriorities.map(_.toJSON)
//      )
//    }
  }

  /**
   * This method handles a POST request in which user reports a missing Street View image.
   */
//  def postNoStreetView = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    var submission = request.body.validate[Int]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      streetEdgeId => {
//        val userId: String = request.identity match {
//          case Some(user) => user.userId.toString
//          case None =>
//            Logger.warn("User without a user_id reported no SV, but every user should have a user_id.")
//            val user: Option[DBUser] = UserTable.find("anonymous")
//            user.get.userId.toString
//        }
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//        val ipAddress: String = request.remoteAddress
//
//        val issue: StreetEdgeIssue = StreetEdgeIssue(0, streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
//        StreetEdgeIssueTable.insert(issue)
//
//        Future.successful(Ok)
//      }
//    )
//  }

  /**
   * Get the audit tasks in the given region for the signed in user.
   */
//  def getTasksInARegion(regionId: Int) = silhouette.SecuredAction.async { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val tasks: List[JsObject] = AuditTaskTable.selectTasksInARegion(regionId, user.userId).map(_.toJSON)
//        Future.successful(Ok(JsArray(tasks)))
//      case None =>
//        Future.successful(Redirect(s"/anonSignUp?url=/tasks?regionId=${regionId}"))
//    }
//  }

//  def getTasksInARoute(userRouteId: Int) = Action.async { implicit request =>
//      val tasks: List[JsObject] = UserRouteTable.selectTasksInRoute(userRouteId).map(_.toJSON)
//      Future.successful(Ok(JsArray(tasks)))
//  }

  /**
   * Save completion end point of a partially complete task
   */
//  def updateMissionStart(auditTaskId: Int, missionStart: Point) = {
//    AuditTaskTable.updateMissionStart(auditTaskId, missionStart);
//  }

  /**
   * Insert or update the submitted audit task in the database.
   */
//  def updateAuditTaskTable(user: Option[User], auditTask: TaskSubmission, missionId: Int, amtAssignmentId: Option[Int]): Int = {
//    if (auditTask.auditTaskId.isDefined) {
//      // Update the existing audit task row (don't update if they are in the tutorial).
//      val id: Int = auditTask.auditTaskId.get
//      if (MissionTable.getMissionType(missionId) == Some("audit")) {
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//        AuditTaskTable.updateTaskProgress(id, timestamp, auditTask.currentLat, auditTask.currentLng, missionId, auditTask.currentMissionStart)
//      }
//      id
//    } else {
//      // Insert audit task.
//      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//      val auditTaskObj: AuditTask = user match {
//        case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, auditTask.streetEdgeId,
//          new Timestamp(auditTask.taskStart), timestamp, completed=false, auditTask.currentLat, auditTask.currentLng,
//          auditTask.startPointReversed, Some(missionId), auditTask.currentMissionStart, lowQuality=false,
//          incomplete=false, stale=false)
//        case None =>
//          val user: Option[DBUser] = UserTable.find("anonymous")
//          AuditTask(0, amtAssignmentId, user.get.userId, auditTask.streetEdgeId, new Timestamp(auditTask.taskStart),
//            timestamp, completed=false, auditTask.currentLat, auditTask.currentLng, auditTask.startPointReversed,
//            Some(missionId), auditTask.currentMissionStart, lowQuality=false, incomplete=false, stale=false)
//      }
//      AuditTaskTable.insert(auditTaskObj)
//    }
//  }

  /**
    * Updates the progress of the audit mission in the database, creating a new mission if this one is complete.
    *
    * @return Option[Mission] a new mission if the old one was completed, o/w None.
    */
//  def updateMissionTable(user: Option[User], missionProgress: AuditMissionProgress): Option[Mission] = {
//    val missionId: Int = missionProgress.missionId
//    val skipped: Boolean = missionProgress.skipped
//    val userId: UUID = user.get.userId
//    val regionId: Option[Int] = UserCurrentRegionTable.currentRegion(userId)
//    val role: String = user.role
//    val payPerMeter: Double =
//      if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY
//
//    if (MissionTable.isOnboardingMission(missionProgress.missionId)) {
//      if (missionProgress.completed) {
//        MissionTable.updateCompleteAndGetNextMission(userId, regionId.get, payPerMeter, missionId, skipped)
//      } else {
//        None
//      }
//    } else {
//      if (missionProgress.distanceProgress.isEmpty) Logger.error("Received null distance progress for audit mission.")
//      val distProgress: Float = missionProgress.distanceProgress.get
//      val auditTaskId: Option[Int] = missionProgress.auditTaskId
//
//      if (missionProgress.completed) {
//        MissionTable.updateCompleteAndGetNextMission(userId, regionId.get, payPerMeter, missionId, distProgress, auditTaskId, skipped)
//      } else {
//        MissionTable.updateAuditProgressOnly(userId, missionId, distProgress, auditTaskId)
//      }
//    }
//  }

  /**
   * If applicable, update the audit task as complete and update the region_completion table.
   */
//  def updateAuditTaskCompleteness(auditTaskId: Int, auditTask: TaskSubmission, incomplete: Option[IncompleteTaskSubmission]): Unit = {
//    // If the user skipped with `GSVNotAvailable`, mark the task as completed and increment the task completion.
//    if ((auditTask.completed.isDefined && auditTask.completed.get)
//      || (incomplete.isDefined && incomplete.get.issueDescription == "GSVNotAvailable")) {
//      AuditTaskTable.updateCompleted(auditTaskId, completed = true)
//    }
//  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    */
//  def postBeacon = silhouette.UserAwareAction.async(parse.text) { implicit request =>
//    val json: JsValue = Json.parse(request.body)
//    var submission: JsResult[AuditTaskSubmission] = json.validate[AuditTaskSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        processAuditTaskSubmissions(submission, request.remoteAddress, request.identity)
//      }
//    )
//  }

  /**
   * Parse the submitted data and insert them into tables.
   */
//  def post = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
//    var submission: JsResult[AuditTaskSubmission] = request.body.validate[AuditTaskSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        processAuditTaskSubmissions(submission, request.remoteAddress, request.identity)
//      }
//    )
//  }

  /**
   * Helper function that updates database with all data submitted through the explore page.
   */
//  def processAuditTaskSubmissions(data: AuditTaskSubmission, remoteAddress: String, identity: Option[User]) = {
//    var newLabels: ListBuffer[(Int, Int, Timestamp)] = ListBuffer() // (label_id, temporary_label_id, timestamp)
//    var refreshPage: Boolean = false // If we notice something out of whack, tell the front-end to refresh the page.
//    val userOption: Option[User] = identity
//    val streetEdgeId: Int = data.auditTask.streetEdgeId
//    val missionId: Int = data.missionProgress.missionId
//    val currTime: Timestamp = new Timestamp(data.timestamp)
//    if (data.auditTask.auditTaskId.isDefined) {
//      val priorityBefore: StreetEdgePriority = streetPrioritiesFromIds(List(streetEdgeId)).head
//      userOption match {
//        case Some(user) =>
//          // Update the street's priority only if the user has not completed this street previously.
//          if (!AuditTaskTable.userHasAuditedStreet(streetEdgeId, user.userId)) {
//            data.auditTask.completed.map { completed =>
//              if (completed) {
//                StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, user.userId)
//              }
//            }
//          }
//        case None =>
//          // Update the street's priority for anonymous user.
//          Logger.warn("User without user_id audited a street, but every user should have a user_id.")
//      }
//      // If street priority went from 1 to < 1 due to this audit, update the region_completion table accordingly.
//      val priorityAfter: StreetEdgePriority = streetPrioritiesFromIds(List(streetEdgeId)).head
//      if (priorityBefore.priority == 1.0D && priorityAfter.priority < 1.0D) {
//        RegionCompletionTable.updateAuditedDistance(streetEdgeId)
//      }
//    }
//
//
//    // Update the AuditTaskTable and get auditTaskId.
//    val auditTaskId: Int = updateAuditTaskTable(userOption, data.auditTask, missionId, data.amtAssignmentId)
//    updateAuditTaskCompleteness(auditTaskId, data.auditTask, data.incomplete)
//
//    // Add to the audit_task_user_route and user_route tables if we are on a route and not in the tutorial.
//    if (data.userRouteId.isDefined && MissionTable.getMissionType(missionId) == Some("audit")) {
//      AuditTaskUserRouteTable.insertIfNew(data.userRouteId.get, auditTaskId)
//      UserRouteTable.updateCompleteness(data.userRouteId.get)
//    }
//
//    // Update MissionStart.
//    if (data.auditTask.currentMissionStart.isDefined) updateMissionStart(auditTaskId, data.auditTask.currentMissionStart.get)
//
//    // Update the MissionTable.
//    val possibleNewMission: Option[Mission] = updateMissionTable(userOption, data.missionProgress)
//
//    // Insert the skip information or update task street_edge_assignment_count.completion_count.
//    if (data.incomplete.isDefined) {
//      val incomplete: IncompleteTaskSubmission = data.incomplete.get
//      AuditTaskIncompleteTable.insert(AuditTaskIncomplete(0, auditTaskId, missionId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
//    }
//
//    // Insert labels.
//    for (label: LabelSubmission <- data.labels) {
//      val labelTypeId: Int = LabelTypeTable.labelTypeToId(label.labelType).get
//
//      val existingLabel: Option[Label] = if (userOption.isDefined) {
//        LabelTable.find(label.temporaryLabelId, userOption.get.userId)
//      } else {
//        Logger.error("Received label with Null user_id")
//        None
//      }
//
//      // If the label already exists, update deleted, severity, temporary, description, & tags, o/w insert new label.
//      val labelId: Int = existingLabel match {
//        case Some(existingLab) =>
//          // If there is already a label with this temp id but a mismatched label type, the user probably has the
//          // Explore page open in multiple browsers. Don't add the label, and tell the front-end to refresh the page.
//          if (existingLab.labelTypeId != labelTypeId) {
//            refreshPage = true
//            -1
//          } else {
//            // Map tag IDs to their string representations.
//            val tagStrings: List[String] = label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList
//
//            LabelTable.updateFromExplore(existingLab.labelId, label.deleted, label.severity, label.temporary, label.description, tagStrings)
//            existingLab.labelId
//          }
//        case None =>
//          // Get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp.
//          val timeCreated: Timestamp = label.timeCreated match {
//            case Some(time) => new Timestamp(time)
//            case None =>
//              Logger.error("No timestamp given for a new label, using current time instead.")
//              currTime
//          }
//
//          // Use label's lat/lng to determine street_edge_id. If lat/lng isn't defined, use audit_task's as backup.
//          val point: LabelPointSubmission = label.point
//          val calculatedStreetEdgeId: Int = (for {
//            _lat <- point.lat
//            _lng <- point.lng
//            _streetId <- LabelTable.getStreetEdgeIdClosestToLatLng(_lat, _lng)
//          } yield _streetId).getOrElse(streetEdgeId)
//
//          // Add the new entry to the label table. Make sure there's also an entry in the user_stat table.
//          val u: String = userOption.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
//          UserStatTable.addUserStatIfNew(UUID.fromString(u))
//          val newLabelId: Int = LabelTable.insert(Label(0, auditTaskId, missionId, u, label.gsvPanoramaId, labelTypeId,
//            label.deleted, label.temporaryLabelId, timeCreated, label.tutorial, calculatedStreetEdgeId, 0, 0, 0, None,
//            label.severity, label.temporary, label.description, label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList))
//
//          // Add an entry to the label_point table.
//          val pointGeom: Option[Point] = for {
//            _lat <- point.lat
//            _lng <- point.lng
//          } yield gf.createPoint(new Coordinate(_lng.toDouble, _lat.toDouble))
//
//          LabelPointTable.insert(LabelPoint(0, newLabelId, point.panoX, point.panoY, point.canvasX, point.canvasY,
//            point.heading, point.pitch, point.zoom, point.lat, point.lng, pointGeom, point.computationMethod))
//
//          newLabels += ((newLabelId, label.temporaryLabelId, timeCreated))
//          newLabelId
//      }
//    }
//
//    // Insert interactions.
//    AuditTaskInteractionTable.insertMultiple(data.interactions.map { interaction =>
//      AuditTaskInteraction(0, auditTaskId, missionId, interaction.action, interaction.gsvPanoramaId,
//        interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
//        interaction.temporaryLabelId, new Timestamp(interaction.timestamp))
//    })
//
//    // Insert environment.
//    val env: EnvironmentSubmission = data.environment
//    val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, missionId, env.browser,
//      env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
//      env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language, env.cssZoom, Some(currTime))
//    AuditTaskEnvironmentTable.insert(taskEnv)
//
//    // Insert Street View metadata.
//    for (pano <- data.gsvPanoramas) {
//      // Insert new entry to gsv_data table, or update the last_viewed/checked columns if we've already recorded it.
//      if (GSVDataTable.panoramaExists(pano.gsvPanoramaId)) {
//        GSVDataTable.updateFromExplore(pano.gsvPanoramaId, pano.lat, pano.lng, pano.cameraHeading,
//          pano.cameraPitch, expired = false, currTime, Some(currTime))
//      } else {
//        val gsvData: GSVData = GSVData(pano.gsvPanoramaId, pano.width, pano.height, pano.tileWidth, pano.tileHeight,
//          pano.captureDate, pano.copyright, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, expired = false,
//          currTime, Some(currTime), currTime)
//        GSVDataTable.insert(gsvData)
//      }
//      for (link <- pano.links) {
//        if (!GSVLinkTable.linkExists(pano.gsvPanoramaId, link.targetGsvPanoramaId)) {
//          val gsvLink: GSVLink = GSVLink(pano.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, link.description)
//          GSVLinkTable.insert(gsvLink)
//        }
//      }
//
//      // Save the history of the panoramas at this location.
//      pano.history.foreach { h => PanoHistoryTable.insert(PanoHistory(h.panoId, h.date, pano.gsvPanoramaId)) }
//    }
//
//    // Check for streets in the user's neighborhood that have been audited by other users while they were auditing.
//    val updatedStreets: Option[UpdatedStreets] =
//      if (data.auditTask.requestUpdatedStreetPriority) {
//        // Update the time we performed the query to be now.
//        val newPriorityUpdateTime: Long = Instant.now.toEpochMilli
//
//        // Get streetEdgeIds and priority values for streets that have been updated since lastPriorityUpdateTime.
//        val lastPriorityUpdateTime: Timestamp = new Timestamp(data.auditTask.lastPriorityUpdateTime)
//        val regionId: Int = MissionTable.getMission(data.missionProgress.missionId).flatMap(_.regionId).get
//        val updatedStreetIds: List[Int] = AuditTaskTable.streetsCompletedAfterTime(regionId, lastPriorityUpdateTime)
//        val updatedStreetPriorities: List[StreetEdgePriority] = StreetEdgePriorityTable.streetPrioritiesFromIds(updatedStreetIds)
//        Some(UpdatedStreets(newPriorityUpdateTime, updatedStreetPriorities))
//      } else {
//        None
//      }
//
//    // If this user is a turker who has just finished 3 audit missions, switch them to validations.
//    val switchToValidation: Boolean = userOption.isDefined &&
//      userOption.get.role.getOrElse("") == "Turker" &&
//      MissionTable.getProgressOnMissionSet(userOption.get.username).missionType != "audit"
//
//    // Send contributions to SciStarter so that it can be recorded in their user dashboard there.
//    val eligibleUser: Boolean = List("Registered", "Administrator", "Owner").contains(identity.get.role.getOrElse(""))
//    val envType: String = config.get[String]("environment-type")
//    if (newLabels.nonEmpty && envType == "prod" && eligibleUser) {
//      val timeSpent: Float = secondsAudited(identity.get.userId.toString, newLabels.map(_._1).min, newLabels.map(_._3).max)
//      val scistarterResponse: Future[Int] = sendSciStarterContributions(identity.get.email, newLabels.length, timeSpent)
//    }
//
//    Future.successful(Ok(Json.obj(
//      "audit_task_id" -> auditTaskId,
//      "street_edge_id" -> data.auditTask.streetEdgeId,
//      "mission" -> possibleNewMission.map(_.toJSON),
//      "label_ids" -> newLabels.map(l => Json.obj("label_id" -> l._1, "temporary_label_id" -> l._2)),
//      "switch_to_validation" -> switchToValidation,
//      "updated_streets" -> updatedStreets.map(_.toJSON),
//      "refresh_page" -> refreshPage
//    )))
//  }
}
