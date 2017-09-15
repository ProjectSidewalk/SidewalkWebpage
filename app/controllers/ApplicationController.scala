package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette, LogoutEvent}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import play.api.data.Forms._


import scala.concurrent.Future
import scala.util.Random

class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  /**
    * Logs that someone is coming to the site using a custom URL, then redirects to the specified page.
    * If no referrer is specified, then it just loads the landing page
    *
    * @return
    */
  def index = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress
    val qString = request.queryString.map { case (k, v) => k.mkString -> v.mkString }

    var referrer: Option[String] = qString.get("referrer") match{
      case Some(r) =>
        Some(r)
      case None =>
        qString.get("r")
    }


    referrer match {
      // If someone is coming to the site from a custom URL, log it, and send them to the correct location
      case Some(ref) =>
        ref match {
          case "mturk" =>
            //The referrer is mechanical turk
            val workerId: String = qString.get("workerId").get
            val assignmentId: String = qString.get("assignmentId").get
            val hitId: String = qString.get("hitId").get

            var activityLogText: String = "Referrer=" + ref + "_workerId=" + workerId + "_assignmentId=" + assignmentId + "_hitId=" + hitId
            request.identity match {
              case Some(user) =>
                //Have different cases when the user.username is the same as the workerId and when it isnt
                user.username match{
                  case `workerId` =>
                    val confirmationCode = Some(s"${Random.alphanumeric take 8 mkString("")}")
                    activityLogText = activityLogText + "_reattempt=true"
                    val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, None, workerId, confirmationCode)
                    val asgId: Option[Int] = Option(AMTAssignmentTable.save(asg))
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
                    Future.successful(Redirect("/audit"))
                  case _ =>
                    Future.successful(Redirect(routes.UserController.signOut(request.uri)))
                    //Need to be able to be able to login as a different user here
                    // but the signout redirect isnt working
                }
              case None =>
                //Add an entry into the amt_assignment table
                val confirmationCode = Some(s"${Random.alphanumeric take 8 mkString("")}")
                val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, None, workerId, confirmationCode)
                val asgId: Option[Int] = Option(AMTAssignmentTable.save(asg))
                // Since the turker doesnt exist in the user table create a new record with the role set to "Turker"
                val redirectTo = List("turkerSignUp",hitId, workerId, assignmentId).reduceLeft(_ +"/"+ _)
                Future.successful(Redirect(redirectTo))
            }

          case _ =>
            val redirectTo: String = qString.get("to") match{
              case Some(to) =>
                to
              case None =>
                "/"
            }

            val activityLogText: String = "Referrer=" + ref + "_SendTo=" + redirectTo
            request.identity match {
              case Some(user) =>
                WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
                Future.successful(Redirect(redirectTo))
              case None =>
                WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, activityLogText, timestamp))
                Future.successful(Redirect(redirectTo))
            }
        }
      case None =>
        // When there are no referrers, just load the landing page but store the query parameters that were passed anyway
        val activityLogText: String = "/?"+qString.keys.map(i => i.toString +"="+ qString(i).toString).mkString("&")
        request.identity match {
          case Some(user) =>
            if(qString.isEmpty){
              WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Index", timestamp))
              Future.successful(Ok(views.html.index("Project Sidewalk", Some(user))))
            } else{
              WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
              Future.successful(Redirect("/"))
            }
          case None =>
            if(qString.isEmpty){
              WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "Visit_Index", timestamp))
              Future.successful(Ok(views.html.index("Project Sidewalk")))
            } else{
              WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, activityLogText, timestamp))
              Future.successful(Redirect("/"))
            }
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

  def noAvailableMissionIndex = UserAwareAction.async { implicit request =>
    Future.successful(Ok(views.html.noAvailableMissionIndex("Project Sidewalk")))
  }

}
