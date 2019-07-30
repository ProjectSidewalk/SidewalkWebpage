package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.mission.{Mission, MissionTable}
import models.region._
import models.street.StreetEdgePriorityTable
import models.user.{User, UserCurrentRegionTable}
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._

import scala.concurrent.Future

/**
 * Task controller
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)
  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, mission: Option[Mission])

  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * This method returns a task definition specified by the streetEdgeId.
    * @return Task definition
    */
  def getTaskByStreetEdgeId(streetEdgeId: Int) = Action.async { implicit request =>
    val task = AuditTaskTable.selectANewTask(streetEdgeId, None)
    Future.successful(Ok(task.toJSON))
  }

  /**
    * This endpoint accepts a panoId from the client and returns a JSON payload representing a task created from
    * the street edge closest to the panoId. Note this method *only* works for panoIds that are part of an active CV
    * Ground truth mission for the logged-in user.
    * @param panoid
    * @return
    */
  def getCVGroundTruthTaskByPanoId(panoid: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        if (isAdmin(request.identity)) {
          val task: Option[NewTask] = AuditTaskTable.createCVGroundTruthTaskByPanoId(user, panoid)
          task match {
            case Some(t) => Future.successful(Ok(t.toJSON))
            case None =>
              Future.successful(BadRequest(Json.obj("success" -> false, "message" -> "Bad request: Could not create a task from the panoId submitted.")))
          }
        } else {
          Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Must be admin to fetch ground truth task")))
        }
      case None =>
        Future.successful(Unauthorized(Json.obj("success" -> false, "message" -> "Cannot get ground truth task for anonymous user.")))
    }
  }


  /**
    *
    * @param regionId Region id
    * @return
    */
  def getTasksInARegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val tasks: List[JsObject] = AuditTaskTable.selectTasksInARegion(regionId, user.userId).map(_.toJSON)
        Future.successful(Ok(JsArray(tasks)))
      case None =>
        val tasks: List[JsObject] = AuditTaskTable.selectTasksInARegion(regionId).map(_.toJSON)
        Future.successful(Ok(JsArray(tasks)))
    }
  }

  /**
    * Insert or update the submitted audit task in the database
    * @param auditTask
    * @return
    */
  def updateAuditTaskTable(user: Option[User], auditTask: TaskSubmission, amtAssignmentId: Option[Int]): Int = {
    if (auditTask.auditTaskId.isDefined) {
      // Update the existing audit task row
      val id = auditTask.auditTaskId.get
      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
      AuditTaskTable.updateTaskProgress(id, timestamp, auditTask.currentLat, auditTask.currentLng)
      id
    } else {
      // Insert audit task
      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
      val auditTaskObj = user match {
        case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, auditTask.streetEdgeId,
          Timestamp.valueOf(auditTask.taskStart), Some(timestamp), completed=false,
          auditTask.currentLat, auditTask.currentLng, auditTask.startPointReversed)
        case None =>
          val user: Option[DBUser] = UserTable.find("anonymous")
          AuditTask(0, amtAssignmentId, user.get.userId, auditTask.streetEdgeId,
            Timestamp.valueOf(auditTask.taskStart), Some(timestamp), completed=false,
            auditTask.currentLat, auditTask.currentLng, auditTask.startPointReversed)
      }
      AuditTaskTable.save(auditTaskObj)
    }
  }

  /**
    * Updates the progress of the audit mission in the database, creating a new mission if this one is complete.
    *
    * @param user
    * @param missionProgress
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
    } else if (!MissionTable.isCVGroundTruthMission(missionId)){
      if (missionProgress.distanceProgress.isEmpty) Logger.error("Received null distance progress for audit mission.")
      val distProgress: Float = missionProgress.distanceProgress.get
      val auditTaskId: Option[Int] = missionProgress.auditTaskId

      if (missionProgress.completed) {
        MissionTable.updateCompleteAndGetNextMission(userId, regionId.get, payPerMeter, missionId, distProgress, auditTaskId, skipped)
      } else {
        MissionTable.updateAuditProgressOnly(userId, missionId, distProgress, auditTaskId)
      }
    } else {
      None
    }
  }

  def updateAuditTaskCompleteness(auditTaskId: Int, auditTask: TaskSubmission, incomplete: Option[IncompleteTaskSubmission]): Unit = {
    // If the user skipped with `GSVNotAvailable`, mark the task as completed and increment the task completion.
    if ((auditTask.completed.isDefined && auditTask.completed.get)
      || (incomplete.isDefined && incomplete.get.issueDescription == "GSVNotAvailable")) {
      // if this was the first completed audit of this street edge, increase total audited distance of that region.
      if (!AuditTaskTable.anyoneHasAuditedStreet(auditTask.streetEdgeId)) {
        RegionCompletionTable.updateAuditedDistance(auditTask.streetEdgeId)
      }
      AuditTaskTable.updateCompleted(auditTaskId, completed = true)
    }
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON
    *
    * @return
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
   *
   * @return
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

  def processAuditTaskSubmissions(submission: Seq[AuditTaskSubmission], remoteAddress: String, identity: Option[User]) = {
    val returnValues: Seq[TaskPostReturnValue] = for (data <- submission) yield {
      val user = identity
      val streetEdgeId = data.auditTask.streetEdgeId

      if (data.auditTask.auditTaskId.isDefined) {
        user match {
          case Some(user) =>
            // Update the street's priority only if the user has not completed this street previously
            if (!AuditTaskTable.userHasAuditedStreet(streetEdgeId, user.userId)) {
              data.auditTask.completed.map { completed =>
                if (completed) {
                  StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId)
                }
              }
            }
          case None =>
            // Update the street's priority for anonymous user
            Logger.warn("User without user_id audited a street, but every user should have a user_id.")
            data.auditTask.completed.map { completed =>
              if (completed) {
                StreetEdgePriorityTable.partiallyUpdatePriority(streetEdgeId)
              }
            }
        }
      }


      // Update the AuditTaskTable and get auditTaskId
      // Set the task to be completed and increment task completion count
      val auditTaskId: Int = updateAuditTaskTable(user, data.auditTask, data.amtAssignmentId)
      updateAuditTaskCompleteness(auditTaskId, data.auditTask, data.incomplete)

      // Update the MissionTable and get missionId
      val missionId: Int = data.missionProgress.missionId

      val isCVGroundTruthMission: Boolean = MissionTable.isCVGroundTruthMission(missionId)

      val possibleNewMission: Option[Mission] = if (!isCVGroundTruthMission) {
        updateMissionTable(user, data.missionProgress)
      } else {
        None
      }
      // val missionId: Int = updateMissionTable() -- same as updateAuditTaskTable()

      // Insert the skip information or update task street_edge_assignment_count.completion_count
      if (data.incomplete.isDefined) {
        val incomplete: IncompleteTaskSubmission = data.incomplete.get
        AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, auditTaskId, missionId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
      }

      // Insert labels
      for (label: LabelSubmission <- data.labels) {
        val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)

        val existingLabelId: Option[Int] = label.temporaryLabelId match {
          case Some(tempLabelId) =>
            LabelTable.find(tempLabelId, label.auditTaskId)
          case None =>
            Logger.error("Received label with Null temporary_label_id")
            None
        }

        // If the label already exists, update deleted field, o/w insert the new label.
        val labelId: Int = existingLabelId match {
          case Some(labId) =>
            LabelTable.updateDeleted(labId, label.deleted.value)
            labId
          case None =>
            // get the timestamp for a new label being added to db, log an error if there is a problem w/ timestamp
            val timeCreated: Option[Timestamp] = label.timeCreated match {
              case Some(time) => Some(new Timestamp(time))
              case None =>
                Logger.error("No timestamp given for a new label")
                None
            }

            var calculatedStreetEdgeId = streetEdgeId;
            for (point: LabelPointSubmission <- label.points) {
              if(!point.lat.isEmpty && !point.lng.isEmpty){
                val possibleStreetEdgeId = LabelTable.getStreetEdgeIdClosestToLatLng(point.lat.get, point.lng.get);
                if(!possibleStreetEdgeId.isEmpty){
                  calculatedStreetEdgeId = possibleStreetEdgeId.get
                }
              }
            }

            LabelTable.save(Label(0, auditTaskId, missionId, label.gsvPanoramaId, labelTypeId,
              label.photographerHeading, label.photographerPitch, label.panoramaLat,
              label.panoramaLng, label.deleted.value, label.temporaryLabelId, timeCreated,
              label.tutorial, calculatedStreetEdgeId))
        }

        // Insert label points
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
              point.lat, point.lng, pointGeom))
          }
        }

        // If temporariness/severity/description they are set, update/insert them.
        if (label.severity.isDefined) {
          LabelSeverityTable.find(labelId) match {
            case Some(ls) => LabelSeverityTable.updateSeverity(ls.labelSeverityId, label.severity.get)
            case None => LabelSeverityTable.save(LabelSeverity(0, labelId, label.severity.get))
          }
        }

        if (label.temporaryLabel.isDefined) {
          val tempLabel = label.temporaryLabel.get.value
          LabelTemporarinessTable.find(labelId) match {
            case Some(lt) => LabelTemporarinessTable.updateTemporariness(lt.labelTemporarinessId, tempLabel)
            case None => LabelTemporarinessTable.save(LabelTemporariness(0, labelId, tempLabel))
          }
        }

        if (label.description.isDefined) {
          LabelDescriptionTable.find(labelId) match {
            case Some(pd) => LabelDescriptionTable.updateDescription(pd.labelDescriptionId, label.description.get)
            case None => LabelDescriptionTable.save(LabelDescription(0, labelId, label.description.get))
          }
        }

        // Remove any tag entries from database that were removed on the front-end and add any new ones.
        val existingTagIds: Set[Int] = LabelTagTable.selectTagIdsForLabelId(labelId).toSet
        val tagsToRemove: Set[Int] = existingTagIds -- label.tagIds.toSet
        val tagsToAdd: Set[Int] = label.tagIds.toSet -- existingTagIds
        tagsToRemove.map { tagId => LabelTagTable.delete(labelId, tagId) }
        tagsToAdd.map { tagId => LabelTagTable.save(LabelTag(0, labelId, tagId)) }
      }

      // Insert interactions
      AuditTaskInteractionTable.saveMultiple(data.interactions.map { interaction =>
        AuditTaskInteraction(0, auditTaskId, missionId, interaction.action, interaction.gsvPanoramaId,
          interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
          interaction.temporaryLabelId, new Timestamp(interaction.timestamp))
      })

      // Insert environment
      val env: EnvironmentSubmission = data.environment
      val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, missionId, env.browser,
        env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
        env.screenHeight, env.operatingSystem, Some(remoteAddress))
      AuditTaskEnvironmentTable.save(taskEnv)

      // Insert Street View metadata
      for (panorama <- data.gsvPanoramas) {
        // Check the presence of the data
        if (!GSVDataTable.panoramaExists(panorama.gsvPanoramaId)) {
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          val gsvData: GSVData = GSVData(panorama.gsvPanoramaId, 13312, 6656, 512, 512, panorama.imageDate, 1, "", false, Some(timestamp))
          GSVDataTable.save(gsvData)

          for (link <- panorama.links) {
            if (!GSVLinkTable.linkExists(panorama.gsvPanoramaId, link.targetGsvPanoramaId)) {
              val gsvLink: GSVLink = GSVLink(panorama.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, "", link.description)
              GSVLinkTable.save(gsvLink)
            }
          }
        }
      }

      TaskPostReturnValue(auditTaskId, data.auditTask.streetEdgeId, possibleNewMission)
    }

    Future.successful(Ok(Json.obj(
      "audit_task_id" -> returnValues.head.auditTaskId,
      "street_edge_id" -> returnValues.head.streetEdgeId,
      "mission" -> returnValues.head.mission.map(_.toJSON)
    )))
  }

}
