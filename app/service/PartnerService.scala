package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.partner._
import models.utils.{ImageUtils, MyPostgresProfile}
import play.api.Configuration
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.net.URI
import java.time.OffsetDateTime
import javax.imageio.ImageIO
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@ImplementedBy(classOf[PartnerServiceImpl])
trait PartnerService {
  def getPartnersForLanding: Future[Seq[PartnerMetadata]]
  def getAdminLists: Future[(Seq[PartnerMetadata], Seq[PartnerMetadata])]
  def getLogoForServing(partnerId: Int, version: Option[String]): Future[Option[(Array[Byte], String, OffsetDateTime)]]
  def createPartner(
      cityId: Option[String],
      name: String,
      url: Option[String],
      altText: Option[String],
      logo: Option[PartnerLogoUpload],
      userId: String
  ): Future[Either[PartnerRejection, PartnerMetadata]]
  def updatePartner(
      partnerId: Int,
      allowedScopes: Set[Option[String]],
      name: String,
      url: Option[String],
      altText: Option[String],
      newLogo: Option[PartnerLogoUpload],
      userId: String
  ): Future[Either[PartnerRejection, Unit]]
  def deletePartner(partnerId: Int, allowedScopes: Set[Option[String]]): Future[Either[PartnerRejection, Unit]]
  def reorderPartners(cityId: Option[String], orderedIds: Seq[Int]): Future[Either[PartnerRejection, Unit]]
  def logoUploadMaxBytes: Long
}

/**
 * Business logic for community-partner logos on the landing page (#4516): scoped reads (a city's landing page shows
 * global partners plus its own), the admin CRUD, and the upload pipeline that validates and re-encodes logo images
 * before they're stored as DB bytes.
 *
 * The authorization matrix lives in `allowedScopes`, computed by the controller from the caller's role: an
 * Administrator may touch only the current city's rows, an Owner also the global (None) scope. A row outside the
 * caller's scopes is reported as NotFound, indistinguishable from a missing id.
 *
 * Reads that serve the public landing page are cached in-process: partner data changes only on rare admin writes but
 * renders on the highest-traffic page. Same-instance writes invalidate immediately; the TTLs bound how stale another
 * instance can get (a global-partner edit is made on one city's app but rendered by all of them).
 */
