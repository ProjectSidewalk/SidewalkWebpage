package controllers

import java.sql.Timestamp
import java.util.{Date, Calendar}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.{GeometryFactory, PrecisionModel, Coordinate, Point}
import controllers.SidewalkController._
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.User
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label._
import models.sidewalk.SidewalkEdgeTable
import models.street.StreetEdgeAssignmentCountTable
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

  val calendar: Calendar = Calendar.getInstance
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * Get a task for a user.
   * @return
   */
  def getTask = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(AuditTaskTable.getNewTask(user.username).toJSON))
      case None => Future.successful(Ok(AuditTaskTable.getNewTask.toJSON))
    }
  }

  /**
   * Get a next task.
   * @param streetEdgeId
   * @param lat
   * @param lng
   * @return
   */
  def getNextTask(streetEdgeId: Int, lat: Float, lng: Float) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(AuditTaskTable.getConnectedTask(streetEdgeId, lat, lng).toJSON))
  }

  /**
   * Get a next task, but make sure the task is in the specified region.
   * @param regionId
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

  /**
   * Parse the submitted data and insert them into tables.
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
        for (data <- submission) {
          // Insert assignment (if any)
          val amtAssignmentId: Option[Int] = data.assignment match {
            case Some(asg) =>
              val newAsg = AMTAssignment(0, asg.hitId, asg.assignmentId, Timestamp.valueOf(asg.assignmentStart), None)
              Some(AMTAssignmentTable.save(newAsg))
            case _ => None
          }

          // Insert audit task
          val now: Date = calendar.getTime
          val currentTimestamp: Timestamp = new Timestamp(now.getTime)
          val auditTask = request.identity match {
            case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), currentTimestamp)
            case None =>
              val user: Option[DBUser] = UserTable.find("anonymous")
              AuditTask(0, amtAssignmentId, user.get.userId, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), currentTimestamp)
          }
          val auditTaskId:Int = AuditTaskTable.save(auditTask)

          // Insert the skip information or update task street_edge_assignment_count.completion_count
          data.incomplete match {
            case Some(incomplete) => AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, auditTaskId, incomplete.issueDescription, incomplete.lat, incomplete.lng))
            case _ => StreetEdgeAssignmentCountTable.incrementCompletion(data.auditTask.streetEdgeId)
          }

          // Insert labels
          for (label <- data.labels) {
            val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)
            val labelId: Int = LabelTable.save(
              Label(0, auditTaskId, label.gsvPanoramaId, labelTypeId,
                label.photographerHeading, label.photographerPitch,
                label.panoramaLat, label.panoramaLng, label.deleted.value
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
          }

          // Insert interaction
          for (interaction <- data.interactions) {
            AuditTaskInteractionTable.save(AuditTaskInteraction(0, auditTaskId, interaction.action,
              interaction.gsv_panorama_id, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
              interaction.zoom, interaction.note, Timestamp.valueOf(interaction.timestamp)))
          }

          // Insert environment
          val env: EnvironmentSubmission = data.environment
          val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, env.browser, env.browserVersion,
            env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
            env.operatingSystem, Some(request.remoteAddress))
          AuditTaskEnvironmentTable.save(taskEnv)
        }
      }
    )
    Future.successful(Ok(Json.toJson("Good job!")))
  }

  /**
   * Get a list of edges that are submitted by users.
   * @return
   */
  def auditedStreets = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => {
        val streets = AuditTaskTable.auditedStreets(user.userId)
        val features: List[JsObject] = streets.map { edge =>
          val coordinates: Array[Coordinate] = edge.geom.getCoordinates
          val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
          val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
          val properties = Json.obj(
            "street_edge_id" -> edge.streetEdgeId,
            "source" -> edge.source,
            "target" -> edge.target,
            "way_type" -> edge.wayType
          )
          Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
        }

        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      }
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username in our system :("
      )))
    }
  }

  /**
   * Get a list of labels submitted by the user
   * @return
   */
  def submittedLabels = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = LabelTable.submittedLabels(user.userId)
        val features: List[JsObject] = labels.map { label =>
          val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
          val properties = Json.obj(
              "audit_task_id" -> label.auditTaskId,
              "label_id" -> label.labelId,
              "gsv_panorama_id" -> label.gsvPanoramaId,
              "label_type" -> label.labelType
            )
          Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
        }
        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }
}
