package controllers

import javax.inject._
import play.api.mvc._
import play.api.i18n.{I18nSupport, Lang, Messages, MessagesApi}

import scala.concurrent.Future
import service.{LabelService, StreetService, ValidationService}
import service.user.UserStatService
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import controllers.helper.ControllerUtils
import controllers.helper.ControllerUtils.{anonSignupRedirect, parseIntegerSeq}
import models.user.SidewalkUserWithRole
import models.utils.WebpageActivity
import play.api.Configuration
import play.api.Play.current
import service.region.RegionService
import service.utils.{CityInfo, ConfigService, WebpageActivityService}

import java.sql.Timestamp
import java.time.Instant
import java.util.Calendar

@Singleton
class ApplicationController @Inject()(
                                       val messagesApi: MessagesApi,
                                       val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                       val config: Configuration,
                                       webpageActivityService: WebpageActivityService,
                                       configService: ConfigService,
                                       userStatService: UserStatService,
                                       streetService: StreetService,
                                       labelService: LabelService,
                                       validationService: ValidationService,
                                       regionService: RegionService
                                     ) extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] with I18nSupport {
  implicit val implicitConfig = config

  def index = UserAwareAction.async { implicit request =>
//    println("All Cookies: " + request.cookies.mkString(", "))
//    println("Authenticator Cookie: " + request.cookies.get("authenticator"))
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress
    val isMobile: Boolean = ControllerUtils.isMobile(request)
    val qString: Map[String, String] = request.queryString.map { case (k, v) => k.mkString -> v.mkString }

    val referrer: Option[String] = qString.get("referrer") match {
      case Some(r) => Some(r)
      case None    => qString.get("r")
    }

    referrer match {
      // If someone is coming to the site from a custom URL, log it, and send them to the correct location.
      case Some(ref) =>
        ref match {
          case "mturk" =>
            // TODO a bunch of stuff here should go in a service I think?
            // The referrer is mechanical turk.
            val workerId: String = qString("workerId")
            val assignmentId: String = qString("assignmentId")
            val hitId: String = qString("hitId")
            val minutes: Int = qString("minutes").toInt

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
//                    val asmt: Option[AMTAssignment] = AMTAssignmentTable.getAssignment(workerId, assignmentId)
//                    if (asmt.isEmpty) {
//                      val confirmationCode = s"${Random.alphanumeric take 8 mkString("")}"
//                      val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, asmtEndTime, workerId, confirmationCode, false)
//                      val asgId: Option[Int] = Option(AMTAssignmentTable.insert(asg))
//                    }
                    webpageActivityService.insert(WebpageActivity(0, user.userId, ipAddress, activityLogText, timestamp))
                    Future.successful(Redirect("/explore"))
                  case _ =>
                    Future.successful(Redirect(routes.UserController.signOut(request.uri)))
                  // Need to be able to log in as a different user here, but the sign-out redirect isn't working.
                }
              case None =>
                // Unless they are mid-assignment, create a new assignment.
//                val asmt: Option[AMTAssignment] = AMTAssignmentTable.getAssignment(workerId, assignmentId)
//                if (asmt.isEmpty) {
//                  val confirmationCode = s"${Random.alphanumeric take 8 mkString("")}"
//                  val asg: AMTAssignment = AMTAssignment(0, hitId, assignmentId, timestamp, asmtEndTime, workerId, confirmationCode, false)
//                  val asgId: Option[Int] = Option(AMTAssignmentTable.insert(asg))
//                }
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
                webpageActivityService.insert(WebpageActivity(0, user.userId, ipAddress, activityLogText, timestamp))
                Future.successful(Redirect(redirectTo))
              case None =>
                Future.successful(anonSignupRedirect(request))
            }
        }
      case None =>
        // When there are no referrers, load the landing page but store the query parameters that were passed anyway.
        request.identity match {
          case Some(user) =>
            if (qString.nonEmpty) {
              // Log the query string parameters if they exist, but do a redirect to hide them.
              webpageActivityService.insert(WebpageActivity(0, user.userId, ipAddress, request.uri, timestamp))
              Future.successful(Redirect("/"))
            } else if (isMobile) {
              Future.successful(Redirect("/mobile"))
            } else {
              webpageActivityService.insert(WebpageActivity(0, user.userId, ipAddress, "Visit_Index", timestamp))
              // Get names and URLs for other cities so we can link to them on landing page.
              val metric: Boolean = Messages("measurement.system") == "metric"
              for {
                commonData <- configService.getCommonPageData(request2Messages.lang)
                openStatus: String <- configService.getOpenStatus
                mapathonLink: Option[String] <- configService.getMapathonEventLink
                auditedDist: Float <- streetService.getAuditedStreetDistance(metric)
                streetDist: Float <- streetService.getTotalStreetDistance(metric)
                labelCount: Int <- labelService.countLabels()
                valCount: Int <- validationService.countValidations
              } yield {
                Ok(views.html.index("Project Sidewalk", commonData, user, openStatus, mapathonLink, auditedDist, streetDist, labelCount, valCount))
              }
            }
          case None =>
            Future.successful(anonSignupRedirect(request))
        }
    }
  }

  def leaderboard = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Leaderboard")

        val countryId: String = configService.getCurrentCountryId
        for {
          commonData <- configService.getCommonPageData(request2Messages.lang)
          overallLeaders <- userStatService.getLeaderboardStats(10)
          orgLeaders <- userStatService.getLeaderboardStats(10, "overall", true)
          weeklyLeaders <- userStatService.getLeaderboardStats(10, "weekly")
          //      currOrgLeaders <- userStatService.getLeaderboardStats(10, "overall", false, UserOrgTable.getAllOrgs(user.get.userId).headOption)
        } yield {
          Ok(views.html.leaderboard("Sidewalk - Leaderboard", commonData, user, overallLeaders, orgLeaders, weeklyLeaders, List.empty, countryId))
        }
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Updates user language preference cookie, returns to current page.
   */
  def changeLanguage(url: String, newLang: String, clickLocation: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // Build logger string.
        val oldLang: String = request2lang.code
        val clickLoc: String = clickLocation.getOrElse("Unknown")
        val logText: String = s"Click_module=ChangeLanguage_from=${oldLang}_to=${newLang}_location=${clickLoc}_route=${url}"

        // Log the interaction. Moved the logging here from navbar.scala.html b/c the redirect was happening too fast.
        webpageActivityService.insert(user.userId, request.remoteAddress, logText)

        // Update the cookie and redirect.
        Future.successful(Redirect(url).withLang(Lang(newLang)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the API page.
   */
  def api = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Developer")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.api(commonData, "Sidewalk - API", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns a help  page.
   */
  def help = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Help")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.help(commonData, "Sidewalk - Help", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns labeling guide page.
   */
  def labelingGuide = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuide(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def labelingGuideCurbRamps = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide_Curb_Ramps")
        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuideCurbRamps(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def labelingGuideSurfaceProblems = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide_Surface_Problems")
        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuideSurfaceProblems(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def labelingGuideObstacles = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide_Obstacles")
        
        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuideObstacles(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def labelingGuideNoSidewalk = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide_No_Sidewalk")
        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuideNoSidewalk(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def labelingGuideOcclusion = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Labeling_Guide_Occlusion")
        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelingGuideOcclusion(commonData, "Sidewalk - Labeling Guide", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the terms page.
   */
  def terms = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Terms")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.terms(commonData, "Sidewalk - Terms", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the results page that contains a cool visualization.
   */
  def results = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Results")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.results(commonData, "Sidewalk - Results", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the LabelMap page that contains a cool visualization.
   */
  def labelMap(regions: Option[String], routes: Option[String]) = UserAwareAction.async { implicit request =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val routeIds: Seq[Int] = parseIntegerSeq(routes)
    request.identity match {
      case Some(user) =>
        val activityStr: String = if (regions.isEmpty) "Visit_LabelMap" else s"Visit_LabelMap_Regions=$regions"
        webpageActivityService.insert(user.userId, request.remoteAddress, activityStr)

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.labelMap(commonData, "Sidewalk - LabelMap", user, regionIds, routeIds)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the Gallery page.
   */
  def gallery(labelType: String, neighborhoods: String, severities: String, tags: String, validationOptions: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // Get names and URLs for cities to display in Gallery dropdown.
        val cityInfo: Seq[CityInfo] = configService.getAllCityInfo(request2Messages.lang)
        val labelTypes: List[(String, String)] = List(
          ("Assorted", Messages("gallery.all")),
          ("CurbRamp", Messages("curb.ramp")),
          ("NoCurbRamp", Messages("missing.ramp")),
          ("Obstacle", Messages("obstacle")),
          ("SurfaceProblem", Messages("surface.problem")),
          ("Occlusion", Messages("occlusion")),
          ("NoSidewalk", Messages("no.sidewalk")),
          ("Crosswalk", Messages("crosswalk")),
          ("Signal", Messages("signal")),
          ("Other", Messages("other"))
        )
        val labType: String = if (labelTypes.exists(x => { x._1 == labelType })) labelType else "Assorted"

        for {
          possibleRegions: Seq[Int] <- regionService.getAllRegions.map(_.map(_.regionId))
          possibleTags: Seq[String] <- {
            if (labType != "Assorted") labelService.selectTagsByLabelType(labelType).map(_.map(_.tag))
            else Future.successful(List())
          }
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          // Make sure that list of region IDs, severities, and validation options are formatted correctly.
          val regionIdsList: Seq[Int] = parseIntegerSeq(neighborhoods).filter(possibleRegions.contains)
          val severityList: Seq[Int] = parseIntegerSeq(severities).filter(s => s > 0 && s < 6)
          val tagList: Seq[String] = tags.split(",").filter(possibleTags.contains).toList
          val valOptions: Seq[String] = validationOptions.split(",").filter(List("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq

          // Log visit to Gallery async.
          val activityStr: String = s"Visit_Gallery_LabelType=${labType}_RegionIDs=${regionIdsList}_Severity=${severityList}_Tags=${tagList}_Validations=$valOptions"
          webpageActivityService.insert(user.userId, request.remoteAddress, activityStr)

          Ok(views.html.gallery(commonData, "Sidewalk - Gallery", user, labType, labelTypes, regionIdsList, severityList, tagList, valOptions))
        }
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns a page with instructions for users who want to receive community service hours.
   */
  def serviceHoursInstructions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_ServiceHourInstructions")
        val isMobile: Boolean = ControllerUtils.isMobile(request)

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.serviceHoursInstructions(commonData, user, isMobile)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns a page that simply shows how long the sign in user has spent using Project Sidewalk.
   */
  def timeCheck = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        if (user.role == "Anonymous") {
          Future.failed(new IdentityNotFoundException("Please log in before trying to access this page."))
        } else {
          webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_TimeCheck")

          val isMobile: Boolean = ControllerUtils.isMobile(request)
          for {
            commonData <- configService.getCommonPageData(request2Messages.lang)
            timeSpent: Float <- userStatService.getHoursAuditingAndValidating(user.userId)
          } yield {
            Ok(views.html.timeCheck(commonData, user, isMobile, timeSpent))
          }
        }
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  def routeBuilder = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_RouteBuilder")
        for {
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          Ok(views.html.routeBuilder(commonData, user))
        }
      case None => Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the demo page that contains a cool visualization that is a work-in-progress.
   */
  def demo = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Map")

        configService.getCommonPageData(request2Messages.lang)
          .map(commonData => Ok(views.html.accessScoreDemo(commonData, "Sidewalk - AccessScore", user)))
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns a page telling the turker that they already signed in with their worker id.
   */
  def turkerIdExists = UserAwareAction.async { implicit request =>
    configService.getCommonPageData(request2Messages.lang)
      .map(commonData => Ok(views.html.turkerIdExists(commonData, "Project Sidewalk", request.identity)))
  }
}
