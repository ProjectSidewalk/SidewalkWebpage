package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.WithSignedIn
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json.Json
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
    val cityName = configService.getCityName(request2Messages.lang)
    for {
      profileData <- userService.getUserProfileData(user.userId, isMetric)
      commonData  <- configService.getCommonPageData(request2Messages.lang)
      tags        <- labelService.getTagsForCurrentCity
      standing    <- userService.getUserStanding(user.userId)
      streak      <- userService.getActivityStreak(user.userId)
      accuracy    <- userService.getAccuracyByType(user.userId)
      trophies    <- userService.getTrophies(user.userId, cityName)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_UserDashboardPreview")
      Ok(
        views.html.userDashboard
          .dashboard(commonData, user, profileData, isMetric, tags, standing, streak, accuracy, trophies)
      )
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
      aggregate  <- configService.getAggregateStats()
      overall    <- userService.getLeaderboardStats(10)
      weekly     <- userService.getLeaderboardStats(10, "weekly")
      teams      <- userService.getLeaderboardStats(10, "overall", byTeam = true)
      standing   <- if (isSignedIn) userService.getUserStanding(user.userId) else Future.successful(None)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_LeaderboardPreview")
      Ok(
        views.html.userDashboard
          .leaderboard(commonData, user, isSignedIn, isMetric, aggregate, overall, weekly, teams, standing)
      )
    }
  }

  /**
   * Renders the Settings page: editable username, read-only email + measurement units (units follow the site
   * language), team membership, and the two privacy toggles ("Show me on the leaderboard" and "Make my dashboard
   * public"). Secured to a signed-in user (settings are personal). The toggles reflect the user's real flags;
   * `privateByDefault` tells the view whether this deployment starts users private (school/minor cities) so it can
   * explain the default.
   */
  def settingsPreview = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    val user     = request.identity
    val isMetric = Messages("measurement.system") == "metric"
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      openTeams  <- userService.getAllOpenTeams
      currTeam   <- userService.getUserTeam(user.userId)
      privacy    <- userService.getPrivacySettings(user.userId)
    } yield {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_SettingsPreview")
      val (onLeaderboard, publicProfile) = privacy.getOrElse((true, true))
      Ok(
        views.html.userDashboard.settings(commonData, user, openTeams, currTeam, onLeaderboard, publicProfile, isMetric,
          configService.getPrivateProfilesByDefault)
      )
    }
  }

  /**
   * Persists the Settings form in one save: an optional username change (validated) plus the two privacy flags and
   * the user's team. `teamId` is a positive id to join/switch or absent/non-positive to leave any current team. A
   * username that fails validation (length, allowed characters, profanity, or already taken) aborts the whole save
   * with a 400 and a user-facing message, so nothing is partially applied.
   */
  def saveSettings = cc.securityService.SecuredAction(WithSignedIn(), parse.json) { implicit request =>
    val user          = request.identity
    val onLeaderboard = (request.body \ "onLeaderboard").asOpt[Boolean].getOrElse(true)
    val publicProfile = (request.body \ "publicProfile").asOpt[Boolean].getOrElse(true)
    val teamId        = (request.body \ "teamId").asOpt[Int].filter(_ > 0)
    val usernameEdit  = (request.body \ "username").asOpt[String].map(_.trim).filter(_.nonEmpty)

    // Only a username change can be rejected, so resolve it first and touch nothing else unless it succeeds.
    val usernameResult: Future[Either[String, Unit]] = usernameEdit match {
      case Some(name) if name != user.username => userService.changeUsername(user.userId, name).map(_.map(_ => ()))
      case _                                   => Future.successful(Right(()))
    }
    usernameResult.flatMap {
      case Left(error) => Future.successful(BadRequest(Json.obj("success" -> false, "error" -> error)))
      case Right(_)    =>
        for {
          _ <- userService.updatePrivacySettings(user.userId, onLeaderboard, publicProfile)
          _ <- teamId.map(id => userService.setUserTeam(user.userId, id)).getOrElse(userService.leaveTeam(user.userId))
        } yield {
          cc.loggingService.insert(user.userId, request.ipAddress, "Click_module=SaveSettings")
          Ok(Json.obj("success" -> true))
        }
    }
  }

  /**
   * Renders a public version of a mapper's dashboard (their accomplishments only — no email, mistakes, or settings).
   *
   * Bare `SecuredAction` so anyone, including anonymous accounts, can view it after clicking a name on the leaderboard.
   * Honors the target user's `public_profile` flag: if the profile is private and the viewer isn't its owner, the
   * view renders a "kept private" state instead of the stats. (Stats are still mock pending the public-profile data
   * phase; the flag gating is real.)
   *
   * @param username The mapper whose public profile to show.
   */
  def publicProfilePreview(username: String) = cc.securityService.SecuredAction { implicit request =>
    val viewer = request.identity
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      isPublic   <- userService.isProfilePublic(username)
    } yield {
      cc.loggingService.insert(viewer.userId, request.ipAddress, "Visit_PublicProfilePreview")
      val isOwner = viewer.username == username
      Ok(views.html.userDashboard.publicProfile(commonData, viewer, username, isPublic || isOwner))
    }
  }
}
