package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.sha256Hash
import formats.json.TaskSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit.AuditTaskInteractionTable.secondsAudited
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.mission.{Mission, MissionTable}
import models.region._
import models.street.StreetEdgePriorityTable.streetPrioritiesFromIds
import models.street.{StreetEdgePriority, StreetEdgePriorityTable}
import models.user.{User, UserCurrentRegionTable}
import models.utils.CommonUtils.ordered
import org.apache.http.NameValuePair
import org.apache.http.client.entity.UrlEncodedFormEntity
import org.apache.http.client.methods.HttpPost
import org.apache.http.impl.client.DefaultHttpClient
import org.apache.http.message.BasicNameValuePair
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._
import java.io.InputStream
import java.util
import scala.collection.mutable.ListBuffer
import scala.concurrent.{ExecutionContext, Future}

/**
 * Holds the HTTP requests associated with tasks submitted through the audit page.
 *
 * @param env The Silhouette environment.
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)
  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, mission: Option[Mission],
                                 switchToValidation: Boolean, updatedStreets: Option[UpdatedStreets])

  case class UpdatedStreets(lastPriorityUpdateTime: Long, updatedStreetPriorities: List[StreetEdgePriority]) {
    def toJSON: JsObject = {
      Json.obj(
        "last_priority_update_time" -> lastPriorityUpdateTime,
        "updated_street_priorities" -> updatedStreetPriorities.map(_.toJSON)
      )
    }
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
          auditTask.startPointReversed, Some(missionId), auditTask.currentMissionStart)
        case None =>
          val user: Option[DBUser] = UserTable.find("anonymous")
          AuditTask(0, amtAssignmentId, user.get.userId, auditTask.streetEdgeId, new Timestamp(auditTask.taskStart),
            timestamp, completed=false, auditTask.currentLat, auditTask.currentLng, auditTask.startPointReversed,
            Some(missionId), auditTask.currentMissionStart)
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
    val json = Json.parse(request.body)
    var submission = json.validate[Seq[AuditTaskSubmission]]
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
    var submission = request.body.validate[Seq[AuditTaskSubmission]]
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
   * Helper function that updates database with all data submitted through the audit page.
   */
  def processAuditTaskSubmissions(submission: Seq[AuditTaskSubmission], remoteAddress: String, identity: Option[User]) = {
    var newLabels: ListBuffer[(Int, Timestamp)] = ListBuffer()
    val returnValues: Seq[TaskPostReturnValue] = for (data <- submission) yield {
      val userOption: Option[User] = identity
      val streetEdgeId: Int = data.auditTask.streetEdgeId
      val missionId: Int = data.missionProgress.missionId

      if (data.auditTask.auditTaskId.isDefined) {
        val priorityBefore: StreetEdgePriority = streetPrioritiesFromIds(List(streetEdgeId)).head
        userOption match {
          case Some(user) =>
            // Update the street's priority only if the user has not completed this street previously.
            if (!AuditTaskTable.userHasAuditedStreet(streetEdgeId, user.userId)) {
              data.auditTask.completed.map { completed =>
                if (completed) {
                  StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, Some(user.userId.toString))
                }
              }
            }
          case None =>
            // Update the street's priority for anonymous user.
            Logger.warn("User without user_id audited a street, but every user should have a user_id.")
            data.auditTask.completed.map { completed =>
              if (completed) {
                StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId, None)
              }
            }
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
        val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)

        val existingLabelId: Option[Int] = if (label.temporaryLabelId.isDefined && userOption.isDefined) {
          LabelTable.find(label.temporaryLabelId.get, userOption.get.userId)
        } else {
          Logger.error("Received label with Null temporary_label_id or user_id")
          None
        }

        // If the label already exists, update deleted, severity, temporary, and description cols, o/w insert new label.
        val labelId: Int = existingLabelId match {
          case Some(labId) =>
            LabelTable.update(labId, label.deleted, label.severity, label.temporary, label.description)
            labId
          case None =>
            // Get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp.
            val timeCreated: Timestamp = label.timeCreated match {
              case Some(time) => new Timestamp(time)
              case None =>
                Logger.error("No timestamp given for a new label, using current time instead.")
                new Timestamp(Instant.now.toEpochMilli)
            }

            var calculatedStreetEdgeId: Int = streetEdgeId;
            for (point: LabelPointSubmission <- label.points) {
              if(point.lat.isDefined && point.lng.isDefined){
                val possibleStreetEdgeId: Option[Int] = LabelTable.getStreetEdgeIdClosestToLatLng(point.lat.get, point.lng.get)
                if(possibleStreetEdgeId.isDefined){
                  calculatedStreetEdgeId = possibleStreetEdgeId.get
                }
              }
            }

            val newLabelId: Int = LabelTable.save(Label(0, auditTaskId, missionId, label.gsvPanoramaId, labelTypeId,
              label.photographerHeading, label.photographerPitch, label.panoramaLat, label.panoramaLng, label.deleted,
              label.temporaryLabelId, timeCreated, label.tutorial, calculatedStreetEdgeId, 0, 0, 0, None,
              label.severity, label.temporary, label.description))

            newLabels += ((newLabelId, timeCreated))
            newLabelId
        }

        // Insert label points.
        for (point: LabelPointSubmission <- label.points) {
          val pointGeom: Option[Point] = (point.lat, point.lng) match {
            case (Some(lat), Some(lng)) =>
              val coord: Coordinate = new Coordinate(lng.toDouble, lat.toDouble)
              Some(gf.createPoint(coord))
            case _ => None
          }
          // If this label id does not have an entry in the label point table, add it.
          if (LabelPointTable.find(labelId).isEmpty) {
            LabelPointTable.save(LabelPoint(0, labelId, point.svImageX, point.svImageY, point.canvasX,
              point.canvasY, point.heading, point.pitch, point.zoom,
              point.canvasHeight, point.canvasWidth, point.alphaX, point.alphaY,
              point.lat, point.lng, pointGeom, point.computationMethod))
          }
        }

        // Remove any tag entries from database that were removed on the front-end and add any new ones.
        val labelTagIds: Set[Int] = label.tagIds.toSet
        val existingTagIds: Set[Int] = LabelTagTable.selectTagIdsForLabelId(labelId).toSet
        val tagsToRemove: Set[Int] = existingTagIds -- labelTagIds
        val tagsToAdd: Set[Int] = labelTagIds -- existingTagIds
        tagsToRemove.map { tagId => LabelTagTable.delete(labelId, tagId) }
        tagsToAdd.map { tagId => LabelTagTable.save(LabelTag(0, labelId, tagId)) }
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
        env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language)
      AuditTaskEnvironmentTable.save(taskEnv)

      // Insert Street View metadata.
      for (panorama <- data.gsvPanoramas) {
        // Check the presence of the data.
        if (!GSVDataTable.panoramaExists(panorama.gsvPanoramaId)) {
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          val gsvData: GSVData = GSVData(panorama.gsvPanoramaId, panorama.imageWidth, panorama.imageHeight,
            panorama.tileWidth, panorama.tileHeight, panorama.imageDate, panorama.copyright, false, Some(timestamp))
          GSVDataTable.save(gsvData)

          for (link <- panorama.links) {
            if (!GSVLinkTable.linkExists(panorama.gsvPanoramaId, link.targetGsvPanoramaId)) {
              val gsvLink: GSVLink = GSVLink(panorama.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, "", link.description)
              GSVLinkTable.save(gsvLink)
            }
          }
        }
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

      TaskPostReturnValue(auditTaskId, data.auditTask.streetEdgeId, possibleNewMission, switchToValidation, updatedStreets)
    }

    // Send contributions to SciStarter so that it can be recorded in their user dashboard there.
    if (newLabels.nonEmpty) {
      implicit val context: ExecutionContext = play.api.libs.concurrent.Execution.Implicits.defaultContext
      val scistarterResponseCode: Future[Int] = Future {
        val hashedEmail: String = sha256Hash(identity.get.email)
        val auditTime: Float = secondsAudited(identity.get.userId.toString, newLabels.map(_._1).min, newLabels.map(_._2).max)
        println(newLabels.length)
        println(auditTime)
        println((auditTime / newLabels.length).toString)
        val url: String = "https://scistarter.org/api/participation/hashed/project-sidewalk?key=y-uczxNAxMK0zMH1z9tnwgBwp1i15axLdgBvFTFnt5OGs24PR09JEiJBV7aZgAGJMJdG8mnot1wMkPh9XSAAGg"
        val post: HttpPost = new HttpPost(url)
        val client: DefaultHttpClient = new DefaultHttpClient
        val nameValuePairs = new util.ArrayList[NameValuePair](1)
        nameValuePairs.add(new BasicNameValuePair("hashed", hashedEmail));
        nameValuePairs.add(new BasicNameValuePair("type", "classification"));
        nameValuePairs.add(new BasicNameValuePair("count", newLabels.length.toString));
        nameValuePairs.add(new BasicNameValuePair("duration", (auditTime / newLabels.length).toString));
        post.setEntity(new UrlEncodedFormEntity(nameValuePairs));
        val response = client.execute(post)
        val inputStream: InputStream = response.getEntity.getContent
        val content: String = io.Source.fromInputStream(inputStream).mkString
        println(content)
        response.getStatusLine.getStatusCode
      }
    }

    Future.successful(Ok(Json.obj(
      "audit_task_id" -> returnValues.head.auditTaskId,
      "street_edge_id" -> returnValues.head.streetEdgeId,
      "mission" -> returnValues.head.mission.map(_.toJSON),
      "switch_to_validation" -> returnValues.head.switchToValidation,
      "updated_streets" -> returnValues.head.updatedStreets.map(_.toJSON)
    )))
  }
}
