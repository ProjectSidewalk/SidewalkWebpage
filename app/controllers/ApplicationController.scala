package controllers

import java.sql.Timestamp
import java.util.{Calendar, Date}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.audit.{AuditTaskTable, NewTask}
import models.user._
import models.daos.UserDAOImpl
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}

import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import play.api.{Logger, Play}

import scala.concurrent.Future

class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  /**
   * Returns an index page.
    *
    * @return
   */
  def index = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance.getTime.getTime)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Index", timestamp))
        Future.successful(Ok(views.html.index("Project Sidewalk", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Index", timestamp))
        Future.successful(Ok(views.html.index("Project Sidewalk")))
    }
  }

  /**
   * Returns an about page
    *
    * @return
   */
  def about = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance.getTime.getTime)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_About", timestamp))
        Future.successful(Ok(views.html.about("Project Sidewalk - About", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_About", timestamp))
        Future.successful(Ok(views.html.about("Project Sidewalk - About")))
    }
  }

  /**
    * Returns the terms page
    * @return
    */
  def terms = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance.getTime.getTime)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Terms", timestamp))
        Future.successful(Ok(views.html.terms("Project Sidewalk - Terms", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Terms", timestamp))
        Future.successful(Ok(views.html.terms("Project Sidewalk - About")))
    }
  }

  def map = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance.getTime.getTime)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Map", timestamp))
        Future.successful(Ok(views.html.map("Project Sidewalk - Explore Accessibility", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Map", timestamp))
        Future.successful(Ok(views.html.map("Project Sidewalk - Explore Accessibility")))
    }
  }
}
