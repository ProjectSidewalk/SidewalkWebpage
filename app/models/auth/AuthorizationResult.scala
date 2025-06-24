package models.auth

sealed trait AuthorizationResult
case object Authorized                                           extends AuthorizationResult
case class NotAuthorized(currRole: String, requiredRole: String) extends AuthorizationResult
