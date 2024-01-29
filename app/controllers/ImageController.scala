package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.libs.json._
import play.api.mvc.AnyContent
import play.api.mvc.Action
import play.api.mvc.Request
import java.awt.image.BufferedImage
import java.io._
import java.util.Base64
import javax.imageio.ImageIO

class ImageController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // This is the name of the directory in which all the crops are saved.
  val CROPS_DIR_NAME = Play.configuration.getString("cropped.image.directory").get

  // Write the image to a file.
  def writeImageFile(filename: String, b64String: String): Unit = {
    val imageBytes: Array[Byte] = Base64.getDecoder.decode(b64String)
    val inputStream = new ByteArrayInputStream(imageBytes)
    val bufferedImage: BufferedImage = ImageIO.read(inputStream)
    val f = new File(filename)
    val result: Boolean = ImageIO.write(bufferedImage, "jpg", f)
    if (!result) {
      Logger.error("Error writing image file: " + filename)
    }
  }

  // Creates the base directory for the crops if it doesn't exist.
  def initializeDirIfNeeded(): Unit = {
    val file = new File(CROPS_DIR_NAME)
    if (!file.exists()) {
      val result = file.mkdir()
      if (!result) {
        Logger.error("Error creating directory: " + CROPS_DIR_NAME)
      }
    }
  }

  def saveImage = Action { request: Request[AnyContent] =>
    initializeDirIfNeeded()

    val body: AnyContent = request.body
    val jsonBody: Option[JsValue] = body.asJson
    // Expecting json body
    jsonBody
      .map { json =>
        val b64String: String = (json \ "b64").as[String].split(",")(1)
        val name: String = (json \ "name").as[String]
        writeImageFile(CROPS_DIR_NAME + File.separator + name, b64String)
        Ok("Got: " + (json \ "name").as[String])
      }
      .getOrElse {
        BadRequest("Expecting application/json request body")
      }
  }
}
