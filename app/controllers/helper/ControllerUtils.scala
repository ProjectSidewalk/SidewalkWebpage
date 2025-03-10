package controllers.helper

import play.api.mvc.Results.Redirect
import models.user.{RoleTable, SidewalkUserWithRole}
import play.api.mvc.{Request, RequestHeader, Result}

import scala.util.matching.Regex
import scala.util.Try

object ControllerUtils {
    /**
     * Returns true if the user is on mobile, false if the user is not on mobile.
     */
    def isMobile[A](implicit request: Request[A]): Boolean = {
        val mobileOS: Regex = "(iPhone|webOS|iPod|Android|BlackBerry|mobile|SAMSUNG|IEMobile|OperaMobi|BB10|iPad|Tablet)".r.unanchored
        request.headers.get("User-Agent").exists(agent => {
            agent match {
                case mobileOS(a) => true
                case _ => false
            }
        })
    }

    /**
     * Checks if the given user is an Administrator.
     */
    def isAdmin(user: Option[SidewalkUserWithRole]): Boolean = {
        user.map(u => RoleTable.ADMIN_ROLES.contains(u.role)).getOrElse(false)
    }

    def parseIntegerSeq(listOfInts: String): Seq[Int] = {
        listOfInts.split(",").flatMap(s => Try(s.toInt).toOption).toSeq.distinct
    }

    def parseIntegerSeq(listOfInts: Option[String]): Seq[Int] = {
        listOfInts.map(parseIntegerSeq).getOrElse(Seq())
    }

    /**
     * Builds a URL string from a query string map.
     *
     * Created to help with forwarding to the correct URL after signing in/up.
     * @param queryString A query string map where the base URL is a parameter
     * @return
     */
    def buildUrlFromQueryString(queryString: Map[String, Seq[String]]): String = {
        val basePath = queryString.getOrElse("url", Seq("/")).head
        val qString = queryString - "url"
        val queryStringStr: String = qString.map { case (key, values) =>
            values.map(value => s"${key}=${value}").mkString("&")
        }.mkString("&")
        if (qString.isEmpty) basePath else basePath + "?" + queryStringStr
    }

    /**
     * Parses a URL string into a path and a map of query parameters.
     *
     * Created to help with forwarding to the correct URL after signing in/up.
     * @param url
     * @return
     */
    def parseURL(url: String): (String, Map[String, Seq[String]]) = {
        url.split('?').toList match {
            case path :: queryString :: Nil =>
                val params = queryString.split('&').map { param =>
                    param.split('=').toList match {
                        case key :: value :: Nil =>
                            // Handle comma-separated values by splitting them into a sequence.
                            key -> value.split(',').toSeq
                        case key :: Nil =>
                            key -> Seq.empty[String]
                        case _ =>
                            throw new IllegalArgumentException(s"Invalid query parameter format: $param")
                    }
                }.toMap
                (path, params)
            case path :: Nil =>
                (path, Map.empty[String, Seq[String]])
            case _ =>
                throw new IllegalArgumentException(s"Invalid URL format: $url")
        }
    }

    /**
     * Sets up a redirect to /anonSignUp while keeping track of the current URL and query string.
     */
    def anonSignupRedirect(request: RequestHeader): Result = {
        Redirect("/anonSignUp", request.queryString + ("url" -> Seq(request.path)))
    }
}
