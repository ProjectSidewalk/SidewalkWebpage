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

  def get = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(AuditTaskTable.getNewTask(user.username).toString))
      case None => Future.successful(Ok(AuditTaskTable.getNewTask.toString))
    }
  }

  def getNearby = TODO
}
