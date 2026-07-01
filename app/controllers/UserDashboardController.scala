package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.WithSignedIn
import play.api.Configuration
import play.api.i18n.Messages
import service.{ConfigService, UserService}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for the redesigned User Dashboard + Leaderboard (issue #4323 and the User Dashboard redesign).
 *
 * These pages are a clean-slate rebuild of the legacy `/dashboard` (`UserProfileController.userProfile`) and
 * `/leaderboard` (`ApplicationController.leaderboard`), restructured around the API-docs/admin shell (left nav +
 * content + right "On this page" TOC). They are built incrementally behind a `/preview` route so production stays on
 * the current pages until the rebuild reaches parity; only then do `/dashboard` and `/leaderboard` flip over.
 *
 * Phase 1 is a comps-only prototype: the views render hardcoded mock data so the visual language and information
 * architecture can be reviewed before any data or backend work. Later phases wire in real data.
 */
@Singleton
class UserDashboardController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    implicit val assets: AssetsFinder,
    configService: ConfigService,
    userService: UserService,
    labelService: service.LabelService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Renders the redesigned User Dashboard prototype: a single page of "your impact" sections (hero stats, activity
   * streak, badges + trophies, your standing, learning/mistakes, map, team) on the shared shell.
   *
   * Phase 1 shows hardcoded mock data so the look and IA can be locked before data is wired in. Secured to any
   * signed-in user, matching the real `/dashboard`.
   */
  def dashboardPreview = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    val user     = request.identity
    val isMetric = Messages("measurement.system") == "metric"
    for {
      profileData <- userService.getUserProfileData(user.userId, isMetric)
      commonData  <- configService.getCommonPageData(request2Messages.lang)
      tags        <- labelService.getTagsForCurrentCity
      standing    <- userService.getUserStanding(user.userId)
      streak      <- userService.getActivityStreak(user.userId)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_UserDashboardPreview")
      Ok(views.html.userDashboard.dashboard(commonData, user, profileData, isMetric, tags, standing, streak))
    }
  }

  /**
   * Renders the redesigned Leaderboard prototype: community-impact band, podium, weekly/all-time/team tables, and a
   * "you vs community" standing widget, sharing the dashboard shell.
   *
   * Like the live `/leaderboard`, this is a bare `SecuredAction` (no `WithSignedIn`), so the general public — including
   * anonymous auto-accounts — can view it. The view shows the community/podium/tables to everyone and gates the
   * personal "you" pieces behind `isSignedIn` (role != "Anonymous"), offering a sign-up CTA otherwise. Phase 1 shows
   * hardcoded mock data.
   */
  def leaderboardPreview = cc.securityService.SecuredAction { implicit request =>
    val user                = request.identity
    val isSignedIn: Boolean = user.role != "Anonymous"
    val isMetric: Boolean   = Messages("measurement.system") == "metric"
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      overall    <- userService.getLeaderboardStats(10)
      weekly     <- userService.getLeaderboardStats(10, "weekly")
      teams      <- userService.getLeaderboardStats(10, "overall", byTeam = true)
      standing   <- if (isSignedIn) userService.getUserStanding(user.userId) else Future.successful(None)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_LeaderboardPreview")
      Ok(views.html.userDashboard.leaderboard(commonData, user, isSignedIn, isMetric, overall, weekly, teams, standing))
    }
  }

  /**
   * Renders the Settings page prototype: username, email, team membership, measurement units, and the two privacy
   * toggles ("Show me on the leaderboard" and "Make my dashboard public", both default on). Secured to a registered
   * user (settings are personal). Phase 1 is a static form with mock values.
   */
  def settingsPreview = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_SettingsPreview")
      Ok(views.html.userDashboard.settings(commonData, request.identity))
    }
  }

  /**
   * Renders a public version of a mapper's dashboard (their accomplishments only — no email, mistakes, or settings).
   *
   * Bare `SecuredAction` so anyone, including anonymous accounts, can view it after clicking a name on the leaderboard.
   * The real version will honor the target user's `public_profile` flag (private profiles render a "kept private"
   * state) and show only non-PII public stats. Phase 1 shows mock data for the given username.
   *
   * @param username The mapper whose public profile to show.
   */
  def publicProfilePreview(username: String) = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_PublicProfilePreview")
      Ok(views.html.userDashboard.publicProfile(commonData, request.identity, username))
    }
  }
}
