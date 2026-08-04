package controllers.helper

import play.api.Configuration
import play.api.mvc.Results.Forbidden
import play.api.mvc.{RequestHeader, Result}
import service.ImageSigningService

import scala.util.Try

/**
 * Shared request guards for controllers that serve media bytes from disk (crops, pano backups, story media):
 * an allowed-host Referer/Origin gate and HMAC-signed time-limited URL verification (see ImageSigningService).
 */
object SignedMediaUtils {

  /**
   * Returns true if the request's Referer or Origin header (when present) points to an allowed host.
   *
   * Missing headers are treated as allowed — they are legitimately absent in some privacy modes
   * and on direct requests. Only explicit cross-origin indicators from a disallowed host are rejected.
   * @param request The incoming request to check.
   * @param config  Application configuration; supplies `play.filters.hosts.allowed`.
   */
  def refererAllowed(request: RequestHeader, config: Configuration): Boolean = {
    val allowedHosts                       = config.get[Seq[String]]("play.filters.hosts.allowed")
    def hostAllowed(host: String): Boolean = allowedHosts.exists { pattern =>
      val patternHost = pattern.split(":")(0) // strip port, e.g. "localhost:9000" → "localhost"
      if (patternHost.startsWith(".")) host.endsWith(patternHost) || host == patternHost.drop(1)
      else host == patternHost
    }
    def extractHost(header: String): Option[String] =
      Try(new java.net.URL(header).getHost).toOption

    val originOk  = request.headers.get("Origin").flatMap(extractHost).forall(hostAllowed)
    val refererOk = request.headers.get("Referer").flatMap(extractHost).forall(hostAllowed)
    originOk && refererOk
  }

  /**
   * Validates the ?exp and ?sig query parameters against the expected HMAC for this request path.
   *
   * @param request        The incoming request.
   * @param path           The canonical path to verify (e.g. "/backupImage/myPanoId").
   * @param signingService Verifies the HMAC.
   * @return               `None` when the signature checks out; a Forbidden result when missing, invalid, or expired.
   */
  def verifySignature(request: RequestHeader, path: String, signingService: ImageSigningService): Option[Result] = {
    val exp = request.getQueryString("exp").flatMap(s => Try(s.toLong).toOption)
    val sig = request.getQueryString("sig")
    (exp, sig) match {
      case (Some(e), Some(s)) if signingService.verify(path, e, s) => None
      case _                                                       => Some(Forbidden("Invalid or expired image URL."))
    }
  }
}
