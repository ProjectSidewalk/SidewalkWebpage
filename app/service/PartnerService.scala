package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.partner._
import models.utils.{ImageUtils, MyPostgresProfile}
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.io.File
import java.net.URI
import java.time.OffsetDateTime
import javax.imageio.ImageIO
import javax.imageio.stream.FileImageInputStream
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Try

@ImplementedBy(classOf[PartnerServiceImpl])
trait PartnerService {
  def getPartnersForLanding: Future[Seq[PartnerMetadata]]
  def getAdminLists: Future[(Seq[PartnerMetadata], Seq[PartnerMetadata])]
  def getLogoForServing(partnerId: Int): Future[Option[(Array[Byte], String, OffsetDateTime)]]
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
 */
@Singleton
class PartnerServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    configService: ConfigService,
    partnerTable: PartnerTable,
    cpuEc: CpuIntensiveExecutionContext,
    implicit val ec: ExecutionContext
) extends PartnerService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import PartnerServiceImpl._

  val logoUploadMaxBytes: Long = config.get[Long]("partners.logo-upload-max-bytes")

  def getPartnersForLanding: Future[Seq[PartnerMetadata]] =
    db.run(partnerTable.getForLanding(configService.getCityId))

  def getAdminLists: Future[(Seq[PartnerMetadata], Seq[PartnerMetadata])] = {
    for {
      city   <- db.run(partnerTable.getByScope(Some(configService.getCityId)))
      global <- db.run(partnerTable.getByScope(None))
    } yield (city, global)
  }

  def getLogoForServing(partnerId: Int): Future[Option[(Array[Byte], String, OffsetDateTime)]] =
    db.run(partnerTable.getLogo(partnerId))

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
                ).map(Right(_))
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
                ).map(_ => Right(()))
            }
        }
    }
  }

  def deletePartner(partnerId: Int, allowedScopes: Set[Option[String]]): Future[Either[PartnerRejection, Unit]] = {
    inAllowedScope(partnerId, allowedScopes).flatMap {
      case Left(rejection) => Future.successful(Left(rejection))
      case Right(_)        => db.run(partnerTable.delete(partnerId)).map(_ => Right(()))
    }
  }

  def reorderPartners(cityId: Option[String], orderedIds: Seq[Int]): Future[Either[PartnerRejection, Unit]] = {
    db.run(partnerTable.getByScope(cityId)).flatMap { current =>
      // The submitted list must be a permutation of exactly the scope's current ids — nothing missing, nothing
      // foreign — so a reorder can never move a row between scopes or drop one.
      if (orderedIds.sorted != current.map(_.partnerId).sorted) {
        Future.successful(Left(PartnerRejection.BadOrder))
      } else {
        db.run(partnerTable.setDisplayOrders(orderedIds)).map(_ => Right(()))
      }
    }
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
      sniffFormat(upload.tempFile) match {
        case None         => Left(PartnerRejection.LogoInvalid)
        case Some(format) =>
          Option(ImageIO.read(upload.tempFile)) match {
            case None      => Left(PartnerRejection.LogoInvalid)
            case Some(src) =>
              Try {
                val scaled        = ImageUtils.scaleToMaxEdgePreservingAlpha(src, MAX_OUTPUT_EDGE)
                val (bytes, mime) =
                  if (format == "png") (ImageUtils.writePngBytes(scaled), "image/png")
                  else (ImageUtils.writeJpegBytes(scaled, JPEG_QUALITY), "image/jpeg")
                (bytes, mime, scaled.getWidth, scaled.getHeight)
              }.toEither.left
                .map(_ => PartnerRejection.LogoInvalid: PartnerRejection)
                // At <= 800px even a lossless PNG stays far under the cap, but the DB CHECK is the invariant, so
                // enforce it here rather than letting the insert blow up.
                .filterOrElse(_._1.length <= MAX_LOGO_BYTES, PartnerRejection.LogoTooLarge)
          }
      }
    }
  }(cpuEc)

  /**
   * Probes the image header without decoding pixel data, mirroring StoryService's guard: the SNIFFED format must be
   * PNG/JPEG and the declared dimensions sane (decompression-bomb guard).
   *
   * @return The sniffed format ("png" or "jpeg"), or None when unacceptable.
   */
  private def sniffFormat(file: File): Option[String] = {
    Try {
      val stream = new FileImageInputStream(file)
      try {
        ImageIO.getImageReaders(stream).asScala.nextOption().flatMap { reader =>
          try {
            reader.setInput(stream)
            val width  = reader.getWidth(0)
            val height = reader.getHeight(0)
            val format = reader.getFormatName.toLowerCase
            Option.when(
              ACCEPTED_FORMATS.contains(format) && width <= MAX_SOURCE_DIMENSION && height <= MAX_SOURCE_DIMENSION &&
                width.toLong * height.toLong <= MAX_SOURCE_PIXELS
            )(format)
          } finally reader.dispose()
        }
      } finally stream.close()
    }.toOption.flatten
  }
}

object PartnerServiceImpl {
  // Stored logo bytes may not exceed this; must match the octet_length CHECK in the partner table (evolution 370).
  val MAX_LOGO_BYTES: Int = 1048576

  // Upload formats validated against the SNIFFED format, never the client-declared MIME type. Deliberately narrow —
  // the stock JVM ImageIO has no SVG/WebP reader, and SVG would be a stored-XSS vector served from our origin.
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
}
