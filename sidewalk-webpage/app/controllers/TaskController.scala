package controllers

import java.sql.Timestamp
import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.User
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable, slickUsers}
import models.label._
import play.api.libs.json.{JsBoolean, JsError, Json}
import play.api.mvc._

import scala.concurrent.Future


/**
 * Street controller
 */
class TaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
    extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

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

  /**
   *
   * @return
   */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    var data = request.body.validate[AuditTaskSubmission]

    data.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      data => {
        // Insert assignment (if any)
        val amtAssignmentId: Option[Int] = data.assignment match {
          case Some(asg) =>
            val newAsg = AMTAssignment(0, asg.hitId, asg.assignmentId, Timestamp.valueOf(asg.assignmentStart), None)
            Some(AMTAssignmentTable.save(newAsg))
          case _ => None
        }

        // Insert audit task
        val auditTask = request.identity match {
          case Some(user) => AuditTask(0, amtAssignmentId, user.userId.toString, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), None)
          case None =>
            val user: Option[DBUser] = UserTable.find("anonymous")
            AuditTask(0, amtAssignmentId, user.get.userId, data.auditTask.streetEdgeId, Timestamp.valueOf(data.auditTask.taskStart), None)
        }
        val auditTaskId:Int = AuditTaskTable.save(auditTask)

        // Insert labels
        for (label <- data.labels) {
          val labelTypeId: Int =  LabelTypeTable.labelTypeToId(label.labelType)
          LabelTable.save(Label(0, auditTaskId, label.gsvPanoramaId, labelTypeId, label.photographerHeading, label.photographerPitch, label.deleted.value))
        }

        // Insert interaction
        for (interaction <- data.interactions) {
          AuditTaskInteractionTable.save(AuditTaskInteraction(0, auditTaskId, interaction.action, interaction.gsv_panorama_id, interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note, Timestamp.valueOf(interaction.timestamp)))
        }

        // Insert environment
        val env: EnvironmentSubmission = data.environment
        val taskEnv:AuditTaskEnvironment = AuditTaskEnvironment(0, auditTaskId, env.browser, env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(request.remoteAddress))
        AuditTaskEnvironmentTable.save(taskEnv)
        Future.successful(Ok(Json.toJson("Goo job man!")))
      }
    )
  }

  def getNearby = TODO
}
