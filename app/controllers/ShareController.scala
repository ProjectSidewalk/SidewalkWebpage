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
import java.nio.file.{Files, StandardCopyOption}
import javax.imageio.stream.FileImageOutputStream
import javax.imageio.{IIOImage, ImageIO, ImageWriteParam}
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Using

/**
 * Public social-share surface for a single label (issue #456).
 *
 * Exposes two account-free, crawler-reachable endpoints: `/label/:labelId` renders a lightweight single-label spotlight
 * page (label crop + read-only metadata + a small map of nearby labels) with Open Graph / Twitter Card meta so a pasted
 * link produces a rich preview, and `/label/:labelId/image` serves the unsigned, marker-composited preview image that
 * crawlers embed. The spotlight page deliberately does NOT load the full LabelMap: that page's `/labels/all` fetch is a
 * city's single most expensive endpoint, so pointing bot-crawled share URLs at it is wasteful (#456, Mikey review). The
 * nearby-labels map instead reads the cheap, bbox-bounded public `/v3/api/rawLabels` API. Neither endpoint creates a
 * user or sets a cookie; when there is no signed-in identity the shared default "anonymous" user is used for display.
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

  // JPEG for the cached previews: the base imagery is already lossy (GSV/Mapillary JPEGs), every platform re-encodes
  // the card image into its own CDN, and 0.85 is visually transparent at card sizes while ~10-20x smaller than PNG —
  // which matters for crawler fetch timeouts and per-city cache volume.
  private val SHARE_IMAGE_JPEG_QUALITY = 0.85f

  // Ceiling on cached previews per city. The image endpoint is public and label ids are enumerable, so without a
  // ceiling a crawler sweep could write one JPEG per label id and fill the volume; at ~250KB each this caps the cache
  // near 2.5GB. Past it, the least-recently-served files are evicted (see evictStaleShareImages).
  private val MAX_CACHED_SHARE_IMAGES = 10000

  /**
   * Renders the public single-label spotlight page: the label's crop and read-only metadata as a hero, a small map of
   * nearby labels (fed by the cheap public `/v3/api/rawLabels` API), and per-label OG/Twitter meta in the <head>.
   * Reachable anonymously (no account created, no cookie set) so social crawlers can read the preview.
   *
   * @param labelId The label to share.
   * @return `Ok` with the spotlight page, or `NotFound` if no such label exists.
   */
  def label(labelId: Int) = silhouette.UserAwareAction.async { implicit request =>
    val displayUser: Future[SidewalkUserWithRole] =
      request.identity.map(Future.successful).getOrElse(authenticationService.getDefaultAnonUser)

    displayUser.flatMap { user =>
      labelService.getSingleLabelMetadata(labelId, user.userId).flatMap {
        case None       => Future.successful(NotFound(s"No label found with ID: $labelId"))
        case Some(meta) =>
          for {
            commonData  <- configService.getCommonPageData(request2Messages.lang)
            labelLatLng <- labelService.getLabelLatLng(labelId)
          } yield {
            cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, s"Visit_SharedLabel=$labelId")
            val shareMeta: Html = buildShareMeta(commonData, meta)
            val title: String   = shareTitle(meta)
            Ok(
              views.html.apps.sharedLabel(commonData, title, user, meta, labelLatLng, cityNameOf(commonData), shareMeta)
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
   * @return `Ok` with an `image/jpeg`, or `NotFound` if no such label exists.
   */
  def shareImage(labelId: Int) = Action.async { implicit request =>
    val cachedFile = new File(shareImageDir, s"share_$labelId.jpg")
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

  /**
   * Builds the localized share title. Issue types ("I found an accessibility issue...") and non-issue types (positive
   * features like curb ramps, or neutral types like occlusions — "Look what I found...") take opposite framings, so
   * the copy forks on the label type's `isAccessProblem`.
   */
  private def shareTitle(meta: LabelMetadata)(implicit messages: Messages): String = {
    val key: String = if (meta.labelType.isAccessProblem) "share.meta.title.issue" else "share.meta.title.feature"
    Messages(key, Messages(meta.labelType.nameKey))
  }

  /** Builds the OG/Twitter meta block for a label's share page from localized, prod-absolute values. */
  private def buildShareMeta(commonData: service.CommonPageData, meta: LabelMetadata)(implicit
      messages: Messages
  ): Html = {
    val base: String     = commonData.prodUrl.stripSuffix("/")
    val pageUrl: String  = s"$base/label/${meta.labelId}"
    val imageUrl: String = s"$base/label/${meta.labelId}/image"
    val typeName: String = Messages(meta.labelType.nameKey)
    val cityName: String = cityNameOf(commonData)
    // The description is short, fully-localized sentences joined in a fixed order, with the data-dependent ones
    // (severity, tags) included only when present. Severity is stated only for access-issue types — on positive
    // features the same column encodes quality, not badness. Tag names are stored untranslated; server-side tag
    // localization is #4445.
    val description: String = Seq(
      Some(Messages("share.meta.description.spotted", cityName)),
      meta.severity
        .filter(_ => meta.labelType.isAccessProblem)
        .map(s => Messages("share.meta.description.severity", s)),
      Option(meta.tags).filter(_.nonEmpty).map(t => Messages("share.meta.description.tags", t.take(3).mkString(", "))),
      Some(Messages("share.meta.description.cta"))
    ).flatten.mkString(" ")
    val imageAlt: String = Messages("share.meta.image.alt", typeName)
    views.html.common.shareMeta(
      shareTitle(meta), description, pageUrl, imageUrl, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, imageAlt
    )
  }

  /** The formatted display name of the current deployment city (e.g. "Seattle, WA"), or "" if it can't be resolved. */
  private def cityNameOf(commonData: service.CommonPageData): String =
    commonData.allCityInfo.find(_.cityId == commonData.cityId).map(_.cityNameFormatted).getOrElse("")

  /**
   * Directory where cached share preview images live: `<share.image.directory>/<city-id>/`. A relative configured
   * path (the `.share-images` default) is resolved against the application root, not the process working directory —
   * a staged prod app runs from the stage dir, so a CWD-relative path would silently point somewhere else there.
   */
  private[controllers] def shareImageDir: File = {
    val configured = new File(config.get[String]("share.image.directory"))
    val base       = if (configured.isAbsolute) configured else environment.getFile(configured.getPath)
    new File(base, configService.getCityId)
  }

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
    baseImage(meta, imagerySource).map {
      case Some(base) =>
        val composited: BufferedImage = compositeMarker(base, meta.labelType, meta.canvasXY)
        cacheFile.getParentFile.mkdirs()
        writeJpeg(composited, cacheFile)
        if (cacheFile.exists()) {
          evictStaleShareImages(cacheFile.getParentFile)
          Some(cacheFile)
        } else {
          logger.error(s"Failed to write share image: ${cacheFile.getPath}")
          None
        }
      case None => None
    }
  }

  /**
   * Evicts the least-recently-served cached previews once the per-city cache holds more than `maxFiles` images.
   *
   * serveImage touches each file's mtime on every hit, so sorting by mtime approximates LRU. Runs on the cache-miss
   * path only (right after a build), where the O(n) directory listing is noise next to the imagery fetch + composite
   * it follows. The branded fallback can be evicted like any other file — it's rebuilt on demand.
   */
  private[controllers] def evictStaleShareImages(dir: File, maxFiles: Int = MAX_CACHED_SHARE_IMAGES): Unit = {
    val cached = Option(dir.listFiles()).getOrElse(Array.empty[File]).filter(_.isFile)
    if (cached.length > maxFiles) {
      cached.sortBy(_.lastModified()).take(cached.length - maxFiles).foreach { f =>
        val _ = f.delete()
      }
    }
  }

  /** Reads the stored crop if present, else fetches the Google Street View still (GSV imagery only), else `None`. */
  private def baseImage(meta: LabelMetadata, imagerySource: PanoSource): Future[Option[BufferedImage]] = {
    val crop: File = panoDataService.cropFile(meta.labelId, meta.labelType.name)
    if (crop.exists()) {
      Future.successful(Option(ImageIO.read(crop)))
    } else {
      panoDataService.getImageUrl(meta.panoId, imagerySource, meta.pov.heading, meta.pov.pitch, meta.pov.zoom) match {
        case Some(url) =>
          ws.url(url)
            .get()
            .map { r =>
              if (r.status != 200) None
              else {
                // GSV answers an expired/removed pano with HTTP 200 and a flat "Sorry, we have no imagery here"
                // placeholder; reject near-uniform images so we serve the branded fallback instead of sharing it.
                Option(ImageIO.read(new ByteArrayInputStream(r.bodyAsBytes.toArray)))
                  .filterNot(looksLikeBlankImagery)
              }
            }
            .recover { case e =>
              logger.warn(s"Failed to fetch GSV still for label ${meta.labelId}: ${e.getMessage}"); None
            }
        case None => Future.successful(None)
      }
    }
  }

  /**
   * Detects provider "no imagery" placeholders: a dense sample grid where nearly every pixel sits within a small
   * distance of the mean color. Real street photos are nowhere near this uniform, while the placeholder's text
   * occupies only a tiny fraction of pixels, so a 95% threshold separates them cleanly.
   */
  private[controllers] def looksLikeBlankImagery(img: BufferedImage): Boolean = {
    val grid = 64
    val xs   = (0 until grid).map(i => i * (img.getWidth - 1) / (grid - 1))
    val ys   = (0 until grid).map(i => i * (img.getHeight - 1) / (grid - 1))

    val samples = for {
      y <- ys
      x <- xs
    } yield {
      val rgb = img.getRGB(x, y)
      ((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff)
    }
    val n             = samples.size
    val (mr, mg, mb)  = (samples.map(_._1).sum / n, samples.map(_._2).sum / n, samples.map(_._3).sum / n)
    val nearMeanCount = samples.count { case (r, g, b) =>
      math.abs(r - mr) <= 12 && math.abs(g - mg) <= 12 && math.abs(b - mb) <= 12
    }
    nearMeanCount.toDouble / n >= 0.95
  }

  /**
   * Renders the base image onto a fixed SHARE_IMAGE_WIDTH×HEIGHT canvas and draws the label-type icon at the label's
   * canvas position so the shared preview points at the labeled spot. The output size is fixed (cover-scale, center-
   * crop) so the og:image:width/height the meta advertises is always true regardless of the base image's source
   * (stored crops are 1440×960 but GSV stills come back 640×480), and cards stay high-res on every platform.
   */
  private[controllers] def compositeMarker(
      base: BufferedImage,
      labelType: LabelTypeEnum.Base,
      canvasXY: LocationXY
  ): BufferedImage = {
    // RGB (not ARGB): the canvas is fully covered by the base photo, and ImageIO's JPEG writer rejects alpha.
    val out: BufferedImage = new BufferedImage(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, BufferedImage.TYPE_INT_RGB)
    val g                  = out.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)

    // Cover-scale: fill the canvas and center-crop the overflow rather than letterbox or stretch.
    val scale: Double = math.max(
      SHARE_IMAGE_WIDTH.toDouble / base.getWidth,
      SHARE_IMAGE_HEIGHT.toDouble / base.getHeight
    )
    val scaledW: Int = math.round(base.getWidth * scale).toInt
    val scaledH: Int = math.round(base.getHeight * scale).toInt
    val offX: Int    = (scaledW - SHARE_IMAGE_WIDTH) / 2
    val offY: Int    = (scaledH - SHARE_IMAGE_HEIGHT) / 2
    g.drawImage(base, -offX, -offY, scaledW, scaledH, null)

    // The colored "small" icon variant is the same marker family the Gallery overlays on card photos, carrying the
    // label type's canonical color (the large `{name}.png` illustrations are grayscale).
    val iconFile: File = environment.getFile(s"public/images/icons/label_type_icons/${labelType.name}_small.png")
    if (iconFile.exists()) {
      Option(ImageIO.read(iconFile)).foreach { icon =>
        // The stored canvas position is a fraction of the label-point canvas; map it through the same
        // cover-scale + crop transform as the base image so the marker stays on the labeled spot.
        val centerX: Int = (canvasXY.x.toDouble / LabelPointTable.canvasWidth * scaledW).toInt - offX
        val centerY: Int = (canvasXY.y.toDouble / LabelPointTable.canvasHeight * scaledH).toInt - offY
        // ~65px on the 2x-retina canvas = a 32px marker at display size, matching the map-marker scale.
        val iconW: Int = math.max(24, (SHARE_IMAGE_WIDTH * 0.045).toInt)
        val iconH: Int = (icon.getHeight.toDouble / icon.getWidth * iconW).toInt
        g.drawImage(icon, centerX - iconW / 2, centerY - iconH / 2, iconW, iconH, null)
      }
    }
    g.dispose()
    out
  }

  /** Serves a cached JPEG with a long cache lifetime (the image content for a label is immutable once generated). */
  private def serveImage(file: File): Result = {
    // Best-effort mtime touch so evictStaleShareImages approximates LRU; eviction order degrades gracefully if the
    // filesystem refuses.
    val _ = file.setLastModified(System.currentTimeMillis())
    Ok.sendFile(file, inline = true).as("image/jpeg").withHeaders("Cache-Control" -> "public, max-age=86400")
  }

  /**
   * Writes the image to the given file as a quality-controlled JPEG (ImageIO's default writer quality is lower).
   *
   * The write is atomic: bytes go to a temp file in the same directory, which is then moved over the target.
   * Concurrent first requests for the same label may build in parallel (harmless duplicate work; last mover wins),
   * but a reader can never be served a half-written file.
   */
  private def writeJpeg(img: BufferedImage, file: File): Unit = {
    val tmp    = File.createTempFile(s"${file.getName}.", ".tmp", file.getParentFile)
    val writer = ImageIO.getImageWritersByFormatName("jpg").next()
    try {
      val params = writer.getDefaultWriteParam
      params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
      params.setCompressionQuality(SHARE_IMAGE_JPEG_QUALITY)
      Using.resource(new FileImageOutputStream(tmp)) { out =>
        writer.setOutput(out)
        writer.write(null, new IIOImage(img, null, null), params)
      }
      val _ = Files.move(tmp.toPath, file.toPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
      writer.dispose()
      val _ = tmp.delete() // No-op after a successful move; cleans up the temp file if the write failed midway.
    }
  }

  /**
   * Branded fallback served when no pano image is available for a label: the logo centered on a white
   * SHARE_IMAGE_WIDTH×HEIGHT canvas, so even the fallback matches the dimensions the meta advertises. Built once per
   * city and cached alongside the per-label images.
   */
  private def serveFallbackImage(): Result = {
    val cached: File = new File(shareImageDir, "share_fallback.jpg")
    if (!cached.exists()) buildFallbackImage(cached)
    if (cached.exists()) serveImage(cached) else NotFound("No preview image available.")
  }

  /** Renders the logo centered on a white fixed-size canvas to the given cache file (no-op if the logo is missing). */
  private[controllers] def buildFallbackImage(cached: File): Unit = {
    val logo: File = environment.getFile("public/images/sidewalk-logo.png")
    Option(if (logo.exists()) ImageIO.read(logo) else null).foreach { mark =>
      val out = new BufferedImage(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, BufferedImage.TYPE_INT_RGB)
      val g   = out.createGraphics()
      g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
      g.setColor(java.awt.Color.WHITE)
      g.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
      val markW: Int = (SHARE_IMAGE_WIDTH * 0.55).toInt
      val markH: Int = (mark.getHeight.toDouble / mark.getWidth * markW).toInt
      g.drawImage(mark, (SHARE_IMAGE_WIDTH - markW) / 2, (SHARE_IMAGE_HEIGHT - markH) / 2, markW, markH, null)
      g.dispose()
      cached.getParentFile.mkdirs()
      writeJpeg(out, cached)
    }
  }
}
