package models.auth

import play.api.mvc.Request
import play.silhouette.api.{Authenticator, Authorization, Identity}

import scala.concurrent.Future

trait RoleBasedAuthorization[I <: Identity, A <: Authenticator] extends Authorization[I, A] {
  def checkAuthorization[B](identity: I, authenticator: A)(implicit request: Request[B]): Future[AuthorizationResult]

  // Remove the ExecutionContext from the parameters since it's not in the parent trait
  override def isAuthorized[B](identity: I, authenticator: A)(implicit request: Request[B]): Future[Boolean] = {
    checkAuthorization(identity, authenticator).map {
      case Authorized          => true
      case NotAuthorized(_, _) => false
    }(scala.concurrent.ExecutionContext.global) // Use global EC for this transformation
  }
}
