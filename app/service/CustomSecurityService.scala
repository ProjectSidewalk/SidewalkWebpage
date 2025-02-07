package services

import javax.inject.Inject
import controllers.base._
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.SecuredRequest
import controllers.Assets.Status
import models.auth._
import models.user.SidewalkUserWithRole
import play.api.mvc.Results.Redirect
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

class CustomSecurityService @Inject()(
                                       silhouette: Silhouette[DefaultEnv],
                                       cc: CustomControllerComponents
                                     )(implicit ec: ExecutionContext) {

  // Basic authentication without checking for role.
  def SecuredAction(block: SecuredRequest[DefaultEnv, AnyContent] => Future[Result]): Action[AnyContent] = {
    silhouette.SecuredAction.async { request =>
      block(request)
    }
  }

  // Authentication with role-based authorization.
  def SecuredAction(authorization: RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A])
                   (block: SecuredRequest[DefaultEnv, AnyContent] => Future[Result]): Action[AnyContent] = {

    silhouette.SecuredAction.async { implicit request =>
      authorization.checkAuthorization(request.identity, request.authenticator).flatMap {
        case Authorized => block(request) // Execute the passed-in block with the request.
        case NotAuthorized(currRole, requiredRole) =>
          // Send user to sign in/up if they are anon. Use required role to show appropriate error message.
          Future.successful {
            (currRole, requiredRole) match {
              case ("Anonymous", "Registered") =>
                Redirect("/signIn", request.queryString + ("url" -> Seq(request.path)))
                  .flashing("error" -> "Please sign in to access this resource.")
              case ("Anonymous", _) =>
                Redirect("/signIn", request.queryString + ("url" -> Seq(request.path)))
                  .flashing("error" -> s"Please sign in as a $requiredRole to access this resource.")
              case (_, _) =>
                Status(403)(s"Request requires privileges: $requiredRole. You are currently signed in as: $currRole.")
            }
          }
      }
    }
  }
}