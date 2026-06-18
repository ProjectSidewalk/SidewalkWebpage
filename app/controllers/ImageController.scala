package controllers

import controllers.base._
import formats.json.LabelFormats
import models.label.LabelTypeEnum
import play.api.{Configuration, Logger}
import play.api.libs.json._
import play.api.mvc.{AnyContent, Request, RequestHeader}
import service.ImageSigningService

import java.awt.Image
import java.awt.image.BufferedImage
import java.io._
import java.util.Base64
import javax.imageio.ImageIO
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@Singleton
class ImageController @Inject() (
    cc: CustomControllerComponents,
    panoDataService: service.PanoDataService,
    signingService: ImageSigningService,
    config: Configuration
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  // This is the name of the directory in which all the crops are saved. Subdirectory by city ID.
  private val CROPS_DIR_NAME = panoDataService.getCropDirectory

  // Allowed characters in a pano ID: GSV uses base64url-style (alphanumeric + - + _); Mapillary uses digits.
  private val PANO_ID_PATTERN = "^[A-Za-z0-9_-]+$".r

  // 2x the actual size of the pano window as retina screen can give us 2x the pixel density.
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

  /**
   * Returns true if the request's Referer or Origin header (when present) points to an allowed host.
   *
   * Missing headers are treated as allowed — they are legitimately absent in some privacy modes
   * and on direct requests. Only explicit cross-origin indicators from a disallowed host are rejected.
   * @param request The incoming request to check.
   */
  private def refererAllowed(request: RequestHeader): Boolean = {
    val allowedHosts                       = config.get[Seq[String]]("play.filters.hosts.allowed")
    def hostAllowed(host: String): Boolean = allowedHosts.exists { pattern =>
      val patternHost = pattern.split(":")(0) // strip port, e.g. "localhost:9000" → "localhost"
      if (patternHost.startsWith(".")) host.endsWith(patternHost) || host == patternHost.drop(1)
      else host == patternHost
    }
    def extractHost(header: String): Option[String] =
      Try(new java.net.URL(header).getHost).toOption

    val originOk  = request.headers.get("Origin").flatMap(extractHost).forall(hostAllowed)
    val refererOk = request.headers.get("Referer").flatMap(extractHost).forall(hostAllowed)
    originOk && refererOk
  }

  /**
   * Validates the ?exp and ?sig query parameters against the expected HMAC for this request path.
   *
   * Returns a Forbidden result if the signature is missing, invalid, or expired.
   * @param request The incoming request.
   * @param path    The canonical path to verify (e.g. "/backupImage/myPanoId").
   */
  private def verifySignature(request: RequestHeader, path: String): Option[play.api.mvc.Result] = {
    val exp = request.getQueryString("exp").flatMap(s => Try(s.toLong).toOption)
    val sig = request.getQueryString("sig")
    (exp, sig) match {
      case (Some(e), Some(s)) if signingService.verify(path, e, s) => None
      case _                                                       => Some(Forbidden("Invalid or expired image URL."))
    }
  }

  // Creates the base directory for the crops if it doesn't exist. Uses subdirectories /<city-id>/<label-type>.
  private def initializeDirIfNeeded(labelType: String): Unit = {
    val file = new File(CROPS_DIR_NAME + File.separator + labelType)
    if (!file.exists()) {
      val result = file.mkdirs()
      if (!result) {
        logger.error("Error creating directory: " + CROPS_DIR_NAME)
      }
    }
  }

  /**
   * Returns the backup image metadata for a pano as JSON, used by PopupPanoManager's lazy-fetch fallback.
   */
  def getBackupImageMetadata(panoId: String) = cc.securityService.SecuredAction { implicit request =>
    if (!refererAllowed(request)) {
      Future.successful(Forbidden("Request origin not allowed."))
    } else if (PANO_ID_PATTERN.findFirstIn(panoId).isEmpty) {
      Future.successful(BadRequest(s"Invalid pano ID: $panoId"))
    } else {
      panoDataService.getLocalBackupImage(panoId).map {
        case Some(p) =>
          val url = signingService.signedUrl(s"/backupImage/$panoId")
          Ok(LabelFormats.localBackupImagePayload(p, url))
        case None => NotFound(s"No backup image found for pano: $panoId")
      }
    }
  }

  /**
   * Serves a self-hosted equirectangular panorama image.
   *
   * Requires a valid HMAC signature (?exp=...&sig=...) and an allowed Referer/Origin.
   */
  def serveBackupImage(panoId: String) = cc.securityService.SecuredAction { implicit request =>
    val earlyReject =
      if (!refererAllowed(request)) Some(Forbidden("Request origin not allowed."))
      else if (PANO_ID_PATTERN.findFirstIn(panoId).isEmpty) Some(BadRequest(s"Invalid pano ID: $panoId"))
      else verifySignature(request, s"/backupImage/$panoId")

    earlyReject match {
      case Some(result) => Future.successful(result)
      case None         =>
        panoDataService.localBackupImageFile(panoId) match {
          case Some(file) =>
            // Fire-and-forget: keep pano_data.has_backup in sync with what's on disk. No-op when already true.
            panoDataService.markHasBackup(panoId).failed.foreach { e =>
              logger.warn(s"Failed to update has_backup for pano $panoId: ${e.getMessage}")
            }
            val contentType = if (file.getName.toLowerCase.endsWith(".png")) "image/png" else "image/jpeg"
            Future.successful(Ok.sendFile(file, inline = true).as(contentType))
          case None =>
            Future.successful(NotFound(s"Pano image not found: $panoId"))
        }
    }
  }

  /**
   * Serves a previously-saved crop image for a label.
   *
   * Requires a valid HMAC signature (?exp=...&sig=...) and an allowed Referer/Origin.
   */
  def serveCropImage(labelType: String, labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    val earlyReject =
      if (!refererAllowed(request)) Some(Forbidden("Request origin not allowed."))
      else if (!LabelTypeEnum.validLabelTypes.contains(labelType))
        Some(
          BadRequest(
            s"Invalid label type provided: $labelType. Valid label types are: ${LabelTypeEnum.validLabelTypes.mkString(", ")}."
          )
        )
      else verifySignature(request, s"/cropImage/$labelType/$labelId")

    earlyReject match {
      case Some(result) => Future.successful(result)
      case None         =>
        val file = panoDataService.cropFile(labelId, labelType)
        if (file.exists()) {
          Future.successful(Ok.sendFile(file, inline = true).as("image/png"))
        } else {
          Future.successful(NotFound("Crop image not found"))
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
        val labelId: Int      = (json \ "label_id").as[Int]
        // Validate the label type (matching serveCropImage) before using it to build a filesystem path.
        if (!LabelTypeEnum.validLabelTypes.contains(labelType)) {
          Future.successful(BadRequest(s"Invalid label type provided: $labelType."))
        } else {
          initializeDirIfNeeded(labelType)
          val b64String: String = (json \ "b64").as[String].split(",")(1)
          val filename: String  = panoDataService.cropFile(labelId, labelType).getPath
          try {
            writeImageFile(filename, b64String)
            Future.successful(Ok("Got: crop_" + labelId))
          } catch {
            case e: Exception =>
              logger.error("Exception when writing image file: " + filename + "\n\t" + e)
              Future.successful(InternalServerError("Exception when writing image file: " + filename + "\n\t" + e))
          }
        }
      }
      .getOrElse {
        Future.successful(BadRequest("Expecting application/json request body"))
      }
  }
}
