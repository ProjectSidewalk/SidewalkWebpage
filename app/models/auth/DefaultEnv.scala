package models.auth

import com.mohiva.play.silhouette.api.Env
import models.user.SidewalkUserWithRole
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator

trait DefaultEnv extends Env {
  type I = SidewalkUserWithRole
  type A = CookieAuthenticator
}
