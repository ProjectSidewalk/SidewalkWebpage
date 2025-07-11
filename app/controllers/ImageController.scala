package controllers

import controllers.base._
import play.api.libs.json._
import play.api.mvc.{AnyContent, Request}
import play.api.{Configuration, Logger}

import java.awt.Image
import java.awt.image.BufferedImage
import java.io._
import java.util.Base64
import javax.imageio.ImageIO
import javax.inject.{Inject, Singleton}
import scala.concurrent.Future

@Singleton
class ImageController @Inject() (cc: CustomControllerComponents, config: Configuration)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  // This is the name of the directory in which all the crops are saved. Subdirectory by city ID.
  val CROPS_DIR_NAME = config.get[String]("cropped.image.directory") + File.separator + config.get[String]("city-id")

  // 2x the actual size of the GSV window as retina screen can give us 2x the pixel density.
  val CROP_WIDTH  = 1440
  val CROP_HEIGHT = 960

  // Resize the image to the new width and height.
  def resize(img: BufferedImage, newWidth: Int, newHeight: Int): BufferedImage = {
    val tmp: Image          = img.getScaledInstance(newWidth, newHeight, Image.SCALE_SMOOTH)
    val dimg: BufferedImage = new BufferedImage(newWidth, newHeight, img.getType)
    val g2d                 = dimg.createGraphics()
    g2d.drawImage(tmp, 0, 0, null)
    g2d.dispose()
    dimg
  }

  // Write the image to a file.
  def writeImageFile(filename: String, b64String: String): Unit = {
    val imageBytes: Array[Byte]      = Base64.getDecoder.decode(b64String)
    val inputStream                  = new ByteArrayInputStream(imageBytes)
    val bufferedImage: BufferedImage = ImageIO.read(inputStream)

    // Resize the image as we might be getting different sizes for different browser zoom levels.
    // The aspect ratio of the image should be preserved even if it is a different size so that should be okay.
    val resizedImage: BufferedImage = resize(bufferedImage, CROP_WIDTH, CROP_HEIGHT)

    val f = new File(filename)
    try {
      val result: Boolean = ImageIO.write(resizedImage, "png", f)
      if (!result) {
        logger.error("Failed to write image file: " + filename)
      }
    } catch {
      case e: IOException =>
        logger.error(s"IOException while writing image file $filename: ${e.getMessage}")
      case e: Exception =>
        logger.error(s"Unexpected error while writing image file $filename: ${e.getMessage}")
    } finally {
      inputStream.close()
    }
  }

  // Creates the base directory for the crops if it doesn't exist. Uses subdirectories /<city-id>/<label-type>.
  def initializeDirIfNeeded(labelType: String): Unit = {
    val file = new File(CROPS_DIR_NAME + File.separator + labelType)
    if (!file.exists()) {
      val result = file.mkdirs()
      if (!result) {
        logger.error("Error creating directory: " + CROPS_DIR_NAME)
      }
    }
  }

  // TODO multipart form data would be better for uploading images than using JSON.
  def saveImage = cc.securityService.SecuredAction { implicit request: Request[AnyContent] =>
    val body: AnyContent          = request.body
    val jsonBody: Option[JsValue] = body.asJson

    jsonBody
      .map { json =>
        val labelType: String = (json \ "label_type").as[String]
        initializeDirIfNeeded(labelType)
        val b64String: String = (json \ "b64").as[String].split(",")(1)
        val filename: String  =
          CROPS_DIR_NAME + File.separator + labelType + File.separator + (json \ "name").as[String] + ".png"
        try {
          writeImageFile(filename, b64String)
          Future.successful(Ok("Got: " + (json \ "name").as[String]))
        } catch {
          case e: Exception =>
            logger.error("Exception when writing image file: " + filename + "\n\t" + e)
            Future.successful(InternalServerError("Exception when writing image file: " + filename + "\n\t" + e))
        }
      }
      .getOrElse {
        Future.successful(BadRequest("Expecting application/json request body"))
      }
  }
}
