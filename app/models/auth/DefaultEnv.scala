package models.auth

import io.github.honeycombcheesecake.play.silhouette.api.Env
import models.user.SidewalkUserWithRole
import io.github.honeycombcheesecake.play.silhouette.impl.authenticators.CookieAuthenticator

trait DefaultEnv extends Env {
  type I = SidewalkUserWithRole
  type A = CookieAuthenticator
}
