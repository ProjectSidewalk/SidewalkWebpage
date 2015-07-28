package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Silhouette, Environment}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.User
import models.audit._
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
    var taskSubmissionResult = request.body.validate[AuditTaskSubmission]

    // Insert assignment (if any)
    // Insert audit task
    val auditTask = AuditTask()
    AuditTaskTable.save(AuditTask)

    // Insert labels
    // Insert interaction
    // Insert environment
    // Insert assignment
    // Insert comments (if any)

    Future.successful(Ok("Goo job man!"))
  }

  def getNearby = TODO
}
