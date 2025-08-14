package models.auth

import models.user.SidewalkUserWithRole
import play.silhouette.api.Env
import play.silhouette.impl.authenticators.CookieAuthenticator

trait DefaultEnv extends Env {
  type I = SidewalkUserWithRole
  type A = CookieAuthenticator
}
