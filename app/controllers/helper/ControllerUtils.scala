package controllers.helper

import play.api.Play
import play.api.Play.current
import play.api.mvc.Request
import scala.util.matching.Regex

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

    def sha256Hash(text: String) : String = String.format("%064x", new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"))))
}
