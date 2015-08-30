package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import models.User
import controllers.headers.ProvidesHeader
import models.audit.{NewTask, AuditTaskTable}
import play.api.libs.json.Json
import play.api.mvc.{BodyParsers, Result, RequestHeader}

import scala.concurrent.Future


/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns an index page.
   * @return
   */
  def index = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.index("Project Sidewalk", Some(user))))
      case None => Future.successful(Ok(views.html.index("Project Sidewalk")))
    }
  }

  /**
   * Returns an about page
   * @return
   */
  def about = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.about("Project Sidewalk - About", Some(user))))
      case None => Future.successful(Ok(views.html.about("Project Sidewalk - About")))
    }
  }

  /**
   * Returns an audit page.
   * @return
   */
  def audit = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => {
        // Check if s/he has gone through an onboarding.
        val task: NewTask = request.cookies.get("sidewalk-onboarding").getOrElse(None) match {
          case Some("completed") => AuditTaskTable.getNewTask(user.username)
          case _ => AuditTaskTable.getOnboardingTask
        }
        // val task: NewTask = AuditTaskTable.getNewTask(user.username)
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), Some(user))))
      }
      case None => {
        // Check if s/he has gone through an onboarding.
        val task: NewTask = request.cookies.get("sidewalk-onboarding").getOrElse(None) match {
          case Some("completed") => AuditTaskTable.getNewTask
          case _ => AuditTaskTable.getOnboardingTask
        }
        Future.successful(Ok(views.html.audit("Project Sidewalk - Audit", Some(task), None)))
      }
    }
  }
}
