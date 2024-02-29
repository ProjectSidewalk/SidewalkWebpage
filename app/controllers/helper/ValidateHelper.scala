package controllers.helper

import models.user.User
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
import scala.util.Try

object ValidateHelper {
  case class AdminValidateParams(adminVersion: Boolean, labelTypeId: Option[Int] = None) {
    require(labelTypeId.isEmpty || adminVersion, "labelTypeId can only be set if adminVersion is true")
  }
}