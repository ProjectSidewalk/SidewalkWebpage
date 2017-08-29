package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._


import scala.concurrent.Future

class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  /**
    * Logs that someone is coming to the site using a custom URL, then redirects to the specified page.
    * If no referrer is specified, then it just loads the landing page
    *
    * @param referrer String - identifier for a site that a user is referred from
    * @param r String - identifier for a site that a user is referred from
    * @param redirectTo String - endpoint to load after logging referral
    * @return
    */
  def index(referrer: Option[String], r: Option[String], redirectTo: String) = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    // check both the 'referrer' and 'r' optional param to see if either contains a referral (preference to 'referral')
    val possibleReferral: Option[String] = referrer match {
      case Some(longRef) => Some(longRef)
      case None =>
        r match {
          case Some(shortRef) => Some(shortRef)
          case None => None
        }
    }

    possibleReferral match {
      // If someone is coming to the site from a custom URL, log it, and send them to the correct location
      case Some(ref) =>
        val activityLogText: String = "Referrer=" + ref + "_SendTo=" + redirectTo
        request.identity match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
            Future.successful(Redirect(redirectTo))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, activityLogText, timestamp))
            Future.successful(Redirect(redirectTo))
        }
      // Otherwise, just load the landing page
      case None =>
        request.identity match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Index", timestamp))
            Future.successful(Ok(views.html.index("Project Sidewalk", Some(user))))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Index", timestamp))
            Future.successful(Ok(views.html.index("Project Sidewalk")))
        }
    }
  }

  /**
   * Returns an about page
   * @return
   */
  def about = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
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

  def mobile = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_MobileIndex", timestamp))
        Future.successful(Ok(views.html.mobile("Project Sidewalk", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_MobileIndex", timestamp))
        Future.successful(Ok(views.html.mobile("Project Sidewalk")))
    }
  }

  def student = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Student", timestamp))
        Future.successful(Ok(views.html.student("Project Sidewalk", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Student", timestamp))
        Future.successful(Ok(views.html.student("Project sidewalk")))
    }

  }

  /**
    * Returns a developer page
    * @return
    */
  def developer = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Developer", timestamp))
        Future.successful(Ok(views.html.developer("Project Sidewalk - Developers", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Developer", timestamp))
        Future.successful(Ok(views.html.developer("Project Sidewalk - Developers")))
    }
  }

  /**
    * Returns an FAQ page
    * @return
    */
  def faq = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_FAQ", timestamp))
        Future.successful(Ok(views.html.faq("Project Sidewalk - About", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_FAQ", timestamp))
        Future.successful(Ok(views.html.faq("Project Sidewalk - About")))
    }
  }

  /**
    * Returns the terms page
    * @return
    */
  def terms = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Terms", timestamp))
        Future.successful(Ok(views.html.terms("Project Sidewalk - Terms", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Terms", timestamp))
        Future.successful(Ok(views.html.terms("Project Sidewalk - Terms")))
    }
  }

  def results = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Results", timestamp))
        Future.successful(Ok(views.html.results("Project Sidewalk - Explore Accessibility", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Results", timestamp))
        Future.successful(Ok(views.html.results("Project Sidewalk - Explore Accessibility")))
    }
  }

  def demo = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Map", timestamp))
        Future.successful(Ok(views.html.accessScoreDemo("Project Sidewalk - Explore Accessibility", Some(user))))
      case None =>
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Map", timestamp))
        Future.successful(Ok(views.html.accessScoreDemo("Project Sidewalk - Explore Accessibility")))
    }
  }

}
