package controllers

import java.sql.Timestamp
import java.time.Instant
import scala.collection.JavaConverters._
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.street.StreetEdgeTable
import play.api.Play
import play.api.Play.current
import play.api.i18n.Messages

import java.util.Calendar
import play.api.mvc._

import scala.concurrent.Future
import scala.util.Random

/**
 * Holds the HTTP requests for some of the basic web pages.
 *
 * @param env The Silhouette environment.
 */
class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Logs that someone is coming to the site using a custom URL, then redirects to the specified page.
    * If no referrer is specified, then it just loads the landing page.
    */
  def index = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress
    val qString = request.queryString.map { case (k, v) => k.mkString -> v.mkString }

    val referrer: Option[String] = qString.get("referrer") match {
      case Some(r) => Some(r)
      case None    => qString.get("r")
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
                user.username match {
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
            val redirectTo: String = qString.get("to") match {
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
              // Get city configs.
              val cityStr: String = Play.configuration.getString("city-id").get
              val cityName: String = Play.configuration.getString("city-params.city-name." + cityStr).get
              val stateAbbreviation: String = Play.configuration.getString("city-params.state-abbreviation." + cityStr).get
              val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
              val mapathonLink: Option[String] = Play.configuration.getString("city-params.mapathon-event-link." + cityStr)
              // Get names and URLs for other cities so we can link to them on landing page.
              val otherCityUrls: List[(String, String, String, String)] = getAllCityInfo(excludeCity=cityStr)
              // Get total audited distance. If using metric system, convert from miles to kilometers.
              val auditedDistance: Float =
                if (Messages("measurement.system") == "metric") StreetEdgeTable.auditedStreetDistance(1) * 1.60934.toFloat
                else StreetEdgeTable.auditedStreetDistance(1)
              Future.successful(Ok(views.html.index("Project Sidewalk", Some(user), cityName, stateAbbreviation, cityShortName, mapathonLink, cityStr, otherCityUrls, auditedDistance)))
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
   * Returns list of all cities -- (city, name + ", " + state, cityURL, visiblity) -- excluding the city specified
   */
  def getAllCityInfo(excludeCity: String = ""): List[(String, String, String, String)] = {
    val envType: String = Play.configuration.getString("environment-type").get
    // Get names and URLs for cities to display in Gallery dropdown
    val cities: List[String] =
      Play.configuration.getStringList("city-params.city-ids").get.asScala.toList.filterNot(_ == excludeCity)
    val cityUrls: List[(String, String, String, String)] = cities.map { city =>
      val name: String = Play.configuration.getString("city-params.city-name." + city).get
      val state: String = Play.configuration.getString("city-params.state-abbreviation." + city).get
      val cityURL: String = Play.configuration.getString("city-params.landing-page-url." + envType + "." + city).get
      val visiblity: String = Play.configuration.getString("city-params.status." + city).get
      (city, name + ", " + state, cityURL, visiblity)
    }
    cityUrls
  }

  /**
   * Returns a page with the Leaderboard(s) on it.
   */
  def leaderboard = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Leaderboard", timestamp))
        Future.successful(Ok(views.html.leaderboardPage("Project Sidewalk - Leaderboard", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/leaderboard"))
    }
  }

  /**
   * Updates user language preference cookie, returns to current page.
   */
  def changeLanguage(url: String, newLang: String, clickLocation: Option[String]) = UserAwareAction.async { implicit request =>

    // Build logger string.
    val user: String = request.identity.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress
    val oldLang: String = request2lang.code
    val clickLoc: String = clickLocation.getOrElse("Unknown")
    val logText: String = s"Click_module=ChangeLanguage_from=${oldLang}_to=${newLang}_location=${clickLoc}_route=${url}"

    // Log the interaction. Moved the logging here from navbar.scala.html b/c the redirect was happening too fast.
    WebpageActivityTable.save(WebpageActivity(0, user, ipAddress, logText, timestamp))

    // Update the cookie and redirect.
    Future.successful(Redirect(url).withCookies(Cookie("PLAY_LANG", newLang)))
  }

  /**
    * Returns a developer page.
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
    * Returns labeling guide page.
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
    * Returns the maintenance page.
    */
  def maintenance = UserAwareAction.async { implicit request =>
    val user: String = request.identity.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    WebpageActivityTable.save(WebpageActivity(0, user, ipAddress, "Visit_Maintenance", timestamp))
    Future.successful(Ok(views.html.maintenance("Project Sidewalk - Maintenance")))
  }

  /**
   * Returns the results page that contains a cool visualization.
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
   * Returns the labelmap page that contains a cool visualization.
   */
  def labelMap = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_LabelMap", timestamp))
        Future.successful(Ok(views.html.labelMap("Project Sidewalk - Explore Accessibility", Some(user))))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/labelmap"))
    }
  }

  /**
   * Returns the Gallery page.
   */
  def gallery(label: Option[String], severity: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress

        // Log visit to Gallery
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Gallery", timestamp))
        // Get current city
        val cityStr: String = Play.configuration.getString("city-id").get
        // Get names and URLs for cities to display in Gallery dropdown
        val cityUrls: List[(String, String, String, String)] = getAllCityInfo()
        val labels: List[(String, String)] = List(
          ("Assorted", Messages("gallery.all")),
          ("CurbRamp", Messages("curb.ramp")),
          ("NoCurbRamp", Messages("missing.ramp")),
          ("Obstacle", Messages("obstacle")),
          ("SurfaceProblem", Messages("surface.problem")),
          ("Occlusion", Messages("gallery.occlusion")),
          ("NoSidewalk", Messages("no.sidewalk")),
          ("Crosswalk", Messages("crosswalk")),
          ("Signal", Messages("signal")),
          ("Other", Messages("other"))
        )
        val realLabel: String = if (labels.exists(x => {x._1 == label.getOrElse("Assorted")})) {
          label.getOrElse("Assorted")
        } else {
          "Assorted"
        }
        Future.successful(Ok(views.html.gallery("Gallery", Some(user), cityStr, cityUrls, realLabel, labels, List())))
      case None =>
        // Send them through anon signup so that there activities on sidewalk gallery are logged as anon
        Future.successful(Redirect("/anonSignUp?url=/gallery"))
    }
  }

  /**
    * Returns the demo page that contains a cool visualization that is a work-in-progress.
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
    * Returns a page telling the turker that they already signed in with their worker id.
    */
  def turkerIdExists = Action.async { implicit request =>
    Future.successful(Ok(views.html.turkerIdExists("Project Sidewalk")))
  }
}
