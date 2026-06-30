package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.WithSignedIn
import play.api.Configuration
import service.ConfigService

import javax.inject._
import scala.concurrent.ExecutionContext

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
    configService: ConfigService
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
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_UserDashboardPreview")
      Ok(views.html.userDashboard.dashboard(commonData, request.identity))
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
    val isSignedIn: Boolean = request.identity.role != "Anonymous"
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_LeaderboardPreview")
      Ok(views.html.userDashboard.leaderboard(commonData, request.identity, isSignedIn))
    }
  }
}
