package models.auth

import play.api.mvc.Request
import play.silhouette.api.{Authenticator, Authorization, Identity}

import scala.concurrent.{ExecutionContext, Future}

trait RoleBasedAuthorization[I <: Identity, A <: Authenticator] extends Authorization[I, A] {
  def checkAuthorization[B](identity: I, authenticator: A)(implicit request: Request[B]): Future[AuthorizationResult]

  override def isAuthorized[B](identity: I, authenticator: A)(implicit request: Request[B]): Future[Boolean] = {
    // The parent trait's signature provides no ExecutionContext, and this trivial synchronous mapping doesn't merit
    // a dispatch to a thread pool — parasitic runs it on the thread that completes checkAuthorization.
    checkAuthorization(identity, authenticator).map {
      case Authorized          => true
      case NotAuthorized(_, _) => false
    }(ExecutionContext.parasitic)
  }
}
