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
    try {
      val result: Boolean = ImageIO.write(bufferedImage, "png", f)
      if (!result) {
        Logger.error("Failed to write image file: " + filename)
      }
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
    val body: AnyContent = request.body
    val jsonBody: Option[JsValue] = body.asJson

    jsonBody
      .map { json =>
        initializeDirIfNeeded()
        val b64String: String = (json \ "b64").as[String].split(",")(1)
        val filename: String = CROPS_DIR_NAME + File.separator + (json \ "name").as[String] + ".png"
        try {
          writeImageFile(filename, b64String)
          Ok("Got: " + (json \ "name").as[String])
        } catch {
          case e: Exception =>
            Logger.error("Exception when writing image file: " + filename + "\n\t" + e)
            InternalServerError("Exception when writing image file: " + filename + "\n\t" + e)
        }
      }
      .getOrElse {
        BadRequest("Expecting application/json request body")
      }
  }
}