@Singleton
class PartnerServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    configService: ConfigService,
    cacheApi: AsyncCacheApi,
    partnerTable: PartnerTable,
    cpuEc: CpuIntensiveExecutionContext,
    implicit val ec: ExecutionContext
) extends PartnerService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import PartnerServiceImpl._

  val logoUploadMaxBytes: Long = config.get[Long]("partners.logo-upload-max-bytes")

  def getPartnersForLanding: Future[Seq[PartnerMetadata]] = {
    cacheApi.getOrElseUpdate(LANDING_CACHE_KEY, LANDING_CACHE_TTL) {
      db.run(partnerTable.getForLanding(configService.getCityId))
    }
  }

  def getAdminLists: Future[(Seq[PartnerMetadata], Seq[PartnerMetadata])] = {
    for {
      city   <- db.run(partnerTable.getByScope(Some(configService.getCityId)))
      global <- db.run(partnerTable.getByScope(None))
    } yield (city, global)
  }

  /**
   * The logo bytes for one partner. Served from the in-process cache only when `version` matches the cached row's
   * logo version, so a just-replaced logo's new URL can never be answered with the old bytes — the URL contract is
   * "these exact bytes, forever" (the controller marks them immutable). Any other request reads fresh from the DB
   * and refreshes the cache; the cache holds at most one entry per partner, so unmatched `v` spam can't grow it.
   */
  def getLogoForServing(
      partnerId: Int,
      version: Option[String]
  ): Future[Option[(Array[Byte], String, OffsetDateTime)]] = {
    cacheApi.get[(Array[Byte], String, OffsetDateTime)](logoCacheKey(partnerId)).flatMap {
      case Some(cached) if version.contains(PartnerMetadata.logoVersionOf(cached._3).toString) =>
        Future.successful(Some(cached))
      case _ =>
        db.run(partnerTable.getLogo(partnerId)).map { fresh =>
          fresh.foreach(cacheApi.set(logoCacheKey(partnerId), _, LOGO_CACHE_TTL))
          fresh
        }
    }
  }

  def createPartner(
      cityId: Option[String],
      name: String,
      url: Option[String],
      altText: Option[String],
      logo: Option[PartnerLogoUpload],
      userId: String
  ): Future[Either[PartnerRejection, PartnerMetadata]] = {
    validateFields(name, url, altText) match {
      case Left(rejection)                   => Future.successful(Left(rejection))
      case Right((cleanName, cleanUrl, alt)) =>
        logo match {
          case None         => Future.successful(Left(PartnerRejection.LogoRequired))
          case Some(upload) =>
            processLogo(upload).flatMap {
              case Left(rejection)                     => Future.successful(Left(rejection))
              case Right((bytes, mime, width, height)) =>
                val now = OffsetDateTime.now
                db.run(
                  partnerTable.insert(
                    Partner(0, cityId, cleanName, cleanUrl, alt, 0, bytes, mime, width, height, now, now, userId,
                      userId)
                  )
                ).flatMap(metadata => invalidate(None).map(_ => Right(metadata)))
            }
        }
    }
  }

  def updatePartner(
      partnerId: Int,
      allowedScopes: Set[Option[String]],
      name: String,
      url: Option[String],
      altText: Option[String],
      newLogo: Option[PartnerLogoUpload],
      userId: String
  ): Future[Either[PartnerRejection, Unit]] = {
    validateFields(name, url, altText) match {
      case Left(rejection)                   => Future.successful(Left(rejection))
      case Right((cleanName, cleanUrl, alt)) =>
        inAllowedScope(partnerId, allowedScopes).flatMap {
          case Left(rejection) => Future.successful(Left(rejection))
          case Right(_)        =>
            val processedLogo: Future[Either[PartnerRejection, Option[(Array[Byte], String, Int, Int)]]] =
              newLogo match {
                case None         => Future.successful(Right(None))
                case Some(upload) => processLogo(upload).map(_.map(Some(_)))
              }
            processedLogo.flatMap {
              case Left(rejection) => Future.successful(Left(rejection))
              case Right(logoData) =>
                db.run(
                  partnerTable.update(partnerId, cleanName, cleanUrl, alt, logoData, userId, OffsetDateTime.now)
                ).flatMap(_ => invalidate(Some(partnerId)).map(_ => Right(())))
            }
        }
    }
  }

  def deletePartner(partnerId: Int, allowedScopes: Set[Option[String]]): Future[Either[PartnerRejection, Unit]] = {
    inAllowedScope(partnerId, allowedScopes).flatMap {
      case Left(rejection) => Future.successful(Left(rejection))
      case Right(_)        =>
        db.run(partnerTable.delete(partnerId)).flatMap(_ => invalidate(Some(partnerId)).map(_ => Right(())))
    }
  }

  def reorderPartners(cityId: Option[String], orderedIds: Seq[Int]): Future[Either[PartnerRejection, Unit]] = {
    db.run(partnerTable.reorderScope(cityId, orderedIds)).flatMap {
      case false => Future.successful(Left(PartnerRejection.BadOrder))
      case true  => invalidate(None).map(_ => Right(()))
    }
  }

  /** Drops the landing-page cache (and, when given, one partner's logo cache) after a successful write. */
  private def invalidate(partnerId: Option[Int]): Future[Unit] = {
    val removals = cacheApi.remove(LANDING_CACHE_KEY) +: partnerId.map(id => cacheApi.remove(logoCacheKey(id))).toSeq
    Future.sequence(removals).map(_ => ())
  }

  /** NotFound for both a missing id and a row outside the caller's scopes, so the two are indistinguishable. */
  private def inAllowedScope(
      partnerId: Int,
      allowedScopes: Set[Option[String]]
  ): Future[Either[PartnerRejection, PartnerMetadata]] = {
    db.run(partnerTable.get(partnerId)).map {
      case Some(metadata) if allowedScopes.contains(metadata.cityId) => Right(metadata)
      case _                                                         => Left(PartnerRejection.NotFound)
    }
  }

  /** Trims the text fields and enforces their caps; the URL must be absolute http(s) since it lands in an href. */
  private def validateFields(
      name: String,
      url: Option[String],
      altText: Option[String]
  ): Either[PartnerRejection, (String, Option[String], Option[String])] = {
    val cleanName = name.trim
    val cleanUrl  = url.map(_.trim).filter(_.nonEmpty)
    val cleanAlt  = altText.map(_.trim).filter(_.nonEmpty)
    if (cleanName.isEmpty || cleanName.length > MAX_NAME_LENGTH) Left(PartnerRejection.NameInvalid)
    else if (!cleanUrl.forall(urlOk)) Left(PartnerRejection.UrlInvalid)
    else if (cleanAlt.exists(_.length > MAX_ALT_TEXT_LENGTH)) Left(PartnerRejection.AltTextInvalid)
    else Right((cleanName, cleanUrl, cleanAlt))
  }

  private def urlOk(url: String): Boolean = {
    url.length <= MAX_URL_LENGTH && Try {
      val uri = new URI(url)
      Set("http", "https").contains(Option(uri.getScheme).getOrElse("").toLowerCase) && uri.getHost != null
    }.getOrElse(false)
  }

  /**
   * Validates and re-encodes an uploaded logo on the CPU-bound pool: sniff the real format (the declared MIME type is
   * untrusted and ignored), guard against decompression bombs, downscale to the display budget, and re-encode — which
   * also strips any embedded metadata. PNG stays PNG so transparency survives; JPEG stays JPEG.
   *
   * @return The stored form: (bytes, mime type, width, height).
   */
  private def processLogo(
      upload: PartnerLogoUpload
  ): Future[Either[PartnerRejection, (Array[Byte], String, Int, Int)]] = Future {
    if (upload.tempFile.length > logoUploadMaxBytes) Left(PartnerRejection.LogoTooLarge)
    else {
      ImageUtils.sniffAcceptedFormat(upload.tempFile, ACCEPTED_FORMATS, MAX_SOURCE_DIMENSION, MAX_SOURCE_PIXELS) match {
        case None         => Left(PartnerRejection.LogoInvalid)
        case Some(format) =>
          // The decode sits inside the Try: ImageIO.read can throw (not just return null) on a file whose header
          // sniffs fine but whose pixel data it can't decode — e.g. a CMYK JPEG or a truncated PNG.
          Try {
            Option(ImageIO.read(upload.tempFile)).map { src =>
              val scaled        = ImageUtils.scaleToMaxEdgePreservingAlpha(src, MAX_OUTPUT_EDGE)
              val (bytes, mime) =
                if (format == "png") (ImageUtils.writePngBytes(scaled), "image/png")
                else (ImageUtils.writeJpegBytes(scaled, JPEG_QUALITY), "image/jpeg")
              (bytes, mime, scaled.getWidth, scaled.getHeight)
            }
          }.toOption.flatten
            .toRight(PartnerRejection.LogoInvalid: PartnerRejection)
            // At <= 800px even a lossless PNG stays far under the cap, but the DB CHECK is the invariant, so
            // enforce it here rather than letting the insert blow up.
            .filterOrElse(_._1.length <= MAX_LOGO_BYTES, PartnerRejection.LogoEncodedTooLarge)
      }
    }
  }(cpuEc)
}

