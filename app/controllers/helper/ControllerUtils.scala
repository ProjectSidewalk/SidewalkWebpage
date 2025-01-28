package controllers.helper

import controllers.Assets.Redirect
import models.user.SidewalkUserWithRole
import play.api.mvc.{AnyContent, Request, Result}

import scala.concurrent.ExecutionContext
import scala.util.matching.Regex
import scala.util.Try

object ControllerUtils {
    implicit val context: ExecutionContext = play.api.libs.concurrent.Execution.Implicits.defaultContext

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
        user.map(u => List("Administrator", "Owner").contains(u.role)).getOrElse(false)
    }

    def parseIntegerSeq(listOfInts: String): Seq[Int] = {
        listOfInts.split(",").flatMap(s => Try(s.toInt).toOption).toSeq.distinct
    }

    def parseIntegerSeq(listOfInts: Option[String]): Seq[Int] = {
        listOfInts.map(parseIntegerSeq).getOrElse(Seq())
    }

    /**
     * Sets up a redirect to /anonSignUp while keeping track of the current URL and query string.
     */
    def anonSignupRedirect(request: Request[AnyContent]): Result = {
        Redirect("/anonSignUp", request.queryString + ("url" -> Seq(request.path)))
    }
}
