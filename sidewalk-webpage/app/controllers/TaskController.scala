package controllers

import java.sql.Timestamp
import java.util.{Date, Calendar}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.User
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label._
import models.street.StreetEdgeAssignmentCountTable
import play.api.libs.json.{JsArray, JsBoolean, JsError, Json}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc._
import play.api.Play.current

import scala.concurrent.Future

/**
 * Street controller
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val calendar: Calendar = Calendar.getInstance

  /**
   *
   * @return
   */
  def get = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(AuditTaskTable.getNewTask(user.username).toString))
      case None => Future.successful(Ok(AuditTaskTable.getNewTask.toString))
    }
  }

  def next(streetEdgeId: Int, lat: Float, lng: Float) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(AuditTaskTable.getNewTask(streetEdgeId, lat, lng).toString))
  }

  /**
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

          // Update task street_edge_assignment_count.completion_count
          StreetEdgeAssignmentCountTable.incrementCompletion(data.auditTask.streetEdgeId)

          // Insert labels
          for (label <- data.labels) {
            val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)
            val labelId: Int = LabelTable.save(Label(0, auditTaskId, label.gsvPanoramaId, labelTypeId, label.photographerHeading, label.photographerPitch, label.deleted.value))

            for (point <- label.points) {
              LabelPointTable.save(LabelPoint(0, labelId, point.svImageX, point.svImageY, point.canvasX, point.canvasY, point.heading, point.pitch, point.zoom, point.canvasHeight, point.canvasWidth, point.alphaX, point.alphaY, point.lat, point.lng))
            }
          }

          // Insert interaction
          for (interaction <- data.interactions) {
            AuditTaskInteractionTable.save(AuditTaskInteraction(0, auditTaskId, interaction.action, interaction.gsv_panorama_id, interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note, Timestamp.valueOf(interaction.timestamp)))
          }

          // Insert environment
          val env: EnvironmentSubmission = data.environment
          val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, env.browser, env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(request.remoteAddress))
          AuditTaskEnvironmentTable.save(taskEnv)
        }
      }
    )
    Future.successful(Ok(Json.toJson("Goo job man!")))
  }

  def getNearby = TODO
}
