package controllers

import java.sql.Timestamp
import java.util.{Calendar, Date, TimeZone, UUID}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import formats.json.CommentSubmissionFormats._
import formats.json.TaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.mission.{Mission, MissionStatus, MissionTable}
import models.region._
import models.route.RouteStreetTable
import models.street.StreetEdgeAssignmentCountTable
import models.user.{User, UserCurrentRegionTable}
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Logger
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc._
import play.api.Play.current

import scala.concurrent.Future

/**
 * Street controller
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)
  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, completedMissions: List[Mission])

  /**
   * This method returns a task definition in the GeoJSON format.
   * @return Task definition
   */
  def getTask = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val task = AuditTaskTable.selectANewTask(user.username)
        Future.successful(Ok(task.toJSON))
      case None => Future.successful(Ok(AuditTaskTable.selectANewTask.toJSON))
    }
  }

  /**
    * This method returns a task definition specified by the streetEdgeId.
    * @return Task definition
    */
  def getTaskByStreetEdgeId(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    val task = AuditTaskTable.selectANewTask(streetEdgeId, Option(0))
    Future.successful(Ok(task.toJSON))
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
    *
    * @param routeId
    * @return
    */
  def getTasksOnARoute(routeId: Int) = UserAwareAction.async { implicit request =>

    val routeStreets = RouteStreetTable.getRouteStreets(routeId)
    request.identity match {
      case Some(user) =>
        val tasks: List[JsObject] = AuditTaskTable.selectTasksOnARoute(routeId, routeStreets).map(_.toJSON)
        Future.successful(Ok(JsArray(tasks)))
      case None =>
        val tasks: List[JsObject] = AuditTaskTable.selectTasksOnARoute(routeId, routeStreets).map(_.toJSON)
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
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      AuditTaskTable.updateTaskEnd(id, timestamp)
      id
    } else {
      // Insert audit task
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      val auditTaskObj = user match {
        case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, auditTask.streetEdgeId,
          Timestamp.valueOf(auditTask.taskStart), Some(timestamp), completed=false)
        case None =>
          val user: Option[DBUser] = UserTable.find("anonymous")
          AuditTask(0, amtAssignmentId, user.get.userId, auditTask.streetEdgeId,
            Timestamp.valueOf(auditTask.taskStart), Some(timestamp), completed=false)
      }
      AuditTaskTable.save(auditTaskObj)
    }
  }

  def updateAuditTaskCompleteness(auditTaskId: Int, auditTask: TaskSubmission, incomplete: Option[IncompleteTaskSubmission]): Unit = {
    if (auditTask.completed.isDefined && auditTask.completed.get) {
      AuditTaskTable.updateCompleted(auditTaskId, completed=true)
      val updatedCount: Int = StreetEdgeAssignmentCountTable.incrementCompletion(auditTask.streetEdgeId)
      // if this was the first completed audit of this street edge, increase total audited distance of that region.
      if (updatedCount == 1) {
        RegionCompletionTable.updateAuditedDistance(auditTask.streetEdgeId)
      }
    } else if (incomplete.isDefined && incomplete.get.issueDescription == "GSVNotAvailable") {
      // If the user skipped with `GSVNotAvailable`, mark the task as completed and increment the task completion
      AuditTaskTable.updateCompleted(auditTaskId, completed=true)
      val updatedCount: Int = StreetEdgeAssignmentCountTable.incrementCompletion(auditTask.streetEdgeId) // Increment task completion
      // if this was the first completed audit of this street edge, increase total audited distance of that region.
      if (updatedCount == 1) {
        RegionCompletionTable.updateAuditedDistance(auditTask.streetEdgeId)
      }
    }
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
        val returnValues: Seq[TaskPostReturnValue] = for (data <- submission) yield {
          // Insert assignment (if any)
          val amtAssignmentId: Option[Int] = data.assignment match {
            case Some(asg) =>
              val newAsg = Option(asg.assignmentId)
              // Update the assignment Id to be complete
              newAsg
            case _ => None
          }

          // Update the AuditTaskTable and get auditTaskId
          // Set the task to be completed and increment task completion count
          val auditTaskId: Int = updateAuditTaskTable(request.identity, data.auditTask, amtAssignmentId)
          updateAuditTaskCompleteness(auditTaskId, data.auditTask, data.incomplete)

          // Insert the skip information or update task street_edge_assignment_count.completion_count
          if (data.incomplete.isDefined) {
            val incomplete = data.incomplete.get
            AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, auditTaskId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
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
                LabelTable.save(Label(0, auditTaskId, label.gsvPanoramaId, labelTypeId, label.photographerHeading,
                                      label.photographerPitch, label.panoramaLat, label.panoramaLng,
                                      label.deleted.value, label.temporaryLabelId, timeCreated))
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
              ProblemSeverityTable.find(labelId) match {
                case Some(ps) => ProblemSeverityTable.updateSeverity(ps.problemSeverityId, label.severity.get)
                case None => ProblemSeverityTable.save(ProblemSeverity(0, labelId, label.severity.get))
              }
            }

            if (label.temporaryProblem.isDefined) {
              val tempProblem = label.temporaryProblem.get.value
              ProblemTemporarinessTable.find(labelId) match {
                case Some(pt) => ProblemTemporarinessTable.updateTemporariness(pt.problemTemporarinessId, tempProblem)
                case None => ProblemTemporarinessTable.save(ProblemTemporariness(0, labelId, tempProblem))
              }
            }

            if (label.description.isDefined) {
              ProblemDescriptionTable.find(labelId) match {
                case Some(pd) => ProblemDescriptionTable.updateDescription(pd.problemDescriptionId, label.description.get)
                case None => ProblemDescriptionTable.save(ProblemDescription(0, labelId, label.description.get))
              }
            }
          }

          // Insert interaction
          for (interaction: InteractionSubmission <- data.interactions) {
            AuditTaskInteractionTable.save(AuditTaskInteraction(0, auditTaskId, interaction.action,
              interaction.gsvPanoramaId, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
              interaction.zoom, interaction.note, interaction.temporaryLabelId, new Timestamp(interaction.timestamp)))
          }

          // Insert environment
          val env: EnvironmentSubmission = data.environment
          val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, env.browser, env.browserVersion,
            env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
            env.operatingSystem, Some(request.remoteAddress))
          AuditTaskEnvironmentTable.save(taskEnv)

          // Insert Street View metadata
          for (panorama <- data.gsvPanoramas) {
            // Check the presence of the data
            if (!GSVDataTable.panoramaExists(panorama.gsvPanoramaId)) {
              val gsvData: GSVData = GSVData(panorama.gsvPanoramaId, 13312, 6656, 512, 512, panorama.imageDate, 1, "")
              GSVDataTable.save(gsvData)

              for (link <- panorama.links) {
                if (!GSVLinkTable.linkExists(panorama.gsvPanoramaId, link.targetGsvPanoramaId)) {
                  val gsvLink: GSVLink = GSVLink(panorama.gsvPanoramaId, link.targetGsvPanoramaId, link.yawDeg, "", link.description)
                  GSVLinkTable.save(gsvLink)
                }
              }
            }
          }

          // Check if the user has cleared any mission
          // Note: Deprecated. Delete this. The check for mission completion is done on the front-end side
          val completed: List[Mission] = request.identity match {
            case Some(user) =>
              val region: Option[Region] = RegionTable.selectTheCurrentRegion(user.userId)
              if (region.isDefined) {
                val missions: List[Mission] = MissionTable.selectIncompleteMissionsByAUser(user.userId, region.get.regionId)
                val status = MissionStatus(0.0, 0.0, 0)
                missions.filter(m => m.completed(status))
              } else {
                List()
              }
            case _ => List()
          }

          TaskPostReturnValue(auditTaskId, data.auditTask.streetEdgeId, completed)
        }

        val jsMissions: List[JsValue] = returnValues.head.completedMissions.map(m => Json.toJson(m))
        Future.successful(Ok(Json.obj(
          "audit_task_id" -> returnValues.head.auditTaskId,
          "street_edge_id" -> returnValues.head.streetEdgeId,
          "completed_missions" -> JsArray(jsMissions)
        )))
      }
    )
  }
}
