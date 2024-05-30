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

import java.awt.Image
import java.awt.image.BufferedImage
import java.io._
import java.util.Base64
import javax.imageio.ImageIO

class ImageController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // This is the name of the directory in which all the crops are saved. Subdirectory by city ID.
  val CROPS_DIR_NAME = Play.configuration.getString("cropped.image.directory").get + File.separator + Play.configuration.getString("city-id").get

  // 2x the actual size of the GSV window as retina screen can give us 2x the pixel density.
  val CROP_WIDTH = 1440
  val CROP_HEIGHT = 960


  // Resize the image to the new width and height.
  def resize(img: BufferedImage, newWidth: Int, newHeight: Int): BufferedImage = {
    val tmp: Image = img.getScaledInstance(newWidth, newHeight, Image.SCALE_SMOOTH)
    val dimg: BufferedImage = new BufferedImage(newWidth, newHeight, img.getType())
    val g2d = dimg.createGraphics()
    g2d.drawImage(tmp, 0, 0, null)
    g2d.dispose()
    dimg
  }

  // Write the image to a file.
  def writeImageFile(filename: String, b64String: String): Unit = {
    val imageBytes: Array[Byte] = Base64.getDecoder.decode(b64String)
    val inputStream = new ByteArrayInputStream(imageBytes)
    val bufferedImage: BufferedImage = ImageIO.read(inputStream)

    // Resize the image as we might be getting different sizes for different browser zoom levels.
    // The aspect ratio of the image should be preserved even if it is a different size so that should be okay.
    val resizedImage: BufferedImage = resize(bufferedImage, CROP_WIDTH, CROP_HEIGHT)

    val f = new File(filename)
    try {
      val result: Boolean = ImageIO.write(resizedImage, "png", f)
      if (!result) {
        Logger.error("Failed to write image file: " + filename)
      }
    }
  }

  // Creates the base directory for the crops if it doesn't exist. Uses subdirectories /<city-id>/<label-type>.
  def initializeDirIfNeeded(labelType: String): Unit = {
    val file = new File(CROPS_DIR_NAME + File.separator + labelType)
    if (!file.exists()) {
      val result = file.mkdirs()
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
        val labelType: String = (json \ "label_type").as[String]
        initializeDirIfNeeded(labelType)
        val b64String: String = (json \ "b64").as[String].split(",")(1)
        val filename: String = CROPS_DIR_NAME + File.separator + labelType + File.separator + (json \ "name").as[String] + ".png"
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
