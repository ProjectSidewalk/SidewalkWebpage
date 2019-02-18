package controllers

import java.sql.Timestamp
import java.time.Instant

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import play.api.Play
import play.api.Play.current
import java.util.Calendar
import play.api.mvc._

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
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
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
            // The referrer is mechanical turk.
            val workerId: String = qString.get("workerId").get
            val assignmentId: String = qString.get("assignmentId").get
            val hitId: String = qString.get("hitId").get
            val minutes: Int = qString.get("minutes").get.toInt

            var cal = Calendar.getInstance
            cal.setTimeInMillis(timestamp.getTime)
            cal.add(Calendar.MINUTE, minutes)
            val asmtEndTime = new Timestamp(cal.getTime.getTime)

            var activityLogText: String = "Referrer=" + ref + "_workerId=" + workerId + "_assignmentId=" + assignmentId + "_hitId=" + hitId + "_minutes=" + minutes.toString
            request.identity match {
              case Some(user) =>
                // Have different cases when the user.username is the same as the workerId and when it isn't.
                user.username match{
                  case `workerId` =>
                    activityLogText = activityLogText + "_reattempt=true"
                    // Unless they are mid-assignment, create a new assignment.
                    val asmt: Option[AMTAssignment] = AMTAssignmentTable.getAssignment(workerId, assignmentId)
                    if (asmt.isEmpty) {
                      val confirmationCode = s"${Random.alphanumeric take 8 mkString("")}"
                      val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, asmtEndTime, workerId, confirmationCode, false)
                      val asgId: Option[Int] = Option(AMTAssignmentTable.save(asg))
                    }
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
                    Future.successful(Redirect("/audit"))
                  case _ =>
                    Future.successful(Redirect(routes.UserController.signOut(request.uri)))
                    // Need to be able to login as a different user here, but the signout redirect isn't working.
                }
              case None =>
                // Unless they are mid-assignment, create a new assignment.
                val asmt: Option[AMTAssignment] = AMTAssignmentTable.getAssignment(workerId, assignmentId)
                if (asmt.isEmpty) {
                  val confirmationCode = s"${Random.alphanumeric take 8 mkString("")}"
                  val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, asmtEndTime, workerId, confirmationCode, false)
                  val asgId: Option[Int] = Option(AMTAssignmentTable.save(asg))
                }
                // Since the turker doesn't exist in the sidewalk_user table create new record with Turker role.
                val redirectTo = List("turkerSignUp", hitId, workerId, assignmentId).reduceLeft(_ +"/"+ _)
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
                // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
                Future.successful(Redirect("/anonSignUp?url=/%3F" + request.rawQueryString.replace("&", "%26")))
            }
        }
      case None =>
        // When there are no referrers, load the landing page but store the query parameters that were passed anyway.
        val activityLogText: String = "/?"+qString.keys.map(i => i.toString +"="+ qString(i).toString).mkString("&")
        request.identity match {
          case Some(user) =>
            if(qString.isEmpty){
              WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Index", timestamp))
              val cityStr: String = Play.configuration.getString("city-id").get
              val cityName: String = Play.configuration.getString("city-params.city-name." + cityStr).get
              val stateAbbreviation: String = Play.configuration.getString("city-params.state-abbreviation." + cityStr).get
              val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
              Future.successful(Ok(views.html.index("Project Sidewalk", Some(user), cityName, stateAbbreviation, cityShortName)))
            } else{
              WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
              Future.successful(Redirect("/"))
            }
          case None =>
            if(qString.isEmpty){
              Future.successful(Redirect("/anonSignUp?url=/"))
            } else{
              // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
              Future.successful(Redirect("/anonSignUp?url=/%3F" + request.rawQueryString.replace("&", "%26")))
            }
        }
    }
  }

  /**
    * Returns an about page.
    *
    * @return
    */
  def about = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_About", timestamp))
        Future.successful(Ok(views.html.about("Project Sidewalk - About", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/about"))
    }
  }

  /**
    * Returns a page saying that we do not yet support mobile devices.
    *
    * @return
    */
  def mobile = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_MobileIndex", timestamp))
        Future.successful(Ok(views.html.mobile("Project Sidewalk", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/mobile"))
    }
  }

  /**
    * Returns a developer page.
    *
    * @return
    */
  def developer = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Developer", timestamp))
        Future.successful(Ok(views.html.developer("Project Sidewalk - Developers", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/developer"))
    }
  }

  /**
    * Returns a help  page.
    *
    * @return
    */
  def help = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Help", timestamp))
        Future.successful(Ok(views.html.help("Project Sidewalk - Help", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/help"))
    }
  }

  /**
    * Returns labeling guide page
    * @return
    */

  def labelingGuide = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide", timestamp))
        Future.successful(Ok(views.html.labelingGuide("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide"))
    }
  }

  def labelingGuideCurbRamps = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide_Curb_Ramps", timestamp))
        Future.successful(Ok(views.html.labelingGuideCurbRamps("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide/curbRamps"))
    }
  }

  def labelingGuideSurfaceProblems = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide_Surface_Problems", timestamp))
        Future.successful(Ok(views.html.labelingGuideSurfaceProblems("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide/surfaceProblems"))
    }
  }

  def labelingGuideObstacles = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide_Obstacles", timestamp))
        Future.successful(Ok(views.html.labelingGuideObstacles("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide/obstacles"))
    }
  }

  def labelingGuideNoSidewalk = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide_No_Sidewalk", timestamp))
        Future.successful(Ok(views.html.labelingGuideNoSidewalk("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide/noSidewalk"))
    }
  }

  def labelingGuideOcclusion = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Labeling_Guide_Occlusion", timestamp))
        Future.successful(Ok(views.html.labelingGuideOcclusion("Project Sidewalk - Labeling Guide", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelingGuide/occlusion"))
    }
  }

  /**
    * Returns the terms page.
    *
    * @return
    */
  def terms = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Terms", timestamp))
        Future.successful(Ok(views.html.terms("Project Sidewalk - Terms", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/terms"))
    }
  }

  /**
    * Returns the results page that contains a cool visualization.
    *
    * @return
    */
  def results = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Results", timestamp))
        Future.successful(Ok(views.html.results("Project Sidewalk - Explore Accessibility", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/results"))
    }
  }

  /**
    * Returns the demo page that contains a cool visualization that is a work-in-progress.
    *
    * @return
    */
  def demo = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Map", timestamp))
        val cityStr: String = Play.configuration.getString("city-id").get
        val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
        Future.successful(Ok(views.html.accessScoreDemo("Project Sidewalk - Explore Accessibility", Some(user), cityShortName)))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/demo"))
    }
  }

  /**
    * Returns a page that tells Turkers that there are no further missions for them to complete at this time.
    *
    * @return
    */
  def noAvailableMissionIndex = Action.async { implicit request =>
    Future.successful(Ok(views.html.noAvailableMissionIndex("Project Sidewalk")))
  }

  /**
    * Returns a page telling the turker that they already signed in with their worker id.
    *
    * @return
    */
  def turkerIdExists = Action.async { implicit request =>
    Future.successful(Ok(views.html.turkerIdExists("Project Sidewalk")))
  }

}
