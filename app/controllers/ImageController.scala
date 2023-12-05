package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import play.api.mvc.BodyParsers
import java.util.UUID
import scala.concurrent.Future
import play.api.libs.json._
import play.api.mvc.AnyContent
import play.api.mvc.Action
import play.api.mvc.Request
import java.io._
import java.util.Base64
import javax.imageio.ImageIO
import java.awt.image.BufferedImage


class ImageController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // This is the name of the directory in which all the crops are saved.
  var CROPS_DIR_NAME = ".crops"

  // Write the
  def writeImageFile(filename: String, b64String: String): Unit = {

    val imageBytes = Base64.getDecoder.decode(b64String)
    val inputStream = new ByteArrayInputStream(imageBytes)
    val bufferedImage = ImageIO.read(inputStream)
    val f = new File(filename)
    var result = ImageIO.write(bufferedImage, "jpg", f)
    // todo: log error if result is false
  }

  // Creates the base directory for the crops if it doesn't exist
  def initializeDirIfNeeded(): Unit = {
    val file = new File(CROPS_DIR_NAME)
    if (!file.exists()) {
      val result = file.mkdir()
      // todo: log error if result is false
    }
  }

  def saveImage = Action { request: Request[AnyContent] =>

    initializeDirIfNeeded()

    val body: AnyContent = request.body
    val jsonBody: Option[JsValue] = body.asJson
    // some
    // Expecting json body
    jsonBody
      .map { json =>
        var b64String: String = (json \ "b64").as[String].split(",")(1)
        var name = (json \ "name").as[String]

        writeImageFile(CROPS_DIR_NAME + File.separator + name, b64String)

        Ok("Got: " + (json \ "name").as[String])
      }
      .getOrElse {
        BadRequest("Expecting application/json request body")
      }
  }
}
