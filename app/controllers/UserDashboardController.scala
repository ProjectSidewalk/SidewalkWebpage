package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import controllers.helper.ControllerUtils
import controllers.helper.ControllerUtils.MeasurementSystem
import formats.json.UserFormats.{settingsSubmissionReads, SettingsSubmission}
import models.auth.{DefaultEnv, WithAdmin, WithSignedIn}
import models.user.SidewalkUserWithRole
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.mvc.{AnyContent, Result}
import play.silhouette.api.actions.SecuredRequest
import service.{AdminService, ConfigService, GlobalLeaderboardEntry, UserService}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for the User Dashboard, Leaderboard, Settings, and public profiles (#4323 redesign, cut over in #4474),
 * plus the admin's view of another user's dashboard (#4964).
 *
 * The pages share the API-docs/admin shell (left nav + content + right "On this page" TOC). The pre-cutover
 * `/preview` URLs permanently redirect to the production ones. Unlike the pre-redesign dashboard, mobile visitors are
 * served the page itself (it is responsive) rather than being redirected to /mobileLanding.
 */
@Singleton
class UserDashboardController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    implicit val assets: AssetsFinder,
    configService: ConfigService,
    userService: UserService,
    adminService: AdminService,
    labelService: service.LabelService,
    routeService: service.RouteService,
    authenticationService: service.AuthenticationService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  // The dashboard's needs-re-audit list reveals five rows at a time; it fetches three pages' worth up front so
  // "show more" is a reveal rather than a round trip, and defers the rest to the map, which draws all of them (#4896).
  private val ReauditPageSize: Int = 5
  private val ReauditListSize: Int = ReauditPageSize * 3

  /**
   * Renders the redesigned User Dashboard: a single page of "your impact" sections (hero stats, activity streak,
   * badges + trophies, your standing, learning/mistakes, map, team, streets needing a re-audit) on the shared shell.
   *
   * Secured to any signed-in user.
   */
  def dashboard = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_UserDashboard")
    renderDashboard(request.identity, adminView = false)
  }

  /**
   * The admin's view of another user's dashboard (`/admin/user/:username`): the same page the user sees, with the
   * admin-mode affordances the view gates on `adminView` (admin label popup, read-only mistake/route controls, the
   * user's stories editable for moderation) and a "Manage user" page beside it in the sidebar (`adminUser`).
   *
   * @param username The user whose dashboard to show; 404 if no such account.
   */
  def adminDashboard(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    withUser(username) { subject =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, s"Visit_AdminUserDashboard_User=$username")
      renderDashboard(subject, adminView = true)
    }
  }

  /**
   * The admin-only page beside a user's dashboard (`/admin/user/:username/admin`): account settings an admin may
   * change (username, role, team, manual quality, service hours, privacy, infra3D access), the stats the dashboard
   * doesn't show (curr region, hours worked, labeling frequency), marking their work by date, & their Explore comments.
   *
   * @param username The user to administer; 404 if no such account.
   */
  def adminUser(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    withUser(username) { subject =>
      // The same cross-city total the user reads on /timeCheck, and fetched the same way: uncached, and started here
      // so the fan-out overlaps the lookups below rather than following them. An admin opens this page to check a
      // figure the user just reported, so the two have to agree at that moment (#4986).
      val cityHoursF: Future[service.CrossCityHours] =
        userService.getCrossCityHours(subject.userId, request2Messages.lang)
      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
        adminData  <- adminService.getAdminUserProfileData(subject.userId)
        team       <- userService.getUserTeam(subject.userId)
        teams      <- userService.getAllTeams
        cityHours  <- cityHoursF
      } yield {
        cc.loggingService.insert(request.identity.userId, request.ipAddress, s"Visit_AdminUser_User=$username")
        Ok(
          views.html.userDashboard
            .adminUser(commonData, request.identity, subject, adminData, cityHours, team, teams)
        )
      }
    }
  }

  /** Resolves a username for the admin pages, rendering the branded 404 when it matches no account. */
  private def withUser(username: String)(
      render: SidewalkUserWithRole => Future[Result]
  )(implicit request: SecuredRequest[DefaultEnv, AnyContent]): Future[Result] = {
    authenticationService.findByUsername(username).flatMap {
      case Some(subject) => render(subject)
      case None          =>
        Future.successful(
          NotFound(
            views.html.errors.errorPage(
              NOT_FOUND,
              Messages("error.404.heading"),
              Messages("error.404.message"),
              requestedPath = Some(request.path)
            )
          )
        )
    }
  }

  /**
   * Assembles and renders the dashboard for `user`, viewed by `request.identity` (the same person unless `adminView`).
   */
  private def renderDashboard(user: SidewalkUserWithRole, adminView: Boolean)(implicit
      request: SecuredRequest[DefaultEnv, AnyContent]
  ): Future[Result] = {
    val isMetric = ControllerUtils.isMetric
    val cityName = configService.getCityName(request2Messages.lang)
    // Kicked off before the for-comprehension so they run concurrently with the chain below.
    val myRoutesF       = routeService.getRoutesForUser(user.userId)
    val reauditStreetsF = userService.getOutdatedStreetsForUser(user.userId, ReauditListSize)
    for {
      profileData                    <- userService.getUserProfileData(user.userId, isMetric)
      commonData                     <- configService.getCommonPageData(request2Messages.lang)
      tags                           <- labelService.getTagsForCurrentCity
      standing                       <- userService.getUserStanding(user.userId)
      streak                         <- userService.getActivityStreak(user.userId, request2Messages.lang.toLocale)
      accuracy                       <- userService.getAccuracyByType(user.userId)
      trophies                       <- userService.getTrophies(user.userId, cityName, request2Messages)
      myRoutes                       <- myRoutesF
      (reauditStreets, reauditTotal) <- reauditStreetsF
    } yield {
      Ok(
        views.html.userDashboard
          .dashboard(commonData, request.identity, user, adminView, profileData, isMetric, tags, standing, streak,
            accuracy, trophies, myRoutes, reauditStreets, reauditTotal, ReauditPageSize)
      )
    }
  }

  /**
   * Renders the redesigned Leaderboard prototype: this city's impact band, podium, weekly/all-time/team tables, a
   * "you vs community" standing widget, and the cross-city boards, sharing the dashboard shell.
   *
   * A `UserAwareAction` (#4643), so the general public — including cookie-less visitors and anonymous auto-accounts —
   * can view it without an account being minted. The view shows the community/podium/tables to everyone and gates the
   * personal "you" pieces behind `isSignedIn` (an identity with role != "Anonymous"), offering a sign-up CTA otherwise.
   */
  def leaderboard = cc.securityService.UserAwareAction { implicit request =>
    val user                                       = request.identity
    val signedInUser: Option[SidewalkUserWithRole] = user.filter(_.role != "Anonymous")
    val isSignedIn: Boolean                        = signedInUser.isDefined
    val isMetric: Boolean                          = ControllerUtils.isMetric
    val cityName                                   = configService.getCityName(request2Messages.lang)
    // Kicked off before the for-comprehension so the cross-city union overlaps the per-city queries on a cache miss.
    val globalF: Future[Option[Seq[GlobalLeaderboardEntry]]] = userService.getGlobalLeaderboardStats(10)
    for {
      commonData          <- configService.getCommonPageData(request2Messages.lang)
      (aggregate, impact) <- configService.getAggregateStatsWithCurrentCity()
      overall             <- userService.getLeaderboardStats(10)
      weekly              <- userService.getLeaderboardStats(10, "weekly")
      teams               <- userService.getLeaderboardStats(10, "overall", byTeam = true)
      standing            <- signedInUser
        .map(u => userService.getUserStanding(u.userId))
        .getOrElse(Future.successful(None))
      global <- globalF
    } yield {
      cc.loggingService.insert(user.map(_.userId), request.ipAddress, "Visit_Leaderboard")
      Ok(
        views.html.userDashboard.leaderboard(commonData, user, isSignedIn, isMetric, cityName, aggregate, impact,
          overall, weekly, teams, standing, global)
      )
    }
  }

  /**
   * Renders the user's Settings page: editable username, read-only email, a measurement-units choice, team membership,
   * and the two privacy toggles ("Show me on the leaderboard" and "Make my dashboard public"). The toggles reflect the
   * user's real flags; `privateByDefault` tells the view whether this deployment starts users private (school/minor
   * cities) so it can explain the default.
   */
  def settings = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    val user        = request.identity
    val unitsChoice = request.cookies
      .get(MeasurementSystem.CookieName)
      .map(_.value)
      .filter(MeasurementSystem.validOverrides.contains)
      .getOrElse(MeasurementSystem.FollowLanguage)
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      openTeams  <- userService.getAllOpenTeams
      currTeam   <- userService.getUserTeam(user.userId)
      privacy    <- userService.getPrivacySettings(user.userId)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_Settings")
      val (onLeaderboard, publicProfile) = privacy.getOrElse((true, true))
      Ok(
        views.html.userDashboard.settings(commonData, user, openTeams, currTeam, onLeaderboard, publicProfile,
          unitsChoice, configService.getPrivateProfilesByDefault)
      )
    }
  }

  /**
   * Persists the Settings form in one save: an optional username change (validated) plus the two privacy flags, the
   * measurement-units choice, and the user's team. The body is a `SettingsSubmission` (a missing privacy flag is a
   * 400, never a reset); `teamId` is a positive id to join/switch or null/non-positive to leave any current team. A
   * username that fails validation (length, allowed characters, profanity, or already taken) refuses the whole save
   * with a 400 and a user-facing message before anything is written; the rename itself is the last write.
   *
   * Units are the one setting that isn't a database write: like the language choice it lives in a cookie, so a
   * submitted change either sets the override or discards it to fall back to the site language (#4404).
   */
  def saveSettings = cc.securityService.SecuredAction(WithSignedIn(), parse.json) { implicit request =>
    val user                    = request.identity
    def reject(message: String) = Future.successful(BadRequest(Json.obj("success" -> false, "error" -> message)))

    request.body.validate[SettingsSubmission] match {
      case JsError(errors) => reject(s"Invalid settings: ${JsError.toJson(errors).keys.mkString(", ")}")
      case JsSuccess(s, _) =>
        val teamId       = s.teamId.filter(_ > 0)
        val usernameEdit = s.username.filter(_ != user.username)
        val unitsWere    = request.cookies
          .get(MeasurementSystem.CookieName)
          .map(_.value)
          .filter(MeasurementSystem.validOverrides.contains)
          .getOrElse(MeasurementSystem.FollowLanguage)
        // Absent field means "this caller isn't touching units", which has to stay distinct from an explicit "auto" —
        // otherwise any save that omits it silently wipes the reader's stored choice.
        val unitsSubmitted = s.measurementSystem
          .filter(system => MeasurementSystem.validOverrides(system) || system == MeasurementSystem.FollowLanguage)
        val unitsNow = unitsSubmitted.getOrElse(unitsWere)

        // Only the username can be refused, so it's checked before the first write and renamed after the last one.
        val usernameCheck: Future[Either[String, Unit]] = usernameEdit
          .map(name => userService.validateUsername(user.userId, name).map(_.map(_ => ())))
          .getOrElse(Future.successful(Right(())))
        usernameCheck.flatMap {
          // The service returns an i18n key; localize it for the viewer here at the HTTP boundary.
          case Left(errorKey) => reject(Messages(errorKey))
          case Right(_)       =>
            for {
              _ <- userService.updatePrivacySettings(user.userId, s.onLeaderboard, s.publicProfile)
              _ <- teamId
                .map(id => userService.setUserTeam(user.userId, id))
                .getOrElse(userService.leaveTeam(user.userId))
              _ <- s.communityService
                .map(cs => authenticationService.setCommunityServiceStatus(user.userId, cs))
                .getOrElse(Future.successful(0))
              _ <- usernameEdit
                .map(name => userService.changeUsername(user.userId, name))
                .getOrElse(Future.successful(Right(user.username)))
            } yield {
              cc.loggingService.insert(user.userId, request.ipAddress, "Click_module=SaveSettings")
              // Logged separately from the save, and only on a real change, so units can be analyzed the way the
              // navbar's ChangeLanguage already is rather than being buried in every settings save.
              if (unitsNow != unitsWere) {
                cc.loggingService
                  .insert(user.userId, request.ipAddress, s"Click_module=ChangeUnits_from=${unitsWere}_to=$unitsNow")
              }
              val result = Ok(Json.obj("success" -> true))
              if (unitsNow == unitsWere) result
              else if (MeasurementSystem.validOverrides(unitsNow))
                result.withCookies(MeasurementSystem.overrideCookie(unitsNow))
              else result.discardingCookies(MeasurementSystem.clearOverrideCookie)
            }
        }
    }
  }

  /**
   * Renders a public version of a mapper's dashboard (their accomplishments only — no email, mistakes, or settings).
   *
   * Bare `SecuredAction` so anyone, including anonymous accounts, can view it after clicking a name on the leaderboard.
   * The service resolves the three states: a missing username (`None` → not-found), a private profile the viewer
   * doesn't own (`visible = false` → "kept private"), or a visible profile with real KPIs, badges, trophies, and a
   * contribution map (fed by the public `/userapi/public/:username/...` endpoints, gated on the same flag).
   *
   * @param username The mapper whose public profile to show.
   */
  def publicProfile(username: String) = cc.securityService.SecuredAction { implicit request =>
    val viewer   = request.identity
    val isOwner  = viewer.username == username
    val isMetric = ControllerUtils.isMetric
    val cityName = configService.getCityName(request2Messages.lang)
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      profile    <- userService.getPublicProfile(username, isOwner, isMetric, cityName, request2Messages)
      tags       <- labelService.getTagsForCurrentCity
    } yield {
      cc.loggingService.insert(viewer.userId, request.ipAddress, "Visit_PublicProfile")
      Ok(views.html.userDashboard.publicProfile(commonData, viewer, username, isMetric, profile, tags))
    }
  }

  /** Permanent redirect from a pre-cutover `/preview` URL to its production URL (#4474). */
  def dashboardPreviewRedirect = Action {
    MovedPermanently(routes.UserDashboardController.dashboard.url)
  }

  /** Permanent redirect from a pre-cutover `/preview` URL to its production URL (#4474). */
  def settingsPreviewRedirect = Action {
    MovedPermanently(routes.UserDashboardController.settings.url)
  }

  /** Permanent redirect from a pre-cutover `/preview` URL to its production URL (#4474). */
  def leaderboardPreviewRedirect = Action {
    MovedPermanently(routes.UserDashboardController.leaderboard.url)
  }

  /** Permanent redirect from a pre-cutover `/preview` URL to its production URL (#4474). */
  def publicProfilePreviewRedirect(username: String) = Action {
    MovedPermanently(routes.UserDashboardController.publicProfile(username).url)
  }
}
