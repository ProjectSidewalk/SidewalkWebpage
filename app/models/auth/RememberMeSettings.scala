package models.auth

import play.api.Configuration

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.FiniteDuration

/**
 * What ticking "remember me" changes about a sign-in. `SilhouetteModule` builds it at boot, so a missing key stops the
 * app there instead of on the first request.
 *
 * @param configuration The Play configuration.
 */
@Singleton
class RememberMeSettings @Inject() (configuration: Configuration) {

  /** How long the browser keeps the cookie, instead of dropping it when the browser closes. */
  val cookieMaxAge: FiniteDuration =
    configuration.get[FiniteDuration]("silhouette.authenticator.rememberMe.cookieMaxAge")
}
