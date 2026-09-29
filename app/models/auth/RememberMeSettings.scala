package models.auth

import scala.concurrent.duration.FiniteDuration

/**
 * What ticking "remember me" changes about a sign-in, read once at startup by `SilhouetteModule`.
 *
 * @param cookieMaxAge How long the browser keeps the cookie, instead of dropping it when the browser closes.
 */
case class RememberMeSettings(cookieMaxAge: FiniteDuration)
