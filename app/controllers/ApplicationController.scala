package controllers

import controllers.base._
import controllers.helper.ControllerUtils
import controllers.helper.ControllerUtils.parseIntegerSeq
import models.auth.{DefaultEnv, WithSignedIn}
import models.label.LabelTypeEnum
import models.user.SidewalkUserWithRole
import models.utils.{MyPostgresProfile, WebpageActivity}
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, Messages}
import play.api.mvc._
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import service._

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ApplicationController @Inject()(cc: CustomControllerComponents,
                                      protected val dbConfigProvider: DatabaseConfigProvider,
                                      val silhouette: Silhouette[DefaultEnv],
                                      val config: Configuration,
                                      configService: ConfigService,
                                      userService: UserService,
                                      streetService: StreetService,
                                      labelService: LabelService,
                                      validationService: ValidationService,
                                      regionService: RegionService
                                     )(implicit ec: ExecutionContext, assets: AssetsFinder)
  extends CustomBaseController(cc) with HasDatabaseConfigProvider[MyPostgresProfile] {
  implicit val implicitConfig: Configuration = config

  def index = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val timestamp: OffsetDateTime = OffsetDateTime.now
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
        val redirectTo: String = qString.getOrElse("to", "/")
        val activityLogText: String = s"Referrer=${ref}_SendTo=$redirectTo"
        cc.loggingService.insert(WebpageActivity(0, user.userId, ipAddress, activityLogText, timestamp))
        Future.successful(Redirect(redirectTo))
      case None =>
        // When there are no referrers, load the landing page but store the query parameters that were passed anyway.
        if (qString.nonEmpty) {
          // Log the query string parameters if they exist, but do a redirect to hide them.
          cc.loggingService.insert(WebpageActivity(0, user.userId, ipAddress, request.uri, timestamp))
          Future.successful(Redirect("/"))
        } else if (isMobile) {
          Future.successful(Redirect("/mobile"))
        } else {
          cc.loggingService.insert(WebpageActivity(0, user.userId, ipAddress, "Visit_Index", timestamp))
          // Get names and URLs for other cities so we can link to them on landing page.
          val metric: Boolean = Messages("measurement.system") == "metric"
          for {
            commonData <- configService.getCommonPageData(request2Messages.lang)
            openStatus: String <- configService.getOpenStatus
            mapathonLink: Option[String] <- configService.getMapathonEventLink
            auditedDist: Float <- streetService.getAuditedStreetDistance(metric)
            streetDist: Float <- streetService.getTotalStreetDistance(metric)
            labelCount: Int <- labelService.countLabels
            valCount: Int <- validationService.countValidations
          } yield {
            Ok(views.html.index("Project Sidewalk", commonData, user, openStatus, mapathonLink, streetDist, auditedDist, labelCount, valCount))
          }
        }
    }
  }

  def leaderboard = cc.securityService.SecuredAction { implicit request =>
    val countryId: String = configService.getCurrentCountryId
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      overallLeaders <- userService.getLeaderboardStats(10)
      teamLeaders <- userService.getLeaderboardStats(10, "overall", byTeam = true)
      weeklyLeaders <- userService.getLeaderboardStats(10, "weekly")
      currTeamLeaders <- userService.getLeaderboardStats(10, "overall", byTeam = false, Some(request.identity.userId))
      userTeam <- userService.getUserTeam(request.identity.userId)
    } yield {
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Leaderboard")
      Ok(views.html.leaderboard("Sidewalk - Leaderboard", commonData, request.identity, overallLeaders, teamLeaders, weeklyLeaders, currTeamLeaders, userTeam, countryId))
    }
  }

  /**
   * Updates user language preference cookie, returns to current page.
   */
  def changeLanguage(url: String, newLang: String, clickLocation: Option[String]) = cc.securityService.SecuredAction { implicit request =>
    // Build logger string.
    val oldLang: String = messagesApi.preferred(request).lang.code
    val clickLoc: String = clickLocation.getOrElse("Unknown")
    val logText: String = s"Click_module=ChangeLanguage_from=${oldLang}_to=${newLang}_location=${clickLoc}_route=${url}"

    // Log the interaction. Moved the logging here from navbar.scala.html b/c the redirect was happening too fast.
    cc.loggingService.insert(request.identity.userId, request.remoteAddress, logText)

    // Update the cookie and redirect.
    Future.successful(Redirect(url).withLang(Lang(newLang)))
  }

  /**
   * Returns a help  page.
   */
  def help = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Help")
      Ok(views.html.help(commonData, "Sidewalk - Help", request.identity))
    }
  }

  /**
   * Returns labeling guide page.
   */
  def labelingGuide = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide")
      Ok(views.html.labelingGuide.labelingGuide(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  def labelingGuideCurbRamps = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide_Curb_Ramps")
      Ok(views.html.labelingGuide.labelingGuideCurbRamps(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  def labelingGuideSurfaceProblems = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide_Surface_Problems")
      Ok(views.html.labelingGuide.labelingGuideSurfaceProblems(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  def labelingGuideObstacles = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide_Obstacles")
      Ok(views.html.labelingGuide.labelingGuideObstacles(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  def labelingGuideNoSidewalk = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide_No_Sidewalk")
      Ok(views.html.labelingGuide.labelingGuideNoSidewalk(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  def labelingGuideOcclusion = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Labeling_Guide_Occlusion")
      Ok(views.html.labelingGuide.labelingGuideOcclusion(commonData, "Sidewalk - Labeling Guide", request.identity))
    }
  }

  /**
   * Returns the terms page.
   */
  def terms = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Terms")
      Ok(views.html.terms(commonData, "Sidewalk - Terms", request.identity))
    }
  }

  /**
   * Returns the LabelMap page that contains a cool visualization.
   */
  def labelMap(regions: Option[String], routes: Option[String]) = cc.securityService.SecuredAction { implicit request =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val routeIds: Seq[Int] = parseIntegerSeq(routes)
    val activityStr: String = if (regions.isEmpty) "Visit_LabelMap" else s"Visit_LabelMap_Regions=$regions"

    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, activityStr)
      Ok(views.html.apps.labelMap(commonData, "Sidewalk - LabelMap", request.identity, regionIds, routeIds))
    }
  }

  /**
   * Returns the Gallery page.
   */
  def gallery(labelType: String, neighborhoods: String, severities: String, tags: String, validationOptions: String) = cc.securityService.SecuredAction { implicit request =>
    val labelTypes: Seq[(String, String)] = Seq(
      ("Assorted", Messages("gallery.all")),
      (LabelTypeEnum.CurbRamp.name, Messages("curb.ramp")),
      (LabelTypeEnum.NoCurbRamp.name, Messages("missing.ramp")),
      (LabelTypeEnum.Obstacle.name, Messages("obstacle")),
      (LabelTypeEnum.SurfaceProblem.name, Messages("surface.problem")),
      (LabelTypeEnum.Occlusion.name, Messages("occlusion")),
      (LabelTypeEnum.NoSidewalk.name, Messages("no.sidewalk")),
      (LabelTypeEnum.Crosswalk.name, Messages("crosswalk")),
      (LabelTypeEnum.Signal.name, Messages("signal")),
      (LabelTypeEnum.Other.name, Messages("other"))
    )
    val labType: String = if (labelTypes.exists(x => { x._1 == labelType })) labelType else "Assorted"

    for {
      possibleRegions: Seq[Int] <- regionService.getAllRegions.map(_.map(_.regionId))
      possibleTags: Seq[String] <- {
        if (labType != "Assorted") db.run(labelService.selectTagsByLabelType(labelType).map(_.map(_.tag)))
        else Future.successful(Seq())
      }
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      // Make sure that list of region IDs, severities, and validation options are formatted correctly.
      val regionIdsList: Seq[Int] = parseIntegerSeq(neighborhoods).filter(possibleRegions.contains)
      val severityList: Seq[Int] = parseIntegerSeq(severities).filter(s => s > 0 && s < 6)
      val tagList: List[String] = tags.split(",").filter(possibleTags.contains).toList
      val valOptions: Seq[String] = validationOptions.split(",").filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq

      // Log visit to Gallery async.
      val activityStr: String = s"Visit_Gallery_LabelType=${labType}_RegionIDs=${regionIdsList}_Severity=${severityList}_Tags=${tagList}_Validations=$valOptions"
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, activityStr)

      Ok(views.html.apps.gallery(commonData, "Sidewalk - Gallery", request.identity, labType, labelTypes, regionIdsList, severityList, tagList, valOptions))
    }
  }

  /**
   * Returns a page with instructions for users who want to receive community service hours.
   */
  def serviceHoursInstructions = cc.securityService.SecuredAction { implicit request =>
    val isMobile: Boolean = ControllerUtils.isMobile(request)
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_ServiceHourInstructions")
      Ok(views.html.serviceHoursInstructions(commonData, request.identity, isMobile))
    }
  }

  /**
   * Returns a page that simply shows how long the sign in user has spent using Project Sidewalk.
   */
  def timeCheck = cc.securityService.SecuredAction(WithSignedIn()) { implicit request: SecuredRequest[DefaultEnv, AnyContent] =>
    val isMobile: Boolean = ControllerUtils.isMobile(request)
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      timeSpent: Float <- userService.getHoursAuditingAndValidating(request.identity.userId)
    } yield {
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_TimeCheck")
      Ok(views.html.timeCheck(commonData, request.identity, isMobile, timeSpent))
    }
  }

  def routeBuilder = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_RouteBuilder")
      Ok(views.html.apps.routeBuilder(commonData, request.identity))
    }
  }
}
