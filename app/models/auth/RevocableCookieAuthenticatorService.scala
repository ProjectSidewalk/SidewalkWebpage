package models.auth

import play.api.mvc.{Cookie, CookieHeaderEncoding, RequestHeader}
import play.silhouette.api.crypto.{AuthenticatorEncoder, Signer}
import play.silhouette.api.util.{Clock, ExtractableRequest, FingerprintGenerator, IDGenerator}
import play.silhouette.impl.authenticators.{
  CookieAuthenticator,
  CookieAuthenticatorService,
  CookieAuthenticatorSettings
}
import service.AuthenticationService

import java.time.ZonedDateTime
import scala.concurrent.{ExecutionContext, Future}

/**
 * Silhouette's cookie service, plus a check that turns away a cookie issued before the account's sessions were
 * revoked (#5305). The whole session lives in the cookie, so without this a password change would leave every other
 * signed-in browser signed in until its cookie expired.
 *
 * A cookie doesn't record when it was issued, so that's worked out as its expiry minus `authenticatorExpiry`, which
 * `SilhouetteModule` makes sure every cookie shares.
 */
class RevocableCookieAuthenticatorService(
    settings: CookieAuthenticatorSettings,
    signer: Signer,
    cookieHeaderEncoding: CookieHeaderEncoding,
    authenticatorEncoder: AuthenticatorEncoder,
    fingerprintGenerator: FingerprintGenerator,
    idGenerator: IDGenerator,
    clock: Clock,
    authenticationService: AuthenticationService
)(implicit ec: ExecutionContext)
    extends CookieAuthenticatorService(settings, None, signer, cookieHeaderEncoding, authenticatorEncoder,
      fingerprintGenerator, idGenerator, clock) {

  /**
   * Marks a revoked cookie expired rather than dropping it, so Silhouette also deletes it from the browser.
   *
   * @return The request's authenticator, or None if it has no readable cookie.
   */
  override def retrieve[B](implicit request: ExtractableRequest[B]): Future[Option[CookieAuthenticator]] = {
    super.retrieve.flatMap {
      case Some(authenticator) if authenticator.isValid =>
        authenticationService.sessionsRevokedAt(authenticator.loginInfo.providerKey).map {
          case Some(revokedAt) if issuedAt(authenticator).toInstant.isBefore(revokedAt.toInstant) =>
            Some(authenticator.copy(expirationDateTime = clock.now.minusSeconds(1)))
          case _ => Some(authenticator)
        }
      case other => Future.successful(other)
    }
  }

  /**
   * Skips the per-response cookie rewrite when the idle timeout can't end the session first, so a request already on
   * its way during a password change can't write the revoked cookie back over the one `renew` just set.
   *
   * @return The authenticator on the right when nothing needs rewriting, as Silhouette expects.
   */
  override def touch(authenticator: CookieAuthenticator): Either[CookieAuthenticator, CookieAuthenticator] = {
    // The minute absorbs sign-in setting a "remember me" expiry a few milliseconds after the last-used time.
    val idleCantExpireFirst = authenticator.idleTimeout.forall { timeout =>
      !authenticator.lastUsedDateTime.plusSeconds(timeout.toSeconds + 60).isBefore(authenticator.expirationDateTime)
    }
    if (idleCantExpireFirst) Right(authenticator) else super.touch(authenticator)
  }

  /**
   * Gives the browser a new cookie after a revocation, keeping its "remember me" choice, which Silhouette's drops.
   *
   * @return The new cookie.
   */
  override def renew(authenticator: CookieAuthenticator)(implicit request: RequestHeader): Future[Cookie] = {
    create(authenticator.loginInfo)
      .map(_.copy(idleTimeout = authenticator.idleTimeout, cookieMaxAge = authenticator.cookieMaxAge))
      .flatMap(init)
  }

  /** @return When the cookie was issued, worked out from its expiry since the cookie doesn't store it. */
  private def issuedAt(authenticator: CookieAuthenticator): ZonedDateTime =
    authenticator.expirationDateTime.minusSeconds(settings.authenticatorExpiry.toSeconds)
}
