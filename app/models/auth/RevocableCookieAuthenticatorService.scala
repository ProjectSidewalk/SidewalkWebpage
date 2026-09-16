package models.auth

import play.api.mvc.{RequestHeader, Result}
import play.silhouette.api.crypto.{AuthenticatorEncoder, Signer}
import play.silhouette.api.services.{AuthenticatorResult, AuthenticatorService}
import play.silhouette.api.util.{Clock, ExtractableRequest, FingerprintGenerator, IDGenerator}
import play.silhouette.impl.authenticators.{
  CookieAuthenticator,
  CookieAuthenticatorService,
  CookieAuthenticatorSettings
}
import play.api.mvc.CookieHeaderEncoding
import service.AuthenticationService

import scala.concurrent.{ExecutionContext, Future}

/**
 * Silhouette's cookie service, plus a check that turns away a cookie issued before the account's sessions were
 * revoked (#5305). The whole session lives in the cookie, so without this a password change would leave every other
 * signed-in browser signed in until its cookie expired.
 *
 * A cookie doesn't record when it was issued, so that's worked out as its expiry minus `authenticatorExpiry`. That's
 * only right while every cookie gets the same lifetime, which `conf/silhouette.conf` notes.
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

  /** Marks a revoked cookie expired rather than dropping it, so Silhouette also deletes it from the browser. */
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

  private def issuedAt(authenticator: CookieAuthenticator) =
    authenticator.expirationDateTime.minusSeconds(settings.authenticatorExpiry.toSeconds)
}

object RevocableCookieAuthenticatorService {

  /** Signs this browser back in after a revocation, keeping its "remember me" choice. */
  def reissue(service: AuthenticatorService[CookieAuthenticator], current: CookieAuthenticator, result: Result)(implicit
      request: RequestHeader,
      ec: ExecutionContext
  ): Future[AuthenticatorResult] = {
    for {
      fresh  <- service.create(current.loginInfo)
      cookie <- service.init(fresh.copy(idleTimeout = current.idleTimeout, cookieMaxAge = current.cookieMaxAge))
      result <- service.embed(cookie, result)
    } yield result
  }
}