object PartnerServiceImpl {
  // Stored logo bytes may not exceed this; must match the octet_length CHECK in the partner table (evolution 370).
  val MAX_LOGO_BYTES: Int = 1048576

  // Upload formats validated against the SNIFFED format, never the client-declared MIME type. Deliberately narrow —
  // stock ImageIO has no SVG/WebP reader, and stored SVG would be a script-bearing document served from our origin.
  // The admin page rasterizes a picked SVG to PNG in the browser; a hand-rolled POST of raw SVG is still rejected.
  private val ACCEPTED_FORMATS = Set("jpeg", "png")

  // Decompression-bomb guards, same values and rationale as StoryService (#4054 hardening).
  private val MAX_SOURCE_DIMENSION    = 12000
  private val MAX_SOURCE_PIXELS: Long = 40000000L

  // Longest edge of the stored logo: it renders at <= ~220 CSS px, so 800 covers HiDPI displays comfortably.
  private val MAX_OUTPUT_EDGE = 800
  private val JPEG_QUALITY    = 0.85f

  val MAX_NAME_LENGTH: Int     = 100
  val MAX_ALT_TEXT_LENGTH: Int = 300
  val MAX_URL_LENGTH: Int      = 500

  // Cross-instance staleness bound for the cached landing list (same-instance writes invalidate immediately).
  private val LANDING_CACHE_TTL = 10.minutes
  // Logo bytes are only served from cache when the requested ?v= matches, so this TTL is memory hygiene, not a
  // correctness bound.
  private val LOGO_CACHE_TTL = 1.hour

  private val LANDING_CACHE_KEY            = "partnersForLanding"
  private def logoCacheKey(partnerId: Int) = s"partnerLogo_$partnerId"
}
