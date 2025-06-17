package models.auth

import models.user.{RoleTable, SidewalkUserWithRole}
import play.api.mvc.Request

import scala.concurrent.Future

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

// Authorized if user is an admin or is requesting/modifying their own data.
case class WithAdminOrIsUser(userId: String) extends RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def checkAuthorization[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)
                                    (implicit request: Request[B]): Future[AuthorizationResult] = {
    Future.successful {
      if (RoleTable.ADMIN_ROLES.contains(identity.role) || identity.userId == userId) Authorized
      else NotAuthorized(currRole = identity.role, requiredRole = "Administrator")
    }
  }
}

  // Authorized if user is an admin or if they are registered and are requesting/modifying their own data.
case class WithAdminOrRegisteredAndIsUser(userId: String) extends RoleBasedAuthorization[SidewalkUserWithRole, DefaultEnv#A] {
  override def checkAuthorization[B](identity: SidewalkUserWithRole, authenticator: DefaultEnv#A)
                                    (implicit request: Request[B]): Future[AuthorizationResult] = {
    Future.successful {
      if (RoleTable.ADMIN_ROLES.contains(identity.role) || (identity.role != "Anonymous" && identity.userId == userId)) Authorized
      else NotAuthorized(currRole = identity.role, requiredRole = "Administrator")
    }
  }
}
