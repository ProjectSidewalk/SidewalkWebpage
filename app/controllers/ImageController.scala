package controllers

import controllers.base.*
import controllers.helper.SignedMediaUtils
import executors.CpuIntensiveExecutionContext
import formats.json.LabelFormats
import models.label.LabelType
import models.utils.ImageUtils
import play.api.libs.json.*
import play.api.mvc.{AnyContent, Request, RequestHeader}
import play.api.{Configuration, Logger}
import service.ImageSigningService

import java.awt.Image
import java.awt.image.BufferedImage
import java.io.*
import java.util.Base64
import javax.imageio.ImageIO
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try
import scala.util.control.NonFatal

@Singleton
class ImageController @Inject() (
    cc: CustomControllerComponents,
    panoDataService: service.PanoDataService,
    displayCopyService: service.PanoDisplayCopyService,
    cropService: service.CropService,
    signingService: ImageSigningService,
    shareImageCache: service.ShareImageCache,
    config: Configuration,
    cpuEc: CpuIntensiveExecutionContext
)(using ec: ExecutionContext)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  // This is the name of the directory in which all the crops are saved. Subdirectory by city ID.
  private val CROPS_DIR_NAME = panoDataService.getCropDirectory

  // Allowed characters in a pano ID: GSV uses base64url-style (alphanumeric + - + _); Mapillary uses digits.
  private val PANO_ID_PATTERN = "^[A-Za-z0-9_-]+$".r

  // Owned by the crop service: its reconcile pass tells the two crop writers apart by this width and the frame's
  // aspect ratio (#2660, #5085).
  val CROP_WIDTH = service.CropService.ExploreFrameCropWidth

  // Resize the image to the new width and height.
  def resize(img: BufferedImage, newWidth: Int, newHeight: Int): BufferedImage = {
    val tmp: Image          = img.getScaledInstance(newWidth, newHeight, Image.SCALE_SMOOTH)
    val dimg: BufferedImage = BufferedImage(newWidth, newHeight, img.getType)
    val g2d                 = dimg.createGraphics()
    g2d.drawImage(tmp, 0, 0, null)
    g2d.dispose()
    dimg
  }

  // Write the image to a file.
  /**
   * Decodes and stores a crop upload at `CROP_WIDTH` wide, keeping its aspect ratio.
   *
   * Browsers send different sizes for different zoom levels and pixel densities, so the width is normalized. The
   * height is not: a snapshot of an immersive-mode frame has the window's aspect ratio (#5085), and the marker every
   * card draws on it is a fraction of the crop, so squashing it to 3:2 would move the labeled spot as well as distort
   * the picture. `CropService.exploreSnapshotSize` mirrors this rounding.
   *
   * The upload's declared size is checked before anything is decoded (`CropService.acceptsSnapshot`): the stored
   * height follows the upload's aspect ratio, so without the check a hundred-byte 1x300 file would have the server
   * allocate a 1440x432,000 raster, and the resulting OutOfMemoryError is no `Exception` for the caller to recover.
   *
   * @return The stored image's (width, height), or the reason the upload was refused.
   */
  def writeImageFile(filename: String, b64String: String): Either[String, (Int, Int)] = {
    val imageBytes: Array[Byte] = Base64.getDecoder.decode(b64String)
    ImageUtils.encodedDimensions(imageBytes) match {
      case None                                                                   => Left("The upload is not an image.")
      case Some((srcW, srcH)) if !service.CropService.acceptsSnapshot(srcW, srcH) =>
        Left(s"Refusing a ${srcW}x$srcH upload: not the shape of a labeling frame.")
      case Some(_) =>
        val inputStream                  = ByteArrayInputStream(imageBytes)
        val bufferedImage: BufferedImage =
          try ImageIO.read(inputStream)
          finally inputStream.close()
        val (w, h) = service.CropService.exploreSnapshotSize(bufferedImage.getWidth, bufferedImage.getHeight)
        val resizedImage: BufferedImage = resize(bufferedImage, w, h)

        val f = File(filename)
        // A failed write is refused rather than reported as stored: the caller records the crop's provenance on a
        // Right, and a label_crop row for a file that isn't there would send every card to a broken image.
        try {
          if (ImageIO.write(resizedImage, "png", f)) Right((w, h))
          else {
            logger.error("Failed to write image file: " + filename)
            Left("The crop could not be stored.")
          }
        } catch {
          case e: IOException =>
            logger.error(s"IOException while writing image file $filename: ${e.getMessage}")
            Left("The crop could not be stored.")
        }
    }
  }

  private def refererAllowed(request: RequestHeader): Boolean =
    SignedMediaUtils.refererAllowed(request, config)

  private def verifySignature(request: RequestHeader, path: String): Option[play.api.mvc.Result] =
    SignedMediaUtils.verifySignature(request, path, signingService)

  // Creates the base directory for the crops if it doesn't exist. Uses subdirectories /<city-id>/<label-type>.
  private def initializeDirIfNeeded(labelType: String): Unit = {
    val file = File(CROPS_DIR_NAME + File.separator + labelType)
    if (!file.exists()) {
      val result = file.mkdirs()
      if (!result) {
        logger.error("Error creating directory: " + CROPS_DIR_NAME)
      }
    }
  }

  /**
   * Returns the backup image metadata for a pano as JSON, used by PopupPanoManager's lazy-fetch fallback.
   *
   * User-aware (#4643): read-only, referer-gated, and served on pages that render for cookie-less visitors.
   */
  def getBackupImageMetadata(panoId: String) = cc.securityService.UserAwareAction { implicit request =>
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
   * `?maxWidth=` is how a viewer says what its GPU can actually texture (#5256): Pannellum uploads an equirect as two
   * halves and refuses outright above `2 x MAX_TEXTURE_SIZE`, so a device advertising 4096 asks for 8192 and gets a
   * copy cut to it, on demand and cached. Without the parameter — every device that can render the pano as stored —
   * this serves the native file.
   *
   * A width that was asked for is a bound, never a preference: a copy that can't be cut right now (the cut pool is
   * full, or the cut failed) is a 503 with Retry-After, not the native file. A phone asks for 8192 because the native
   * file's decode is more memory than iOS lets a tab have (#5561), so handing it the native file "as a fallback"
   * would be handing it the crash; the viewer's own ladder steps down to a smaller width on the refusal instead.
   *
   * The pano's metadata (`width`/`height`) always describes the native file, since that is the frame label positions
   * are stored in; the viewer places markers by angle, so a smaller image is transparent to it.
   *
   * Requires a valid HMAC signature (?exp=...&sig=...) and an allowed Referer/Origin. User-aware (#4643): read-only
   * and already protected by the signature + referer checks, so no session is required to load the image.
   */
  def serveBackupImage(panoId: String) = cc.securityService.UserAwareAction { implicit request =>
    val earlyReject =
      if (!refererAllowed(request)) Some(Forbidden("Request origin not allowed."))
      else if (PANO_ID_PATTERN.findFirstIn(panoId).isEmpty) Some(BadRequest(s"Invalid pano ID: $panoId"))
      else verifySignature(request, s"/backupImage/$panoId")

    earlyReject match {
      case Some(result) => Future.successful(result)
      case None         =>
        panoDataService.localBackupImageFile(panoId) match {
          case Some(native) =>
            // Fire-and-forget: keep pano_data.has_backup in sync with what's on disk. No-op when already true.
            panoDataService.markHasBackup(panoId).failed.foreach { e =>
              logger.warn(s"Failed to update has_backup for pano $panoId: ${e.getMessage}")
            }
            // A width the viewer asked for is snapped down to an allowed one, so a malformed or unknown value
            // still yields something the device can render rather than a 400 it can't act on.
            val requested = request.getQueryString("maxWidth").flatMap(w => Try(w.toInt).toOption).filter(_ > 0)
            val chosen    = requested.map(service.PanoDisplayCopyService.snapToAllowed)
            val fileF: Future[Option[File]] = chosen match {
              case Some(maxWidth) =>
                // The service answers Unavailable rather than failing, but the refusal is the route's contract, so
                // it is stated here too: no way for a copy to go wrong may hand the caller more than it asked for.
                displayCopyService
                  .displayCopy(panoId, native, maxWidth)
                  .recover { case NonFatal(_) => service.DisplayCopy.Unavailable }
                  .map {
                    case service.DisplayCopy.Ready(copy) => Some(copy)
                    case service.DisplayCopy.NativeFits  => Some(native)
                    case service.DisplayCopy.Unavailable => None
                  }
              case None => Future.successful(Some(native))
            }
            fileF.map {
              case Some(file) =>
                val contentType = if (file.getName.toLowerCase.endsWith(".png")) "image/png" else "image/jpeg"
                Ok.sendFile(file, inline = true).as(contentType)
              case None =>
                ServiceUnavailable(s"No display copy of pano $panoId could be cut right now.")
                  .withHeaders(RETRY_AFTER -> "5")
            }
          case None =>
            Future.successful(NotFound(s"Pano image not found: $panoId"))
        }
    }
  }

  /**
   * Returns the crop image metadata (a signed serving URL) for a label as JSON, used to lazily fetch a  /cropImage URL.
   *
   * User-aware (#4643): read-only, referer-gated, and served on pages that render for cookie-less visitors.
   */
  def getCropImageMetadata(labelType: String, labelId: Int) = cc.securityService.UserAwareAction { implicit request =>
    if (!refererAllowed(request)) {
      Future.successful(Forbidden("Request origin not allowed."))
    } else {
      LabelType.withNameOption(labelType).map(panoDataService.cropUrl(labelId, _)) match {
        case None            => Future.successful(BadRequest(invalidLabelTypeMessage(labelType)))
        case Some(None)      => Future.successful(NotFound(s"No crop image found for label: $labelId"))
        case Some(Some(url)) =>
          cropService.cropMarker(labelId).map(m => Ok(LabelFormats.cropImagePayload(labelId, labelType, url, m)))
      }
    }
  }

  private def invalidLabelTypeMessage(labelType: String): String =
    s"Invalid label type provided: $labelType. Valid label types are: ${LabelType.names.mkString(", ")}."

  /**
   * Serves a previously-saved crop image for a label.
   *
   * Requires a valid HMAC signature (?exp=...&sig=...) and an allowed Referer/Origin. User-aware (#4643): read-only
   * and already protected by the signature + referer checks, so no session is required to load the image.
   */
  def serveCropImage(labelType: String, labelId: Int) = cc.securityService.UserAwareAction { implicit request =>
    val earlyReject =
      if (!refererAllowed(request)) Some(Forbidden("Request origin not allowed."))
      else if (!LabelType.labelTypeNames.contains(labelType)) Some(BadRequest(invalidLabelTypeMessage(labelType)))
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
        if (!LabelType.labelTypeNames.contains(labelType)) {
          Future.successful(BadRequest(s"Invalid label type provided: $labelType."))
        } else {
          initializeDirIfNeeded(labelType)
          val b64String: String = (json \ "b64").as[String].split(",")(1)
          val filename: String  = panoDataService.cropFile(labelId, labelType).getPath
          // Base64 decode + ImageIO read/resize/write is CPU-bound; run it off the request EC so concurrent crop
          // uploads can't starve the HTTP dispatcher (#4415).
          Future(writeImageFile(filename, b64String))(cpuEc)
            .flatMap {
              case Left(reason) if reason.startsWith("The crop could not be stored") =>
                Future.successful(InternalServerError(reason))
              case Left(reason) =>
                logger.warn(s"Refused crop upload for label $labelId: $reason")
                Future.successful(BadRequest(reason))
              case Right((width, height)) =>
                // The label's social-preview image may have been built and cached before this crop existed, from a
                // Street View still or the branded placeholder. That cache never expires, so drop it here and let the
                // next request rebuild it from the crop we just wrote (#4726).
                shareImageCache.invalidate(labelId)
                // Best effort: the crop is on disk either way, and the reconcile pass records any row this misses.
                cropService
                  .recordExploreFrameCrop(labelId, width, height)
                  .recover { case e: Exception =>
                    logger.warn(s"Could not record crop provenance for label $labelId: $e")
                  }
                  .map(_ => Ok("Got: crop_" + labelId))
            }
            .recover { case e: Exception =>
              logger.error("Exception when writing image file: " + filename + "\n\t" + e)
              InternalServerError("Exception when writing image file: " + filename + "\n\t" + e)
            }
        }
      }
      .getOrElse {
        Future.successful(BadRequest("Expecting application/json request body"))
      }
  }
}
