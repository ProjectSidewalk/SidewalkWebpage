package models.auth

import models.user.Role

enum AuthorizationResult {
  case Authorized
  case NotAuthorized(currRole: Role, requiredRole: Role)
}
