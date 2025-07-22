package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.sendSciStarterContributions
import formats.json.TaskSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit.AuditTaskInteractionTable.secondsAudited
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable, PanoHistory, PanoHistoryTable}
import models.label._
import models.mission.{Mission, MissionTable}
import models.region._
import models.route.{AuditTaskUserRouteTable, UserRouteTable}
import models.street.StreetEdgePriorityTable.streetPrioritiesFromIds
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgePriority, StreetEdgePriorityTable}
import models.user.{User, UserCurrentRegionTable, UserStatTable}
import models.utils.CommonUtils.ordered
import models.utils.{CityInfo, Configs}
import play.api.Play.current
import play.api.{Logger, Play}
import play.api.libs.json._
import play.api.mvc._
import java.util
import org.apache.http.entity.mime.MultipartEntityBuilder
import org.apache.http.client.methods.HttpPost
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.http.client.HttpClient
import org.apache.http.util.EntityUtils
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import scala.util.{Success, Failure}
import play.api.i18n.{Lang}

import scala.collection.mutable.ListBuffer
//import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.{ExecutionContext, Future}
/**
 * Holds the HTTP requests associated with tasks submitted through the explore page.
 *
 * @param env The Silhouette environment.
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
//  implicit val context: ExecutionContext = play.api.libs.concurrent.Execution.Implicits.defaultContext

  private val SIDEWALK_AI_API_HOSTNAME: String = Play.configuration.getString("sidewalk-ai-api-hostname").get

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  case class UpdatedStreets(lastPriorityUpdateTime: Long, updatedStreetPriorities: List[StreetEdgePriority]) {
    def toJSON: JsObject = {
      Json.obj(
        "last_priority_update_time" -> lastPriorityUpdateTime,
        "updated_street_priorities" -> updatedStreetPriorities.map(_.toJSON)
      )
    }
  }

  /**
   * This method handles a POST request in which user reports a missing Street View image.
   */
  def postNoStreetView = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Int]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      streetEdgeId => {
        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            Logger.warn("User without a user_id reported no SV, but every user should have a user_id.")
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        val issue: StreetEdgeIssue = StreetEdgeIssue(0, streetEdgeId, "GSVNotAvailable", userId, ipAddress, timestamp)
        StreetEdgeIssueTable.save(issue)

        Future.successful(Ok)
      }
    )
  }

  /**
   * Get the audit tasks in the given region for the signed in user.
   */
  def getTasksInARegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val tasks: List[JsObject] = AuditTaskTable.selectTasksInARegion(regionId, user.userId).map(_.toJSON)
        Future.successful(Ok(JsArray(tasks)))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/tasks?regionId=${regionId}"))
    }
  }

  def getTasksInARoute(userRouteId: Int) = Action.async { implicit request =>
      val tasks: List[JsObject] = UserRouteTable.selectTasksInRoute(userRouteId).map(_.toJSON)
      Future.successful(Ok(JsArray(tasks)))
  }

  /**
   * Save completion end point of a partially complete task
   */
  def updateMissionStart(auditTaskId: Int, missionStart: Point) = {
    AuditTaskTable.updateMissionStart(auditTaskId, missionStart);
  }

  /**
   * Insert or update the submitted audit task in the database.
   */
  def updateAuditTaskTable(user: Option[User], auditTask: TaskSubmission, missionId: Int, amtAssignmentId: Option[Int]): Int = {
    if (auditTask.auditTaskId.isDefined) {
      // Update the existing audit task row (don't update if they are in the tutorial).
      val id: Int = auditTask.auditTaskId.get
      if (MissionTable.getMissionType(missionId) == Some("audit")) {
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        AuditTaskTable.updateTaskProgress(id, timestamp, auditTask.currentLat, auditTask.currentLng, missionId, auditTask.currentMissionStart)
      }
      id
    } else {
      // Insert audit task.
      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
      val auditTaskObj: AuditTask = user match {
        case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, auditTask.streetEdgeId,
          new Timestamp(auditTask.taskStart), timestamp, completed=false, auditTask.currentLat, auditTask.currentLng,
          auditTask.startPointReversed, Some(missionId), auditTask.currentMissionStart, lowQuality=false,
          incomplete=false, stale=false)
        case None =>
          val user: Option[DBUser] = UserTable.find("anonymous")
          AuditTask(0, amtAssignmentId, user.get.userId, auditTask.streetEdgeId, new Timestamp(auditTask.taskStart),
            timestamp, completed=false, auditTask.currentLat, auditTask.currentLng, auditTask.startPointReversed,
            Some(missionId), auditTask.currentMissionStart, lowQuality=false, incomplete=false, stale=false)
      }
      AuditTaskTable.save(auditTaskObj)
    }
  }

  /**
    * Updates the progress of the audit mission in the database, creating a new mission if this one is complete.
    *
    * @return Option[Mission] a new mission if the old one was completed, o/w None.
    */
  def updateMissionTable(user: Option[User], missionProgress: AuditMissionProgress): Option[Mission] = {
    val missionId: Int = missionProgress.missionId
    val skipped: Boolean = missionProgress.skipped
    val userId: UUID = user.get.userId
    val regionId: Option[Int] = UserCurrentRegionTable.currentRegion(userId)
    val role: String = user.get.role.getOrElse("")
    val payPerMeter: Double =
      if (role == "Turker") AMTAssignmentTable.TURKER_PAY_PER_METER else AMTAssignmentTable.VOLUNTEER_PAY

    if (MissionTable.isOnboardingMission(missionProgress.missionId)) {
      if (missionProgress.completed) {
        MissionTable.updateCompleteAndGetNextMission(userId, regionId.get, payPerMeter, missionId, skipped)
      } else {
        None
      }
    } else {
      if (missionProgress.distanceProgress.isEmpty) Logger.error("Received null distance progress for audit mission.")
      val distProgress: Float = missionProgress.distanceProgress.get
      val auditTaskId: Option[Int] = missionProgress.auditTaskId

      if (missionProgress.completed) {
        MissionTable.updateCompleteAndGetNextMission(userId, regionId.get, payPerMeter, missionId, distProgress, auditTaskId, skipped)
      } else {
        MissionTable.updateAuditProgressOnly(userId, missionId, distProgress, auditTaskId)
      }
    }
  }

  /**
   * If applicable, update the audit task as complete and update the region_completion table.
   */
  def updateAuditTaskCompleteness(auditTaskId: Int, auditTask: TaskSubmission, incomplete: Option[IncompleteTaskSubmission]): Unit = {
    // If the user skipped with `GSVNotAvailable`, mark the task as completed and increment the task completion.
    if ((auditTask.completed.isDefined && auditTask.completed.get)
      || (incomplete.isDefined && incomplete.get.issueDescription == "GSVNotAvailable")) {
      AuditTaskTable.updateCompleted(auditTaskId, completed = true)
    }
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    */
  def postBeacon = UserAwareAction.async(BodyParsers.parse.text) { implicit request =>
    val json: JsValue = Json.parse(request.body)
    var submission: JsResult[AuditTaskSubmission] = json.validate[AuditTaskSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processAuditTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  /**
   * Parse the submitted data and insert them into tables.
   */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    var submission: JsResult[AuditTaskSubmission] = request.body.validate[AuditTaskSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processAuditTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  private object BlockingExecutionContext {
    private val executor = Executors.newCachedThreadPool()

    val ec: ExecutionContext = ExecutionContext.fromExecutorService(executor)

    Runtime.getRuntime.addShutdownHook(new Thread {
      override def run(): Unit = {
        logger.info("Shutting down blocking I/O execution context...")
        executor.shutdown()
      }
    })
  }

  private def callAIAPI(labelType: String, panoramaId: String, panoX: Double, panoY: Double, labelId: Int): Future[Option[(List[String], Boolean, Double, String)]] = {
    Future { // Run this in the background
      val url: String = s"https://${SIDEWALK_AI_API_HOSTNAME}/process"
      val post: HttpPost = new HttpPost(url)
      val client: HttpClient = HttpClientBuilder.create.build
      val entity = MultipartEntityBuilder.create()
        .addTextBody("label_type", labelType.toLowerCase)
        .addTextBody("panorama_id", panoramaId)
        .addTextBody("x", (panoX / 16384.0).toString)
        .addTextBody("y", (panoY / 8192.0).toString)
        .build()
      post.setEntity(entity)

      var aiTags: Option[List[String]] = None
      var aiValidationResult: Option[Boolean] = None
      var aiValidationAccuracy: Option[Double] = None
      var apiVersion: Option[String] = None

      try {
        val response = client.execute(post)
        val responseBody = EntityUtils.toString(response.getEntity)
        val json: JsValue = Json.parse(responseBody)

        aiTags = (json \ "tags").asOpt[List[String]].map(tags =>
          tags.filter(tag => tag != "NULL")
        )
        aiValidationResult = (json \ "validation_result").asOpt[String].map(_ == "correct")
        aiValidationAccuracy = (json \ "validation_estimated_accuracy").asOpt[Double]
        apiVersion = (json \ "api_version").asOpt[String]
        Some((aiTags.getOrElse(List.empty), aiValidationResult.getOrElse(false), aiValidationAccuracy.getOrElse(0.0), apiVersion.getOrElse("Unknown")))
      } catch {
        case e: Exception =>
          Logger.warn(e.getMessage)
          None // Return None in case of exception
      }
    }(BlockingExecutionContext.ec)
  }

  /**
   * Helper function that updates database with all data submitted through the explore page.
   */
  def processAuditTaskSubmissions(data: AuditTaskSubmission, remoteAddress: String, identity: Option[User]) = {
    var newLabels: ListBuffer[(Int, Int, Timestamp)] = ListBuffer() // (label_id, temporary_label_id, timestamp)
    var refreshPage: Boolean = false // If we notice something out of whack, tell the front-end to refresh the page.
    val userOption: Option[User] = identity
    val streetEdgeId: Int = data.auditTask.streetEdgeId
    val missionId: Int = data.missionProgress.missionId
    val currTime: Timestamp = new Timestamp(data.timestamp)
    if (data.auditTask.auditTaskId.isDefined) {
      val priorityBefore: StreetEdgePriority = streetPrioritiesFromIds(List(streetEdgeId)).head
      userOption match {
        case Some(user) =>
          // Update the street's priority only if the user has not completed this street previously.
          if (!AuditTaskTable.userHasAuditedStreet(streetEdgeId, user.userId)) {
            data.auditTask.completed.map { completed =>
              if (completed) {
                StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, user.userId)
              }
            }
          }
        case None =>
          // Update the street's priority for anonymous user.
          Logger.warn("User without user_id audited a street, but every user should have a user_id.")
      }
      // If street priority went from 1 to < 1 due to this audit, update the region_completion table accordingly.
      val priorityAfter: StreetEdgePriority = streetPrioritiesFromIds(List(streetEdgeId)).head
      if (priorityBefore.priority == 1.0D && priorityAfter.priority < 1.0D) {
        RegionCompletionTable.updateAuditedDistance(streetEdgeId)
      }
    }


    // Update the AuditTaskTable and get auditTaskId.
    val auditTaskId: Int = updateAuditTaskTable(userOption, data.auditTask, missionId, data.amtAssignmentId)
    updateAuditTaskCompleteness(auditTaskId, data.auditTask, data.incomplete)

    // Add to the audit_task_user_route and user_route tables if we are on a route and not in the tutorial.
    if (data.userRouteId.isDefined && MissionTable.getMissionType(missionId) == Some("audit")) {
      AuditTaskUserRouteTable.insertIfNew(data.userRouteId.get, auditTaskId)
      UserRouteTable.updateCompleteness(data.userRouteId.get)
    }

    // Update MissionStart.
    if (data.auditTask.currentMissionStart.isDefined) updateMissionStart(auditTaskId, data.auditTask.currentMissionStart.get)

    // Update the MissionTable.
    val possibleNewMission: Option[Mission] = updateMissionTable(userOption, data.missionProgress)

    // Insert the skip information or update task street_edge_assignment_count.completion_count.
    if (data.incomplete.isDefined) {
      val incomplete: IncompleteTaskSubmission = data.incomplete.get
      AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, auditTaskId, missionId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
    }

    // Insert labels.
    for (label: LabelSubmission <- data.labels) {
      val labelTypeId: Int = LabelTypeTable.labelTypeToId(label.labelType).get

      val existingLabel: Option[Label] = if (userOption.isDefined) {
        LabelTable.find(label.temporaryLabelId, userOption.get.userId)
      } else {
        Logger.error("Received label with Null user_id")
        None
      }

      // If the label already exists, update deleted, severity, temporary, description, & tags, o/w insert new label.
      val labelId: Int = existingLabel match {
        case Some(existingLab) =>
          // If there is already a label with this temp id but a mismatched label type, the user probably has the
          // Explore page open in multiple browsers. Don't add the label, and tell the front-end to refresh the page.
          if (existingLab.labelTypeId != labelTypeId) {
            refreshPage = true
            -1
          } else {
            // Map tag IDs to their string representations.
            val tagStrings: List[String] = label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList

            LabelTable.updateFromExplore(existingLab.labelId, label.deleted, label.severity, label.temporary, label.description, tagStrings)
            existingLab.labelId
          }
        case None =>
          // Get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp.
          val timeCreated: Timestamp = label.timeCreated match {
            case Some(time) => new Timestamp(time)
            case None =>
              Logger.error("No timestamp given for a new label, using current time instead.")
              currTime
          }

          // Use label's lat/lng to determine street_edge_id. If lat/lng isn't defined, use audit_task's as backup.
          val point: LabelPointSubmission = label.point
          val calculatedStreetEdgeId: Int = (for {
            _lat <- point.lat
            _lng <- point.lng
            _streetId <- LabelTable.getStreetEdgeIdClosestToLatLng(_lat, _lng)
          } yield _streetId).getOrElse(streetEdgeId)

          // Add the new entry to the label table. Make sure there's also an entry in the user_stat table.
          val u: String = userOption.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
          UserStatTable.addUserStatIfNew(UUID.fromString(u))
          val newLabelId: Int = {
            val u: String = userOption.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
            UserStatTable.addUserStatIfNew(UUID.fromString(u))
            LabelTable.save(Label(
              0,
              auditTaskId,
              missionId,
              u,
              label.gsvPanoramaId,
              labelTypeId,
              label.deleted,
              label.temporaryLabelId,
              timeCreated,
              label.tutorial,
              calculatedStreetEdgeId,
              0,
              0,
              0,
              None,
              label.severity,
              label.temporary,
              label.description,
              label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList
            ))
          }

          val cityInfo: CityInfo = Configs.getAllCityInfo(Lang(data.environment.language)).filter(c => c.current).headOption.get

          if(cityInfo.aiValidationsEnabled || cityInfo.aiTagSuggestionsEnabled) {
            // Asynchronously call AI API and update Label and LabelAI tables
            callAIAPI(label.labelType, label.gsvPanoramaId, label.point.panoX.toDouble, label.point.panoY.toDouble, newLabelId).onComplete {
              case Success(aiResponseOption) =>
                aiResponseOption match {
                  case Some((aiTags, aiValidationResultBool, aiValidationAccuracyDouble, apiVersion)) =>
                    val aiDecision: String = if (aiValidationResultBool && aiValidationAccuracyDouble >= cityInfo.aiValidationsMinAccuracy) "correct"
                                              else if (!aiValidationResultBool && aiValidationAccuracyDouble >= cityInfo.aiValidationsMinAccuracy) "incorrect"
                                              else "unknown"
                    val aiCorrect = aiDecision == "correct"
                    val aiIncorrect = aiDecision == "incorrect"

                    if((aiCorrect || aiIncorrect) && cityInfo.aiValidationsEnabled) {
                      LabelValidationTable.insert(LabelValidation(
                        0, newLabelId,
                        if (aiCorrect) 1 else 2,
                        label.severity,
                        label.severity,
                        label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList,
                        label.tagIds.distinct.flatMap(t => TagTable.selectAllTags.filter(_.tagId == t).map(_.tag).headOption).toList,
                        "51b0b927-3c8a-45b2-93de-bd878d1e5cf4",
                        missionId,
                        Some(point.canvasX),
                        Some(point.canvasY),
                        point.heading,
                        point.pitch,
                        point.zoom.toFloat,
                        720,
                        480,
                        timeCreated,
                        timeCreated,
                        "sidewalk-ai"
                      ))
                    }

                    // Add AI information to the label_ai table.
                    val labelAI = LabelAI(
                      0,
                      newLabelId,
                      Some(aiTags),
                      Some(aiValidationAccuracyDouble.toFloat),
                      Some(if (aiValidationResultBool) 1 else 2),
                      Some(apiVersion),
                      timeCreated
                    )
                    LabelAITable.save(labelAI)

                  case None =>
                    Logger.warn(s"AI API call failed or returned no data for labelId: $newLabelId")
                }

              case Failure(exception) =>
                Logger.error(s"Error during asynchronous AI API call for labelId: $newLabelId", exception)
            }
          }

          // Add an entry to the label_point table.
          val pointGeom: Option[Point] = for {
            _lat <- point.lat
            _lng <- point.lng
          } yield gf.createPoint(new Coordinate(_lng.toDouble, _lat.toDouble))

          LabelPointTable.save(LabelPoint(0, newLabelId, point.panoX, point.panoY, point.canvasX, point.canvasY,
            point.heading, point.pitch, point.zoom, point.lat, point.lng, pointGeom, point.computationMethod))

          newLabels += ((newLabelId, label.temporaryLabelId, timeCreated))
          newLabelId
      }
    }

    // Insert interactions.
    AuditTaskInteractionTable.saveMultiple(data.interactions.map { interaction =>
      AuditTaskInteraction(0, auditTaskId, missionId, interaction.action, interaction.gsvPanoramaId,
        interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
        interaction.temporaryLabelId, new Timestamp(interaction.timestamp))
    })

    // Insert environment.
    val env: EnvironmentSubmission = data.environment
    val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, missionId, env.browser,
      env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
      env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language, env.cssZoom, Some(currTime))
    AuditTaskEnvironmentTable.save(taskEnv)

    // Insert Street View metadata.
    for (pano <- data.gsvPanoramas) {
      // Insert new entry to gsv_data table, or update the last_viewed/checked columns if we've already recorded it.
      if (GSVDataTable.panoramaExists(pano.gsvPanoramaId)) {
        GSVDataTable.updateFromExplore(pano.gsvPanoramaId, pano.lat, pano.lng, pano.cameraHeading,
          pano.cameraPitch, expired = false, currTime, Some(currTime))
      } else {
        val gsvData: GSVData = GSVData(pano.gsvPanoramaId, pano.width, pano.height, pano.tileWidth, pano.tileHeight,
          pano.captureDate, pano.copyright, pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, expired = false,
          currTime, Some(currTime), currTime)
        GSVDataTable.save(gsvData)
      }
      for (link <- pano.links) {
        if (!GSVLinkTable.linkExists(pano.gsvPanoramaId, link.targetGsvPanoramaId)) {
          val gsvLink: GSVLink = GSVLink(pano.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, link.description)
          GSVLinkTable.save(gsvLink)
        }
      }

      // Save the history of the panoramas at this location.
      pano.history.foreach { h => PanoHistoryTable.save(PanoHistory(h.panoId, h.date, pano.gsvPanoramaId)) }
    }

    // Check for streets in the user's neighborhood that have been audited by other users while they were auditing.
    val updatedStreets: Option[UpdatedStreets] =
      if (data.auditTask.requestUpdatedStreetPriority) {
        // Update the time we performed the query to be now.
        val newPriorityUpdateTime: Long = Instant.now.toEpochMilli

        // Get streetEdgeIds and priority values for streets that have been updated since lastPriorityUpdateTime.
        val lastPriorityUpdateTime: Timestamp = new Timestamp(data.auditTask.lastPriorityUpdateTime)
        val regionId: Int = MissionTable.getMission(data.missionProgress.missionId).flatMap(_.regionId).get
        val updatedStreetIds: List[Int] = AuditTaskTable.streetsCompletedAfterTime(regionId, lastPriorityUpdateTime)
        val updatedStreetPriorities: List[StreetEdgePriority] = StreetEdgePriorityTable.streetPrioritiesFromIds(updatedStreetIds)
        Some(UpdatedStreets(newPriorityUpdateTime, updatedStreetPriorities))
      } else {
        None
      }

    // If this user is a turker who has just finished 3 audit missions, switch them to validations.
    val switchToValidation: Boolean = userOption.isDefined &&
      userOption.get.role.getOrElse("") == "Turker" &&
      MissionTable.getProgressOnMissionSet(userOption.get.username).missionType != "audit"

    // Send contributions to SciStarter so that it can be recorded in their user dashboard there.
    val eligibleUser: Boolean = List("Registered", "Administrator", "Owner").contains(identity.get.role.getOrElse(""))
    val envType: String = Play.configuration.getString("environment-type").get
    if (newLabels.nonEmpty && envType == "prod" && eligibleUser) {
      val timeSpent: Float = secondsAudited(identity.get.userId.toString, newLabels.map(_._1).min, newLabels.map(_._3).max)
      val scistarterResponse: Future[Int] = sendSciStarterContributions(identity.get.email, newLabels.length, timeSpent)
    }

    Future.successful(Ok(Json.obj(
      "audit_task_id" -> auditTaskId,
      "street_edge_id" -> data.auditTask.streetEdgeId,
      "mission" -> possibleNewMission.map(_.toJSON),
      "label_ids" -> newLabels.map(l => Json.obj("label_id" -> l._1, "temporary_label_id" -> l._2)),
      "switch_to_validation" -> switchToValidation,
      "updated_streets" -> updatedStreets.map(_.toJSON),
      "refresh_page" -> refreshPage
    )))
  }
}
