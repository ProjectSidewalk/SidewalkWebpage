package controllers

import java.sql.Timestamp
import java.util.{Date, Calendar}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import formats.json.CommentSubmissionFormats._
import formats.json.TaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label._
import models.mission.{MissionStatus, Mission, MissionTable}
import models.region._
import models.street.StreetEdgeAssignmentCountTable
import models.user.{UserCurrentRegionTable, User}
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc._
import play.api.Play.current
import play.extras.geojson

import scala.concurrent.Future

/**
 * Street controller
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * Returns an audit page.
    *
    * @return
   */
  def audit = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val region: Option[Region] = RegionTable.getCurrentRegion(user.userId)

        // Check and make sure that the user has been assigned to a region
        if (!UserCurrentRegionTable.isAssigned(user.userId)) UserCurrentRegionTable.assign(user.userId)

        // Check if a user still has tasks available for them.
        if (!AuditTaskTable.isTaskAvailable(user.userId, region.get.regionId)) {
          UserCurrentRegionTable.assignNextRegion(user.userId)
        }


        val task: NewTask = if (region.isDefined) AuditTaskTable.getNewTaskInRegion(region.get.regionId, user) else AuditTaskTable.getNewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        // Check if s/he has gone through an onboarding.
        val cookie = request.cookies.get("sidewalk-onboarding")
        val task: NewTask = AuditTaskTable.getNewTask
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), None, None)))
    }
  }

  /**
   * Audit a given region
    *
    * @param regionId region id
   * @return
   */
  def auditRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    val region: Option[Region] = RegionTable.getRegion(regionId)
    request.identity match {
      case Some(user) =>
        val task: NewTask = AuditTaskTable.getNewTaskInRegion(regionId, user)

        // Update the currently assigned region for the user
        UserCurrentRegionTable.update(user.userId, regionId)

        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None =>
        // Check if s/he has gone through an onboarding.
        val cookie = request.cookies.get("sidewalk-onboarding")
        val task: NewTask = AuditTaskTable.getNewTask
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
    }
  }

  /**
   * Audit a given street
   *
   * @param streetEdgeId street edge id
   * @return
   */
  def auditStreet(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    val regions: List[Region] = RegionTable.getRegionsIntersectingStreet(streetEdgeId)
    val region: Option[Region] = try {
      Some(regions.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None
    }

    val task: NewTask = AuditTaskTable.getNewTask(streetEdgeId)
    request.identity match {
      case Some(user) => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, Some(user))))
      case None => Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), region, None)))
    }
  }

  /**
   * This method returns a task definition in the GeoJSON format.
   * @return Task definition
   */
  def getTask = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(AuditTaskTable.getNewTask(user.username).toJSON))
      case None => Future.successful(Ok(AuditTaskTable.getNewTask.toJSON))
    }
  }

  /**
    * This method returns a task definition specified by the streetEdgeId.
    * @return Task definition
    */
  def getTaskByStreetEdgeId(streetEdgeId: Int) = UserAwareAction.async { implicit request =>
    val task = AuditTaskTable.getNewTask(streetEdgeId)
    Future.successful(Ok(task.toJSON))
  }


  /**
   * This method queries the task (i.e., a street edge to audit) that is connected to the current task (specified by
    * street edge id) and returns it in the GeoJson format.
   * @param streetEdgeId street edge id
   * @param lat current latitude
   * @param lng current longitude
   * @return Task definition
   */
  def getNextTask(streetEdgeId: Int, lat: Float, lng: Float) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(AuditTaskTable.getConnectedTask(streetEdgeId, lat, lng).toJSON))
  }

  /**
   * Get a next task, but make sure the task is in the specified region.
 *
   * @param regionId Region id
   * @return
   */
  def getTaskInRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val task = AuditTaskTable.getNewTaskInRegion(regionId)
        Future.successful(Ok(task.toJSON))
      case None =>
        val task = AuditTaskTable.getNewTaskInRegion(regionId)
        Future.successful(Ok(task.toJSON))
    }
  }


  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, completedMissions: List[Mission])
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
              val newAsg = AMTAssignment(0, asg.hitId, asg.assignmentId, Timestamp.valueOf(asg.assignmentStart), None)
              Some(AMTAssignmentTable.save(newAsg))
            case _ => None
          }

          // Check if there is auditTaskId
          val auditTaskId: Int = if (data.auditTask.auditTaskId.isDefined) {
            data.auditTask.auditTaskId.get
          } else {
            // Insert audit task
            val calendar: Calendar = Calendar.getInstance
            val now: Date = calendar.getTime
            val currentTimestamp: Timestamp = new Timestamp(now.getTime)
            val auditTask = request.identity match {
              case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), Some(currentTimestamp))
              case None =>
                val user: Option[DBUser] = UserTable.find("anonymous")
                AuditTask(0, amtAssignmentId, user.get.userId, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), Some(currentTimestamp))
            }

            if (data.incomplete.isDefined) {
              StreetEdgeAssignmentCountTable.incrementCompletion(data.auditTask.streetEdgeId) // Increment task completion
            }
            AuditTaskTable.save(auditTask)
          }


          // Insert the skip information or update task street_edge_assignment_count.completion_count
          if (data.incomplete.isDefined) {
            val incomplete = data.incomplete.get
            AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, auditTaskId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
          }

          // Insert labels
          for (label <- data.labels) {
            val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)
            val labelId: Int = LabelTable.save(
              Label(0, auditTaskId, label.gsvPanoramaId, labelTypeId,
                label.photographerHeading, label.photographerPitch,
                label.panoramaLat, label.panoramaLng, label.deleted.value, label.temporaryLabelId
              )
            )

            // Insert label points
            for (point <- label.points) {
              val pointGeom: Option[Point] = (point.lat, point.lng) match {
                case (Some(lat), Some(lng)) =>
                  val coord: Coordinate = new Coordinate(lng.toDouble, lat.toDouble)
                  Some(gf.createPoint(coord))
                case _ => None
              }
              LabelPointTable.save(LabelPoint(0, labelId, point.svImageX, point.svImageY, point.canvasX, point.canvasY,
                point.heading, point.pitch, point.zoom, point.canvasHeight, point.canvasWidth,
                point.alphaX, point.alphaY, point.lat, point.lng, pointGeom))
            }

            // Insert temporariness and severity if they are set.
            if (label.severity.isDefined) {
              ProblemSeverityTable.save(ProblemSeverity(0, labelId, label.severity.get))
            }

            if (label.temporaryProblem.isDefined) {
              val temporaryProblem = label.temporaryProblem.get.value
              ProblemTemporarinessTable.save(ProblemTemporariness(0, labelId, temporaryProblem))
            }

            if (label.description.isDefined) {
              ProblemDescriptionTable.save(ProblemDescription(0, labelId, label.description.get))
            }
          }

          // Insert interaction
          for (interaction <- data.interactions) {
            AuditTaskInteractionTable.save(AuditTaskInteraction(0, auditTaskId, interaction.action,
              interaction.gsvPanoramaId, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
              interaction.zoom, interaction.note, interaction.temporaryLabelId, Timestamp.valueOf(interaction.timestamp)))
          }

          // Insert environment
          val env: EnvironmentSubmission = data.environment
          val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, env.browser, env.browserVersion,
            env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
            env.operatingSystem, Some(request.remoteAddress))
          AuditTaskEnvironmentTable.save(taskEnv)

          // Check if the user has cleared any mission
          val completed: List[Mission] = request.identity match {
            case Some(user) =>
              val region: Option[Region] = RegionTable.getCurrentRegion(user.userId)
              if (region.isDefined) {
                val missions: List[Mission] = MissionTable.incomplete(user.userId, region.get.regionId)
                val status = MissionStatus(0.0, 0.0, 0)
                missions.filter(m => m.completed(status))
                MissionTable.incomplete(user.userId, region.get.regionId) // debug
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

  /**
    * Parse the submitted comment and insert it into the comment table
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
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress

        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val timestamp: Timestamp = new Timestamp(now.getTime)
        val comment = AuditTaskComment(0, submission.streetEdgeId, userId, ipAddress, submission.gsvPanoramaId,
          submission.heading, submission.pitch, submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
        val commentId: Int = AuditTaskCommentTable.save(comment)

        Future.successful(Ok(Json.obj("comment_id" -> commentId)))
      }
    )
  }

  def postNoStreetView = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[CommentSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {

        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress

        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val timestamp: Timestamp = new Timestamp(now.getTime)

        // Todo

        Future.successful(Ok)
      }
    )
  }
}
