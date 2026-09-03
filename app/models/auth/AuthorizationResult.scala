package models.auth

import models.user.Role

sealed trait AuthorizationResult
case object Authorized                                                   extends AuthorizationResult
case class NotAuthorized(currRole: Role.Value, requiredRole: Role.Value) extends AuthorizationResult
