package controllers

import controllers.base._
import models.auth.DefaultEnv
import models.label.{LabelMetadata, LabelPointTable, LabelTypeEnum, LocationXY}
import models.pano.PanoSource.PanoSource
import models.user.SidewalkUserWithRole
import play.api.i18n.Messages
import play.api.libs.ws.WSClient
import play.api.mvc._
import play.api.{Configuration, Environment, Logger}
import play.silhouette.api.Silhouette
import play.twirl.api.Html
import service.{AuthenticationService, ConfigService, LabelService, PanoDataService}

import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.{ByteArrayInputStream, File}
import java.nio.file.Files
import javax.imageio.ImageIO
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Public social-share surface for a single label (issue #456).
 *
 * Exposes two account-free, crawler-reachable endpoints: `/label/:labelId` renders the LabelMap focused on the label
 * with Open Graph / Twitter Card meta so a pasted link produces a rich preview, and `/label/:labelId/image` serves the
 * unsigned, marker-composited preview image that crawlers embed. Neither creates a user or sets a cookie; when there is
 * no signed-in identity the shared default "anonymous" user is used purely for display.
 */
@Singleton
class ShareController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    config: Configuration,
    environment: Environment,
    ws: WSClient,
    configService: ConfigService,
    labelService: LabelService,
    panoDataService: PanoDataService,
    authenticationService: AuthenticationService
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  // The preview image is the same 3:2 shape as a stored crop (2x for retina), which suits summary_large_image cards.
  private val SHARE_IMAGE_WIDTH  = 1440
  private val SHARE_IMAGE_HEIGHT = 960

  /**
   * Renders the public share landing page for a label: the LabelMap flown to the label with its popup auto-open, plus
   * per-label OG/Twitter meta in the <head>. Reachable anonymously (no account created, no cookie set) so social
   * crawlers can read the preview.
   *
   * @param labelId The label to share.
   * @return `Ok` with the LabelMap page, or `NotFound` if no such label exists.
   */
  def label(labelId: Int) = silhouette.UserAwareAction.async { implicit request =>
    val displayUser: Future[SidewalkUserWithRole] =
      request.identity.map(Future.successful).getOrElse(authenticationService.getDefaultAnonUser)

    displayUser.flatMap { user =>
      labelService.getSingleLabelMetadata(labelId, user.userId).flatMap {
        case None       => Future.successful(NotFound(s"No label found with ID: $labelId"))
        case Some(meta) =>
          for {
            commonData <- configService.getCommonPageData(request2Messages.lang)
            tags       <- labelService.getTagsForCurrentCity
          } yield {
            cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, s"Visit_SharedLabel=$labelId")
            val shareMeta: Html = buildShareMeta(commonData, meta)
            val title: String   = Messages("share.meta.title", Messages(meta.labelType.nameKey))
            Ok(
              views.html.apps.labelMap(commonData, title, user, tags, Seq.empty, Seq.empty, Seq.empty,
                focusLabelId = Some(labelId), shareMeta = shareMeta)
            )
          }
      }
    }
  }

  /**
   * Serves the label's social-preview image: the stored crop (or a fetched Google Street View still, or a branded
   * fallback) with the label-type marker composited on so the accessibility problem is highlighted. Public and unsigned
   * — this is the crawler-facing `og:image`, unlike the auth-gated `/cropImage` route. Results are cached to disk so
   * repeat crawler fetches are cheap and the URL stays stable.
   *
   * @param labelId The label whose preview image to serve.
   * @return `Ok` with an `image/png`, or `NotFound` if no such label exists.
   */
  def shareImage(labelId: Int) = Action.async { implicit request =>
    val cachedFile = new File(shareImageDir, s"share_$labelId.png")
    if (cachedFile.exists()) {
      Future.successful(serveImage(cachedFile))
    } else {
      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
        metaOpt    <- labelService.getSingleLabelMetadata(labelId, "")
        result     <- metaOpt match {
          case None       => Future.successful(NotFound(s"No label found with ID: $labelId"))
          case Some(meta) =>
            buildAndCacheShareImage(meta, commonData.imagerySource, cachedFile).map {
              case Some(file) => serveImage(file)
              case None       => serveFallbackImage()
            }
        }
      } yield result
    }
  }

  /** Builds the OG/Twitter meta block for a label's share page from localized, prod-absolute values. */
  private def buildShareMeta(commonData: service.CommonPageData, meta: LabelMetadata)(implicit
      messages: Messages
  ): Html = {
    val base: String     = commonData.prodUrl.stripSuffix("/")
    val pageUrl: String  = s"$base/label/${meta.labelId}"
    val imageUrl: String = s"$base/label/${meta.labelId}/image"
    val typeName: String = Messages(meta.labelType.nameKey)
    val cityName: String =
      commonData.allCityInfo.find(_.cityId == commonData.cityId).map(_.cityNameFormatted).getOrElse("")
    val title: String       = Messages("share.meta.title", typeName)
    val description: String = Messages("share.meta.description", cityName)
    views.html.common.shareMeta(title, description, pageUrl, imageUrl, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
  }

  /** Directory where cached share preview images live: `<share.image.directory>/<city-id>/`. */
  private def shareImageDir: File =
    new File(config.get[String]("share.image.directory") + File.separator + configService.getCityId)

  /**
   * Resolves the base image for a label (stored crop → fetched GSV still → none), composites the label-type marker onto
   * it, and writes the result to the cache file.
   *
   * @return The written file, or `None` if no base image could be resolved (caller serves a branded fallback).
   */
  private def buildAndCacheShareImage(
      meta: LabelMetadata,
      imagerySource: PanoSource,
      cacheFile: File
  ): Future[Option[File]] = {
    baseImageBytes(meta, imagerySource).map {
      case Some(bytes) =>
        Option(ImageIO.read(new ByteArrayInputStream(bytes))) match {
          case Some(base) =>
            val composited: BufferedImage = compositeMarker(base, meta.labelType, meta.canvasXY)
            cacheFile.getParentFile.mkdirs()
            if (!ImageIO.write(composited, "png", cacheFile)) {
              logger.error(s"Failed to write share image: ${cacheFile.getPath}")
              None
            } else Some(cacheFile)
          case None => None
        }
      case None => None
    }
  }

  /** Reads the stored crop if present, else fetches the Google Street View still (GSV imagery only), else `None`. */
  private def baseImageBytes(meta: LabelMetadata, imagerySource: PanoSource): Future[Option[Array[Byte]]] = {
    val crop: File = panoDataService.cropFile(meta.labelId, meta.labelType.name)
    if (crop.exists()) {
      Future.successful(Some(Files.readAllBytes(crop.toPath)))
    } else {
      panoDataService.getImageUrl(meta.panoId, imagerySource, meta.pov.heading, meta.pov.pitch, meta.pov.zoom) match {
        case Some(url) =>
          ws.url(url).get().map(r => if (r.status == 200) Some(r.bodyAsBytes.toArray) else None).recover { case e =>
            logger.warn(s"Failed to fetch GSV still for label ${meta.labelId}: ${e.getMessage}"); None
          }
        case None => Future.successful(None)
      }
    }
  }

  /**
   * Draws the label-type icon onto the base image at the label's canvas position so the shared preview points at the
   * accessibility problem. The canvas position is stored relative to the label-point canvas, so it's applied as a
   * fraction of the output dimensions.
   */
  private def compositeMarker(
      base: BufferedImage,
      labelType: LabelTypeEnum.Base,
      canvasXY: LocationXY
  ): BufferedImage = {
    val out: BufferedImage = new BufferedImage(base.getWidth, base.getHeight, BufferedImage.TYPE_INT_ARGB)
    val g                  = out.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    g.drawImage(base, 0, 0, null)

    val iconFile: File = environment.getFile(s"public/images/icons/label_type_icons/${labelType.name}.png")
    if (iconFile.exists()) {
      Option(ImageIO.read(iconFile)).foreach { icon =>
        val centerX: Int = (canvasXY.x.toDouble / LabelPointTable.canvasWidth * base.getWidth).toInt
        val centerY: Int = (canvasXY.y.toDouble / LabelPointTable.canvasHeight * base.getHeight).toInt
        val iconW: Int   = math.max(24, (base.getWidth * 0.09).toInt)
        val iconH: Int   = (icon.getHeight.toDouble / icon.getWidth * iconW).toInt
        g.drawImage(icon, centerX - iconW / 2, centerY - iconH / 2, iconW, iconH, null)
      }
    }
    g.dispose()
    out
  }

  /** Serves a PNG file with a long cache lifetime (the image content for a label is immutable once generated). */
  private def serveImage(file: File): Result =
    Ok.sendFile(file, inline = true).as("image/png").withHeaders("Cache-Control" -> "public, max-age=86400")

  /** Branded fallback served when no pano image is available for a label. */
  private def serveFallbackImage(): Result = {
    val logo: File = environment.getFile("public/assets/sidewalk-logo.png")
    if (logo.exists()) Ok.sendFile(logo, inline = true).as("image/png")
    else NotFound("No preview image available.")
  }
}
