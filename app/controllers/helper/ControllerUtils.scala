package controllers.helper

import play.api.{Logger, Play}
import play.api.Play.current
import play.api.mvc.Request
import scala.concurrent.{ExecutionContext, Future}
import scala.util.matching.Regex
import org.apache.http.NameValuePair
import org.apache.http.client.entity.UrlEncodedFormEntity
import org.apache.http.client.methods.HttpPost
import org.apache.http.impl.client.DefaultHttpClient
import org.apache.http.message.BasicNameValuePair
import java.io.InputStream
import java.util

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

    def sha256Hash(text: String) : String = String.format("%064x", new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"))))

    /**
     * Send a POST request to SciStarter to record the user's contributions.
     *
     * @param email The email address of the user who contributed. Will be hashed in POST request.
     * @param contributions Number of contributions. Either number of labels created or number of labels validated.
     * @param timeSpent Total time spent on those contributions.
     * @return Response code from the API request.
     */
    def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Float): Future[Int] = Future {
        // Get the SciStarter API key, throw an error if not found.
        val apiKey: Option[String] = Play.configuration.getString("scistarter-api-key")
        if (apiKey.isEmpty) {
            Logger.error("SciStarter API key not found.")
            throw new Exception("SciStarter API key not found.")
        }

        // Set up the URL and POST request data with hashed email and amount of contribution.
        val hashedEmail: String = sha256Hash(email)
        val url: String = s"https://scistarter.org/api/participation/hashed/project-sidewalk?key=${apiKey.get}"
        val post: HttpPost = new HttpPost(url)
        val client: DefaultHttpClient = new DefaultHttpClient
        val nameValuePairs = new util.ArrayList[NameValuePair](1)
        nameValuePairs.add(new BasicNameValuePair("hashed", hashedEmail));
        nameValuePairs.add(new BasicNameValuePair("type", "classification"));
        nameValuePairs.add(new BasicNameValuePair("count", contributions.toString));
        nameValuePairs.add(new BasicNameValuePair("duration", (timeSpent / contributions).toString));
        post.setEntity(new UrlEncodedFormEntity(nameValuePairs));

        // Make API call, logging any errors.
        try {
            val response = client.execute(post)
            response.getStatusLine.getStatusCode
        } catch {
            case e: Exception =>
                Logger.warn(e.getMessage)
                throw e
        }
    }
}
