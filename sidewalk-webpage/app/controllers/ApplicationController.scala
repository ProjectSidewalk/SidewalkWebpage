package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.audit.{NewTask, AuditTaskTable}
import models.user.User

import scala.concurrent.Future

class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns an index page.
    *
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
    *
    * @return
   */
  def about = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.about("Project Sidewalk - About", Some(user))))
      case None => Future.successful(Ok(views.html.about("Project Sidewalk - About")))
    }
  }

  /**
    * Returns the terms page
    * @return
    */
  def terms = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(views.html.terms("Project Sidewalk - Terms", Some(user))))
      case None => Future.successful(Ok(views.html.terms("Project Sidewalk - About")))
    }
  }

  def map = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.map("Project Sidewalk - Explore Accessibility", Some(user))))
      case None => Future.successful(Ok(views.html.map("Project Sidewalk - Explore Accessibility")))
    }
  }
}
