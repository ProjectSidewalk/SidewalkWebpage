package models.auth

import models.user.{RoleTable, SidewalkUserWithRole}

import scala.concurrent.Future
import play.api.mvc.Request

case class WithAdmin() extends RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def checkAuthorization[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)
                                    (implicit request: Request[B]): Future[AuthorizationResult] = {
    Future.successful {
      if (RoleTable.ADMIN_ROLES.contains(identity.role)) Authorized
      else NotAuthorized(currRole=identity.role, requiredRole="Administrator")
    }
  }
}

case class WithSignedIn() extends RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def checkAuthorization[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)
                                    (implicit request: Request[B]): Future[AuthorizationResult] = {
    Future.successful {
      if (identity.role != "Anonymous") Authorized
      else NotAuthorized(currRole=identity.role, requiredRole="Registered")
    }
  }
}
