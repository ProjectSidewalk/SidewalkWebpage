package controllers

import controllers.base.*
import controllers.helper.ControllerUtils
import controllers.helper.ControllerUtils.{parseIntegerSeq, safeLocalPath}
import models.auth.{DefaultEnv, WithSignedIn}
import models.user.{SidewalkUserWithRole, UserUtm}
import models.utils.IpAddress
import play.api.Configuration
import play.api.i18n.{Lang, Messages}
import play.api.mvc.*
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import service.*

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ApplicationController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: ConfigService,
    userService: UserService,
    streetService: StreetService,
    labelService: LabelService,
    validationService: ValidationService,
    partnerService: PartnerService
)(using ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {
  given Configuration = config

  def index = cc.securityService.UserAwareAction { implicit request =>
    val user: Option[SidewalkUserWithRole] = request.identity
    val timestamp: OffsetDateTime          = OffsetDateTime.now
    val ipAddress: IpAddress               = request.ipAddress
    val isMobile: Boolean                  = ControllerUtils.isMobile
    val qString: Map[String, String]       = request.queryString.map { case (k, v) => k.mkString -> v.mkString }

    val referrer: Option[String] = qString.get("referrer") match {
      case Some(r) => Some(r)
      case None    => qString.get("r")
    }

    referrer match {
      // If someone is coming to the site from a custom URL, log it, and send them to the correct location.
      case Some(ref) =>
        val redirectTo: String      = safeLocalPath(qString.getOrElse("to", "/"))
        val activityLogText: String = s"Referrer=${ref}_SendTo=$redirectTo"
        cc.loggingService.insert(user.map(_.userId), ipAddress, activityLogText, timestamp)
        Future.successful(Redirect(redirectTo))
      case None =>
        // When there are no referrers, load the landing page but store the query parameters that were passed anyway.
        if (qString.nonEmpty) {
          // Log the query string parameters if they exist, but do a redirect to hide them.
          cc.loggingService.insert(user.map(_.userId), ipAddress, request.uri, timestamp)
          // Awaited so a failed write surfaces to the error handler (#4229). No account yet: hold the visit in a cookie.
          val utm: Map[String, String] = ControllerUtils.utmParams(request.queryString)
          if (utm.isEmpty) Future.successful(Redirect("/"))
          else
            user match {
              case Some(u) =>
                userService
                  .insertUserUtm(UserUtm.fromParams(u.userId, utm, configService.getCityId, timestamp))
                  .map(_ => Redirect("/"))
              case None =>
                val visit = UserUtm.fromParams(ControllerUtils.NoUserId, utm, configService.getCityId, timestamp)
                val held  = ControllerUtils.utmVisitsFromCookie(request) :+ visit
                Future.successful(Redirect("/").withCookies(ControllerUtils.utmCookie(held, config)))
            }
        } else if (isMobile) {
          Future.successful(Redirect("/mobileLanding"))
        } else {
          cc.loggingService.insert(user.map(_.userId), ipAddress, "Visit_Index", timestamp)
          // Get names and URLs for other cities so we can link to them on landing page.
          val metric: Boolean = ControllerUtils.isMetric
          // Kicked off eagerly so it overlaps the queries below rather than adding a serial round trip.
          val partnersFuture        = partnerService.getPartnersForLanding
          val officialContactFuture = configService.getOfficialContact
          for {
            commonData                   <- configService.getCommonPageData(request2Messages.lang)
            openStatus: String           <- configService.getOpenStatus
            mapathonLink: Option[String] <- configService.getMapathonEventLink
            auditedDist: Double          <- streetService.getAuditedStreetDistance(metric)
            streetDist: Double           <- streetService.getTotalStreetDistance(metric)
            labelCount: Int              <- labelService.countLabels
            valCount: Int                <- validationService.countHumanValidations
            partners                     <- partnersFuture
            officialContact              <- officialContactFuture
          } yield {
            Ok(
              views.html.index(
                Messages("seo.title.landing", commonData.currentCity.cityNameShort),
                commonData,
                user,
                openStatus,
                mapathonLink,
                streetDist,
                auditedDist,
                labelCount,
                valCount,
                partners,
                officialContact
              )
            )
          }
        }
    }
  }

  def mobileLanding = cc.securityService.UserAwareAction { implicit request =>
    val user: Option[SidewalkUserWithRole] = request.identity
    cc.loggingService.insert(user.map(_.userId), request.ipAddress, "Visit_MobileLanding")
    // Kicked off eagerly so it overlaps the queries below rather than adding a serial round trip.
    val partnersFuture        = partnerService.getPartnersForLanding
    val officialContactFuture = configService.getOfficialContact
    for {
      commonData      <- configService.getCommonPageData(request2Messages.lang)
      labelCount: Int <- labelService.countLabels
      valCount: Int   <- validationService.countHumanValidations
      partners        <- partnersFuture
      officialContact <- officialContactFuture
    } yield {
      Ok(
        views.html.mobileLanding(
          Messages("seo.title.landing", commonData.currentCity.cityNameShort),
          commonData,
          user,
          labelCount,
          valCount,
          partners,
          officialContact
        )
      )
    }
  }

  /**
   * Updates user language preference cookie, returns to current page.
   */
  def changeLanguage(url: String, newLang: String, clickLocation: Option[String]) = cc.securityService.UserAwareAction {
    implicit request =>
      // Build logger string.
      val oldLang: String  = messagesApi.preferred(request).lang.code
      val clickLoc: String = clickLocation.getOrElse("Unknown")
      val logText: String = s"Click_module=ChangeLanguage_from=${oldLang}_to=${newLang}_location=${clickLoc}_route=$url"

      // Log the interaction. Moved the logging here from navbar.scala.html b/c the redirect was happening too fast.
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, logText)

      // Lang.get returns None for a malformed tag, which Lang() would throw on; an unsupported one is ignored too.
      val redirect = Redirect(safeLocalPath(url))
      Future.successful(Lang.get(newLang).filter(cc.langs.availables.contains).fold(redirect)(redirect.withLang))
  }

  /**
   * Returns the About page.
   */
  def about = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_About")
      Ok(views.html.about(commonData, Messages("seo.title.about"), request.identity))
    }
  }

  /**
   * Returns labeling guide page.
   */
  def labelingGuide = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Labeling_Guide")
      Ok(views.html.labelingGuide.labelingGuide(commonData, Messages("seo.title.labeling.guide"), request.identity))
    }
  }

  def labelingGuideCurbRamps = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Labeling_Guide_Curb_Ramps")
      Ok(
        views.html.labelingGuide
          .labelingGuideCurbRamps(commonData, Messages("seo.title.labeling.guide"), request.identity)
      )
    }
  }

  def labelingGuideSurfaceProblems = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.ipAddress,
        "Visit_Labeling_Guide_Surface_Problems"
      )
      Ok(
        views.html.labelingGuide
          .labelingGuideSurfaceProblems(commonData, Messages("seo.title.labeling.guide"), request.identity)
      )
    }
  }

  def labelingGuideObstacles = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Labeling_Guide_Obstacles")
      Ok(
        views.html.labelingGuide
          .labelingGuideObstacles(commonData, Messages("seo.title.labeling.guide"), request.identity)
      )
    }
  }

  def labelingGuideNoSidewalk = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Labeling_Guide_No_Sidewalk")
      Ok(
        views.html.labelingGuide
          .labelingGuideNoSidewalk(commonData, Messages("seo.title.labeling.guide"), request.identity)
      )
    }
  }

  def labelingGuideOcclusion = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Labeling_Guide_Occlusion")
      Ok(
        views.html.labelingGuide
          .labelingGuideOcclusion(commonData, Messages("seo.title.labeling.guide"), request.identity)
      )
    }
  }

  /**
   * Returns the terms page.
   */
  def terms = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Terms")
      Ok(views.html.terms(commonData, Messages("seo.title.terms"), request.identity))
    }
  }

  /**
   * Returns the LabelMap page that contains a cool visualization.
   *
   * Mobile visitors are served the page itself (it is responsive) rather than being redirected to /mobileLanding.
   * The label feed it loads is still the whole city's, unnarrowed by viewport (#5002).
   */
  def labelMap(regions: Option[String], routes: Option[String], aiValidationOptions: Option[String]) =
    cc.securityService.UserAwareAction { implicit request =>
      val regionIds: Seq[Int]    = parseIntegerSeq(regions)
      val routeIds: Seq[Int]     = parseIntegerSeq(routes)
      val aiValOpts: Seq[String] = aiValidationOptions.map(_.split(",").toSeq.distinct).getOrElse(Seq())
      // Logged off the parsed ids, not the raw Option: interpolating the latter writes "Regions=Some(5,7)" and
      // carries through junk the parser already rejected.
      val activityStr: String =
        if (regionIds.isEmpty) "Visit_LabelMap" else s"Visit_LabelMap_Regions=${regionIds.mkString(",")}"

      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
        tags       <- labelService.getTagsForCurrentCity
      } yield {
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, activityStr)
        Ok(
          views.html.apps.labelMap(
            commonData,
            Messages("seo.title.label.map", commonData.currentCity.cityNameShort),
            request.identity,
            tags,
            regionIds,
            routeIds,
            aiValOpts
          )
        )
      }
    }

  /**
   * The AccessScore tool (#5217): weight sliders, a streets/regions switch, and linked charts over the city's
   * AccessScores. The page fetches its data itself (`/v3/api/accessScoreConfig`, `/v3/api/accessScoreStreets`, the
   * region feeds), so the controller only renders the shell. Desktop-only, like the Route Builder: a map with
   * a control drawer on one side and a four-panel band below has no phone layout.
   */
  def accessScore = cc.securityService.UserAwareAction { implicit request =>
    if (ControllerUtils.isMobile) {
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.ipAddress,
        "Visit_AccessScore_RedirectMobileLanding"
      )
      Future.successful(Redirect("/mobileLanding"))
    } else {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_AccessScore")
        Ok(
          views.html.apps.accessScore(
            commonData,
            Messages("seo.title.access.score", commonData.currentCity.cityNameShort),
            request.identity
          )
        )
      }
    }
  }

  /**
   * Returns a page with instructions for users who want to receive community service hours.
   */
  def serviceHoursInstructions = cc.securityService.SecuredAction { implicit request =>
    val isMobile: Boolean = ControllerUtils.isMobile
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_ServiceHourInstructions")
      Ok(views.html.serviceHoursInstructions(commonData, request.identity, isMobile))
    }
  }

  /**
   * Returns a page that simply shows how long the sign in user has spent using Project Sidewalk.
   */
  def timeCheck = cc.securityService.SecuredAction(WithSignedIn()) {
    implicit request: SecuredRequest[DefaultEnv, AnyContent] =>
      val isMobile: Boolean = ControllerUtils.isMobile
      // Not cached, and started together: volunteers reload this page while logging service hours, so a stale total
      // would be worse than a slow one (#4526).
      val cityHoursF: Future[service.CrossCityHours] =
        userService.getCrossCityHours(request.identity.userId, request2Messages.lang)
      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
        cityHours  <- cityHoursF
      } yield {
        cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_TimeCheck")
        Ok(views.html.timeCheck(commonData, request.identity, isMobile, cityHours))
      }
  }

  def routeBuilder = cc.securityService.UserAwareAction { implicit request =>
    if (ControllerUtils.isMobile) {
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.ipAddress,
        "Visit_RouteBuilder_RedirectMobileLanding"
      )
      Future.successful(Redirect("/mobileLanding"))
    } else {
      for {
        commonData    <- configService.getCommonPageData(request2Messages.lang)
        labelingSpeed <- configService.getCityLabelingSpeed()
      } yield {
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_RouteBuilder")
        // Fallback pace for cities with no interaction data yet: ~4 min/100 m, the typical value across deployments
        // on /admin/across-cities as of 2026-07.
        Ok(views.html.apps.routeBuilder(commonData, request.identity, labelingSpeed.getOrElse(4.0)))
      }
    }
  }

  /**
   * Returns the cities dashboard page showing all Project Sidewalk deployment cities.
   */
  def cities = cc.securityService.UserAwareAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_Deployment_Cities_Dashboard")
      Ok(views.html.deploymentSitesDashboard(Messages("seo.title.cities"), commonData, request.identity))
    }
  }
}
