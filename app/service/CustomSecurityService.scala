package service

import models.auth._
import models.pano.PanoSource
import models.user.SidewalkUserWithRole
import play.api.mvc.Results.{Redirect, Status}
import play.api.mvc._
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
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
