package controllers.helper

import models.label.LabelTypeEnum
import models.user.{RoleTable, SidewalkUserWithRole}
import play.api.mvc.Results.{Redirect, Unauthorized}
import play.api.mvc.{Request, RequestHeader, Result}

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import scala.util.Try
import scala.util.matching.Regex

object ControllerUtils {

  /**
   * Returns true if the user is on mobile, false if the user is not on mobile.
   */
  def isMobile[A](implicit request: Request[A]): Boolean = {
    val mobileOS: Regex =
      "(iPhone|webOS|iPod|Android|BlackBerry|mobile|SAMSUNG|IEMobile|OperaMobi|BB10|iPad|Tablet)".r.unanchored
    request.headers
      .get("User-Agent")
      .exists(agent => {
        agent match {
          case mobileOS(a) => true
          case _           => false
        }
      })
  }

  /**
   * Checks if the given user is an Administrator.
   */
  def isAdmin(user: SidewalkUserWithRole): Boolean = {
    RoleTable.ADMIN_ROLES.contains(user.role)
  }
  def isAdmin(user: Option[SidewalkUserWithRole]): Boolean = {
    user.map(isAdmin).getOrElse(false)
  }

  /**
   * Extracts a bearer token from the request's `Authorization` header, if present.
   *
   * @param request The incoming request.
   * @return The token following a case-insensitive `Bearer ` prefix (trimmed), or None if there is no such header.
   */
  def bearerToken(request: RequestHeader): Option[String] =
    request.headers.get("Authorization").collect {
      case header if header.regionMatches(true, 0, "Bearer ", 0, 7) => header.substring(7).trim
    }

  /**
   * Constant-time check that the request carries the configured internal API key as a bearer token.
   *
   * Authenticates trusted server-to-server callers (e.g. the AI label ingest) that have no Silhouette session. Fails
   * closed: returns false if the configured key is blank or the header is absent/mismatched. The comparison is
   * constant-time so a caller cannot recover the key byte-by-byte via response timing.
   *
   * @param request       The incoming request.
   * @param configuredKey The server's configured `internal-api-key` (pass "" when unset).
   * @return              True iff a bearer token is present and equals the configured key.
   */
  def internalKeyValid(request: RequestHeader, configuredKey: String): Boolean = {
    if (configuredKey.isEmpty) {
      false
    } else {
      val provided = bearerToken(request).getOrElse("")
      MessageDigest.isEqual(provided.getBytes(StandardCharsets.UTF_8), configuredKey.getBytes(StandardCharsets.UTF_8))
    }
  }

  def parseIntegerSeq(listOfInts: String): Seq[Int] = {
    listOfInts.split(",").flatMap(s => Try(s.toInt).toOption).toSeq.distinct
  }

  def parseIntegerSeq(listOfInts: Option[String]): Seq[Int] = {
    listOfInts.map(parseIntegerSeq).getOrElse(Seq())
  }

  // Provides a sorting function to sort by label_type_id if given the label_type string, with "Overall" going first.
  // This is used by our APIs to show output in a consistent order.
  val labelTypeOrdering: Ordering[(String, Any)] = Ordering.by { case (labelType, _) =>
    (labelType != "Overall", LabelTypeEnum.labelTypeToId.getOrElse(labelType, Int.MaxValue))
  }

  /**
   * Builds a URL string from a query string map.
   *
   * Created to help with forwarding to the correct URL after signing in/up.
   * @param queryString A query string map where the base URL is a parameter
   */
  def buildUrlFromQueryString(queryString: Map[String, Seq[String]]): String = {
    val basePath               = queryString.getOrElse("url", Seq("/")).head
    val qString                = queryString - "url"
    val queryStringStr: String = qString
      .map { case (key, values) =>
        values.map(value => s"${key}=${value}").mkString("&")
      }
      .mkString("&")
    if (qString.isEmpty) basePath else basePath + "?" + queryStringStr
  }

  /**
   * Parses a URL string into a path and a map of query parameters.
   *
   * Created to help with forwarding to the correct URL after signing in/up.
   */
  def parseURL(url: String): (String, Map[String, Seq[String]]) = {
    url.split("\\?", 2).toList match {
      case path :: queryString :: Nil =>
        val params = queryString
          .split('&')
          .map { param =>
            param.split('=').toList match {
              case key :: value :: Nil =>
                // Handle comma-separated values by splitting them into a sequence.
                key -> value.split(',').toSeq
              case key :: Nil =>
                key -> Seq.empty[String]
              case _ =>
                throw new IllegalArgumentException(s"Invalid query parameter format: $param")
            }
          }
          .toMap
        (path, params)
      case path :: Nil =>
        (path, Map.empty[String, Seq[String]])
      case _ =>
        throw new IllegalArgumentException(s"Invalid URL format: $url")
    }
  }

  /**
   * Restricts a post-auth redirect target to a same-origin path, guarding against open redirects.
   *
   * Only a single-slash-prefixed relative path is accepted (e.g. `/explore?foo=bar`). Absolute URLs, protocol-relative
   * `//host` URLs, and backslash variants that browsers normalize to `//` fall back to `default`, so a caller-supplied
   * `returnUrl` cannot bounce a freshly-authenticated user to an attacker-controlled site.
   *
   * @param url     The candidate redirect target (typically a `returnUrl` form field).
   * @param default Where to send the user when `url` is not a safe same-origin path.
   * @return        `url` (trimmed) if it is a same-origin relative path, otherwise `default`.
   */
  def safeLocalPath(url: String, default: String = "/"): String = {
    val trimmed = url.trim
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) trimmed else default
  }

  /**
   * Result for an unauthenticated request to a secured action: create an anonymous account and return here.
   *
   * A top-level navigation is 303-redirected to /anonSignUp (carrying the original path as `url`), which mints an
   * anonymous account and sends the browser back. That's wrong for a fetch/XHR call: a 303 turns it into a GET of the
   * original path, so a POST-only API route (e.g. `POST /task`) dead-ends at a 404, and the client re-fires and loops.
   * Such requests get a plain `401` instead, letting the client's fetch fail cleanly.
   *
   * We distinguish the two by the `Sec-Fetch-Mode` fetch-metadata header, which browsers send on trustworthy origins
   * (https and localhost): `navigate` for top-level navigations, `cors`/`same-origin`/`no-cors` for fetch/XHR/subresource
   * requests. Non-browser clients (curl, crawlers, the test suite) omit it, so they fall through to the redirect — the
   * conservative default that preserves the anonymous-signup-on-navigation flow.
   *
   * @param request The unauthenticated request header.
   * @return        `401 Unauthorized` for a non-navigation fetch/XHR request, otherwise a 303 redirect to /anonSignUp.
   */
  def anonSignupRedirect(request: RequestHeader): Result = {
    val isNavigation = request.headers.get("Sec-Fetch-Mode").forall(_ == "navigate")
    if (isNavigation) Redirect("/anonSignUp", request.queryString + ("url" -> Seq(request.path)))
    else Unauthorized("Not authenticated")
  }

  /**
   * Checks if a query string map contains any UTM parameters.
   */
  def hasUtmParams(qString: Map[String, Seq[String]]): Boolean = {
    qString.keys.exists(_.startsWith("utm_"))
  }

  /**
   * Checks if a flattened query string map contains any UTM parameters.
   */
  def hasUtmParamsFlat(qString: Map[String, String]): Boolean = {
    qString.keys.exists(_.startsWith("utm_"))
  }
}
