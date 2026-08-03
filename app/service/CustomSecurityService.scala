package service

import models.auth._
import models.pano.PanoSource
import models.user.SidewalkUserWithRole
import play.api.mvc.Results.{Redirect, Status}
import play.api.mvc._
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class CustomSecurityService @Inject() (
    silhouette: Silhouette[DefaultEnv],
    authenticationService: AuthenticationService,
    configService: ConfigService
)(implicit ec: ExecutionContext) {

  // Basic authentication without checking for role. Overriding each of the SecuredAction methods w/ different params.
  def SecuredAction(block: SecuredRequest[DefaultEnv, AnyContent] => Future[Result]): Action[AnyContent] = {
    silhouette.SecuredAction.async { request =>
      if (configService.getPanoSource == PanoSource.Infra3d && !request.identity.infra3dAccess) {
        Future.successful(infra3dAccessHelper(request.identity.role, request.path, request.queryString))
      } else {
        ensureUserStatExists(request).flatMap(_ => block(request))
      }
    }
  }

  def SecuredAction[B](bodyParser: BodyParser[B])(block: SecuredRequest[DefaultEnv, B] => Future[Result]): Action[B] = {
    silhouette.SecuredAction.async(bodyParser) { request =>
      if (configService.getPanoSource == PanoSource.Infra3d && !request.identity.infra3dAccess) {
        Future.successful(infra3dAccessHelper(request.identity.role, request.path, request.queryString))
      } else {
        ensureUserStatExists(request).flatMap(_ => block(request))
      }
    }
  }

  // Authentication with role-based authorization.
  def SecuredAction(
      authorization: RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A]
  )(block: SecuredRequest[DefaultEnv, AnyContent] => Future[Result]): Action[AnyContent] = {

    silhouette.SecuredAction.async { implicit request: SecuredRequest[DefaultEnv, AnyContent] =>
      authorization.checkAuthorization(request.identity, request.authenticator).flatMap {
        case Authorized =>
          if (configService.getPanoSource == PanoSource.Infra3d && !request.identity.infra3dAccess) {
            Future.successful(infra3dAccessHelper(request.identity.role, request.path, request.queryString))
          } else {
            ensureUserStatExists(request).flatMap(_ => block(request))
          }
        case NotAuthorized(currRole, requiredRole) =>
          Future.successful(unauthorizedErrorHelper(currRole, requiredRole, request.path, request.queryString))
      }
    }
  }
  def SecuredAction[B](
      authorization: RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A],
      bodyParser: BodyParser[B]
  )(block: SecuredRequest[DefaultEnv, B] => Future[Result]): Action[B] = {

    silhouette.SecuredAction.async(bodyParser) { implicit request: SecuredRequest[DefaultEnv, B] =>
      authorization.checkAuthorization(request.identity, request.authenticator).flatMap {
        case Authorized =>
          if (configService.getPanoSource == PanoSource.Infra3d && !request.identity.infra3dAccess) {
            Future.successful(infra3dAccessHelper(request.identity.role, request.path, request.queryString))
          } else {
            ensureUserStatExists(request).flatMap(_ => block(request))
          }
        case NotAuthorized(currRole, requiredRole) =>
          Future.successful(unauthorizedErrorHelper(currRole, requiredRole, request.path, request.queryString))
      }
    }
  }

  /**
   * A page that renders for everyone (#4643): `request.identity` is `Some` for signed-in visitors (including ones on
   * an anonymous account) and `None` for cookie-less requests — unlike `SecuredAction`, no anonymous account is
   * minted as a side effect of viewing the page. An existing identity gets the same treatment as `SecuredAction`
   * (the Infra3D gate and the lazy `user_stat` backfill); a cookie-less one skips the backfill (there is no user to
   * back-fill) but is still bounced to sign-in on Infra3D cities, which are sign-in-walled for every role today.
   */
  def UserAwareAction(block: UserAwareRequest[DefaultEnv, AnyContent] => Future[Result]): Action[AnyContent] = {
    silhouette.UserAwareAction.async { request => userAwareHelper(request)(block) }
  }

  def UserAwareAction[B](
      bodyParser: BodyParser[B]
  )(block: UserAwareRequest[DefaultEnv, B] => Future[Result]): Action[B] = {
    silhouette.UserAwareAction.async(bodyParser) { request => userAwareHelper(request)(block) }
  }

  private def userAwareHelper[B](
      request: UserAwareRequest[DefaultEnv, B]
  )(block: UserAwareRequest[DefaultEnv, B] => Future[Result]): Future[Result] = {
    request.identity match {
      case Some(identity) if configService.getPanoSource == PanoSource.Infra3d && !identity.infra3dAccess =>
        Future.successful(infra3dAccessHelper(identity.role, request.path, request.queryString))
      case Some(identity) =>
        authenticationService.addUserStatEntryIfNew(identity.userId).flatMap(_ => block(request))
      case None if configService.getPanoSource == PanoSource.Infra3d =>
        Future.successful(infra3dAccessHelper("Anonymous", request.path, request.queryString))
      case None =>
        block(request)
    }
  }

  // Send user to sign in/up if they are anon. Use required role to show appropriate error message.
  private def unauthorizedErrorHelper(
      currRole: String,
      requiredRole: String,
      path: String,
      queryString: Map[String, Seq[String]]
  ): Result = {
    (currRole, requiredRole) match {
      case ("Anonymous", "Registered") =>
        Redirect("/signIn", queryString + ("url" -> Seq(path)))
          .flashing("error" -> "Please sign in to access this resource.")
      case ("Anonymous", _) =>
        Redirect("/signIn", queryString + ("url" -> Seq(path)))
          .flashing("error" -> s"Please sign in as a $requiredRole to access this resource.")
      case (_, _) =>
        Status(403)(s"Request requires privileges: $requiredRole. You are currently signed in as: $currRole.")
    }
  }

  // Send user to sign in/up if they are anon, o/w show a message saying that they need to be granted infra3D access.
  private def infra3dAccessHelper(currRole: String, path: String, queryString: Map[String, Seq[String]]): Result = {
    if (currRole == "Anonymous") {
      Redirect("/signIn", queryString + ("url" -> Seq(path)))
        .flashing("error" -> "Please sign in to access this resource.")
    } else {
      Status(403)(s"This page requires infra3D imagery permission. Please email the ZuReach team (zureach_info@dsi.uzh.ch) if you require access.")
    }
  }

  /**
   * Ensures that a user_stat entry exists in the current city's schema before proceeding with the secured action.
   *
   * @param request The secured request containing user identity.
   * @return Future completing when user stat is ensured.
   */
  private def ensureUserStatExists(request: SecuredRequest[DefaultEnv, _]): Future[Unit] = {
    authenticationService.addUserStatEntryIfNew(request.identity.userId).map(_ => ())
  }
}
