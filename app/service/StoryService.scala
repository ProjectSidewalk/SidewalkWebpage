package service

import com.drew.imaging.ImageMetadataReader
import com.drew.metadata.exif.{ExifSubIFDDirectory, GpsDirectory}
import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.label.{LabelTypeEnum, LatLng}
import models.story._
import models.utils.MyPostgresProfile.api._
import models.utils.{MyPostgresProfile, ProfanityGuard}
import org.postgresql.util.PSQLException
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.{Configuration, Logger}

import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import java.time.temporal.ChronoUnit
import java.time.{OffsetDateTime, ZoneOffset}
import javax.imageio.stream.FileImageInputStream
import javax.imageio.{IIOImage, ImageIO, ImageWriteParam}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Try

@ImplementedBy(classOf[StoryServiceImpl])
trait StoryService {
  def getStoriesForLabel(labelId: Int, viewerUserId: Option[String], isAdmin: Boolean): Future[Seq[StoryForView]]
  def submitStory(
      labelId: Int,
      userId: String,
      storyText: String,
      displayNameMode: String,
      photo: Option[StoryPhotoUpload]
  ): Future[Either[StoryRejection, StoryForView]]
  def deleteOwnStory(storyId: Int, userId: String): Future[Boolean]
  def getStoriesForUser(userId: String): Future[Seq[StoryForOwner]]
  def getRecentStories(n: Int): Future[Seq[StoryForAdmin]]
  def setStoryVisibility(storyId: Int, adminUserId: String, hidden: Boolean): Future[Boolean]
  def adminDeleteStory(storyId: Int): Future[Boolean]
  def getMediaForServing(storyMediaId: Int): Future[Option[(StoryMedia, Story)]]
  def storyMediaFile(storyMediaId: Int): File
  def maxTextLength: Int
}

/**
 * Business logic for lived-experience stories (#4054): submission (validation, rate limiting, the photo ingest
 * pipeline), viewer-shaped reads, the author's hard-delete retraction, and admin moderation.
 */
@Singleton
class StoryServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    storyTable: models.story.StoryTable,
    labelService: LabelService,
    signingService: ImageSigningService,
    cpuEc: CpuIntensiveExecutionContext,
    implicit val ec: ExecutionContext
) extends StoryService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

  val maxTextLength: Int           = config.get[Int]("stories.max-text-length")
  private val maxPerDay: Int       = config.get[Int]("stories.max-per-user-per-day")
  private val photoMaxBytes: Long  = config.get[Long]("stories.photo-max-bytes")
  private val mediaBaseDir: String =
    config.get[String]("story.media.directory") + File.separator + config.get[String]("city-id")

  // Decompression-bomb guard: reject images whose declared dimensions are absurd before fully decoding them.
  private val MAX_SOURCE_DIMENSION = 12000
  // Longest edge of the re-encoded photo; large enough for the enlarge view, small enough to serve cheaply.
  private val MAX_OUTPUT_EDGE = 2560
  private val JPEG_QUALITY    = 0.85f
  // Upload GPS within this many meters of the label counts as "near" — consumer GPS is ±5-50m in urban canyons, so
  // this only corroborates rough co-location, never adjudicates position (#4054).
  private val NEAR_LABEL_METERS = 250.0

  /** The re-encoded photo staged in a temp file, plus the derived (metadata-free) facts we keep. */
  private case class ProcessedPhoto(
      staged: File,
      width: Int,
      height: Int,
      sizeBytes: Long,
      captureRecency: Option[String],
      nearLabel: Option[Boolean]
  )

  def storyMediaFile(storyMediaId: Int): File = new File(mediaBaseDir, s"story_$storyMediaId.jpg")

  def getStoriesForLabel(labelId: Int, viewerUserId: Option[String], isAdmin: Boolean): Future[Seq[StoryForView]] = {
    db.run(storyTable.getForLabel(labelId, viewerUserId, isAdmin))
      .map(_.map { case (story, media, username) =>
        toStoryForView(story, media, username, viewerUserId)
      })
  }

  def submitStory(
      labelId: Int,
      userId: String,
      storyText: String,
      displayNameMode: String,
      photo: Option[StoryPhotoUpload]
  ): Future[Either[StoryRejection, StoryForView]] = {
    val text = storyText.trim
    // firstError sequence: cheap syntactic checks, then DB checks, then the expensive photo pipeline last so
    // rate-limited or duplicate submissions never cost a decode.
    if (!Story.validDisplayNameModes.contains(displayNameMode)) {
      Future.successful(Left(StoryRejection.InvalidDisplayNameMode))
    } else if (text.isEmpty) {
      Future.successful(Left(StoryRejection.TextMissing))
    } else if (text.length > maxTextLength) {
      Future.successful(Left(StoryRejection.TextTooLong(maxTextLength)))
    } else if (!ProfanityGuard.isClean(text)) {
      Future.successful(Left(StoryRejection.TextRejected))
    } else {
      val since = OffsetDateTime.now(ZoneOffset.UTC).minusHours(24)
      (for {
        labelOk   <- db.run(storyTable.labelExists(labelId))
        duplicate <- db.run(storyTable.userHasStoryOnLabel(labelId, userId))
        recent    <- db.run(storyTable.countByUserSince(userId, since))
      } yield {
        if (!labelOk) Some(StoryRejection.LabelNotFound)
        else if (duplicate) Some(StoryRejection.AlreadyExists)
        else if (recent >= maxPerDay) Some(StoryRejection.RateLimited)
        else None
      }).flatMap {
        case Some(rejection) => Future.successful(Left(rejection))
        case None            =>
          photo match {
            case None         => insertStory(labelId, userId, text, displayNameMode, None)
            case Some(upload) =>
              labelService.getLabelLatLng(labelId).flatMap { labelLatLng =>
                Future(processPhoto(upload, labelLatLng))(cpuEc).flatMap {
                  case Left(rejection) => Future.successful(Left(rejection))
                  case Right(p)        => insertStory(labelId, userId, text, displayNameMode, Some((upload, p)))
                }
              }
          }
      }
    }
  }

  def deleteOwnStory(storyId: Int, userId: String): Future[Boolean] = {
    for {
      media   <- db.run(storyTable.getMediaForStory(storyId))
      deleted <- db.run(storyTable.deleteOwned(storyId, userId))
    } yield {
      if (deleted > 0) media.foreach(m => deleteMediaFile(m.storyMediaId))
      deleted > 0
    }
  }

  def getStoriesForUser(userId: String): Future[Seq[StoryForOwner]] = {
    db.run(storyTable.getForUser(userId))
      .map(_.map { case (story, media, labelTypeId) =>
        StoryForOwner(story, LabelTypeEnum.labelTypeIdToLabelType(labelTypeId), media.map(toMediaForView))
      })
  }

  def getRecentStories(n: Int): Future[Seq[StoryForAdmin]] = {
    db.run(storyTable.getRecent(n))
      .map(_.map { case (story, media, username, labelTypeId) =>
        StoryForAdmin(story, username, LabelTypeEnum.labelTypeIdToLabelType(labelTypeId), media.map(toMediaForView))
      })
  }

  def setStoryVisibility(storyId: Int, adminUserId: String, hidden: Boolean): Future[Boolean] = {
    val visibility = if (hidden) Story.VisibilityHidden else Story.VisibilityVisible
    db.run(storyTable.setVisibility(storyId, visibility, adminUserId, OffsetDateTime.now)).map(_ > 0)
  }

  def adminDeleteStory(storyId: Int): Future[Boolean] = {
    for {
      media   <- db.run(storyTable.getMediaForStory(storyId))
      deleted <- db.run(storyTable.delete(storyId))
    } yield {
      if (deleted > 0) media.foreach(m => deleteMediaFile(m.storyMediaId))
      deleted > 0
    }
  }

  def getMediaForServing(storyMediaId: Int): Future[Option[(StoryMedia, Story)]] = {
    db.run(storyTable.getMediaWithStory(storyMediaId))
  }

  private def toStoryForView(
      story: Story,
      media: Option[StoryMedia],
      username: String,
      viewerUserId: Option[String]
  ): StoryForView = {
    val displayName = if (story.displayNameMode == Story.DisplayNameUsername) Some(username) else None
    StoryForView(
      storyId = story.storyId,
      labelId = story.labelId,
      storyText = story.storyText,
      displayName = displayName,
      isOwn = viewerUserId.contains(story.userId),
      hidden = story.visibility == Story.VisibilityHidden,
      createdAt = story.createdAt,
      media = media.map(toMediaForView)
    )
  }

  private def toMediaForView(m: StoryMedia): StoryMediaForView = {
    StoryMediaForView(
      storyMediaId = m.storyMediaId,
      mediaType = m.mediaType,
      mimeType = m.mimeType,
      url = signingService.signedUrl(s"/storyMedia/${m.storyMediaId}"),
      width = m.width,
      height = m.height,
      altText = m.altText
    )
  }

  /**
   * Inserts the story (and media row) transactionally, then moves the staged photo into its id-derived location.
   * A failed file move rolls the rows back (compensating delete) so a story never references missing bytes.
   */
  private def insertStory(
      labelId: Int,
      userId: String,
      text: String,
      displayNameMode: String,
      photo: Option[(StoryPhotoUpload, ProcessedPhoto)]
  ): Future[Either[StoryRejection, StoryForView]] = {
    val now   = OffsetDateTime.now
    val story = Story(0, labelId, userId, text, displayNameMode, Story.VisibilityVisible, None, None, now)

    val insertAction = (for {
      storyId <- storyTable.insert(story)
      media   <- photo match {
        case Some((upload, p)) =>
          storyTable
            .insertMedia(
              StoryMedia(0, storyId, "photo", "image/jpeg", Some(p.width), Some(p.height), None, Some(p.sizeBytes),
                upload.altText, p.captureRecency, p.nearLabel, now)
            )
            .map(mediaId =>
              Some(
                StoryMedia(mediaId, storyId, "photo", "image/jpeg", Some(p.width), Some(p.height), None,
                  Some(p.sizeBytes), upload.altText, p.captureRecency, p.nearLabel, now)
              )
            )
        case None => DBIO.successful(None: Option[StoryMedia])
      }
    } yield (storyId, media)).transactionally

    db.run(insertAction)
      .flatMap { case (storyId, media) =>
        val placeFile: Future[Unit] = (photo, media) match {
          case (Some((_, p)), Some(m)) =>
            Future {
              val target = storyMediaFile(m.storyMediaId)
              target.getParentFile.mkdirs()
              Files.move(p.staged.toPath, target.toPath, StandardCopyOption.REPLACE_EXISTING)
              ()
            }(cpuEc).recoverWith { case e =>
              logger.error(s"Failed to place story media file for story $storyId: ${e.getMessage}")
              db.run(storyTable.delete(storyId)).flatMap(_ => Future.failed(e))
            }
          case _ => Future.successful(())
        }
        placeFile.map { _ =>
          val view = StoryForView(storyId, labelId, text, displayName = None, // The composer response never needs the resolved name; the client refetches the list.
            isOwn = true, hidden = false, createdAt = now, media = media.map(toMediaForView))
          Right(view)
        }
      }
      .recover {
        // The UNIQUE(label_id, user_id) constraint backs the pre-check against a concurrent double-submit.
        case e: PSQLException if e.getSQLState == "23505" => Left(StoryRejection.AlreadyExists)
      }
  }

  /**
   * Validates and re-encodes an uploaded photo. Runs on the cpu-intensive EC (caller's responsibility). The transient
   * metadata pass happens on the ORIGINAL bytes (re-encoding strips EXIF, which is also why we re-encode); only the
   * derived recency bucket and near-label flag survive it — precise GPS/timestamps are discarded per #4054.
   */
  private def processPhoto(
      upload: StoryPhotoUpload,
      labelLatLng: Option[LatLng]
  ): Either[StoryRejection, ProcessedPhoto] = {
    if (upload.tempFile.length > photoMaxBytes) {
      Left(StoryRejection.PhotoTooLarge)
    } else if (!declaredDimensionsOk(upload.tempFile)) {
      Left(StoryRejection.PhotoInvalid)
    } else {
      val (captureRecency, nearLabel) = extractTransientMetadata(upload.tempFile, labelLatLng)
      Option(ImageIO.read(upload.tempFile)) match {
        case None      => Left(StoryRejection.PhotoInvalid)
        case Some(src) =>
          try {
            val out    = reencodeJpeg(src)
            val staged = File.createTempFile("story_staged_", ".jpg")
            writeJpeg(out, staged)
            Right(ProcessedPhoto(staged, out.getWidth, out.getHeight, staged.length, captureRecency, nearLabel))
          } catch {
            case e: Exception =>
              logger.error(s"Failed to re-encode story photo: ${e.getMessage}")
              Left(StoryRejection.PhotoInvalid)
          }
      }
    }
  }

  /** Reads declared dimensions from the image header without decoding pixel data (decompression-bomb guard). */
  private def declaredDimensionsOk(file: File): Boolean = {
    Try {
      val stream = new FileImageInputStream(file)
      try {
        val readers = ImageIO.getImageReaders(stream).asScala
        readers.nextOption().exists { reader =>
          try {
            reader.setInput(stream)
            reader.getWidth(0) <= MAX_SOURCE_DIMENSION && reader.getHeight(0) <= MAX_SOURCE_DIMENSION
          } finally reader.dispose()
        }
      } finally stream.close()
    }.getOrElse(false)
  }

  /** The extract-use-discard metadata pass: derive the coarse buckets, let the precise values go out of scope. */
  private def extractTransientMetadata(file: File, labelLatLng: Option[LatLng]): (Option[String], Option[Boolean]) = {
    Try {
      val metadata = ImageMetadataReader.readMetadata(file)
      val geo      = Option(metadata.getFirstDirectoryOfType(classOf[GpsDirectory]))
        .flatMap(d => Option(d.getGeoLocation))
        .filterNot(_.isZero) // (0,0) is a common "no fix" placeholder, not a real location.
      val captureDate = Option(metadata.getFirstDirectoryOfType(classOf[ExifSubIFDDirectory]))
        .flatMap(d => Option(d.getDateOriginal))

      val recency = captureDate.map { date =>
        val days = math.max(0L, ChronoUnit.DAYS.between(date.toInstant, OffsetDateTime.now.toInstant))
        if (days <= 7) "within_week"
        else if (days <= 31) "within_month"
        else if (days <= 366) "within_year"
        else "older"
      }
      val near = for {
        g     <- geo
        label <- labelLatLng
      } yield haversineMeters(g.getLatitude, g.getLongitude, label.lat, label.lng) <= NEAR_LABEL_METERS
      (recency, near)
    }.getOrElse((None, None)) // Absent or corrupt metadata is normal; everything degrades to "unknown".
  }

  /** Scales to the output edge cap and repaints onto RGB (ImageIO's JPEG writer can't handle alpha channels). */
  private def reencodeJpeg(src: BufferedImage): BufferedImage = {
    val scale     = math.min(1.0, MAX_OUTPUT_EDGE.toDouble / math.max(src.getWidth, src.getHeight))
    val outWidth  = math.max(1, math.round(src.getWidth * scale).toInt)
    val outHeight = math.max(1, math.round(src.getHeight * scale).toInt)
    val out       = new BufferedImage(outWidth, outHeight, BufferedImage.TYPE_INT_RGB)
    val g2d       = out.createGraphics()
    g2d.drawImage(src.getScaledInstance(outWidth, outHeight, java.awt.Image.SCALE_SMOOTH), 0, 0, null)
    g2d.dispose()
    out
  }

  private def writeJpeg(img: BufferedImage, target: File): Unit = {
    val writer = ImageIO.getImageWritersByFormatName("jpg").next()
    val param  = writer.getDefaultWriteParam
    param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
    param.setCompressionQuality(JPEG_QUALITY)
    val output = ImageIO.createImageOutputStream(target)
    try {
      writer.setOutput(output)
      writer.write(null, new IIOImage(img, null, null), param)
    } finally {
      writer.dispose()
      output.close()
    }
  }

  /** File deletion failures only leave an orphaned file (never a dangling DB row), so log-and-continue is safe. */
  private def deleteMediaFile(storyMediaId: Int): Unit = {
    Try(Files.deleteIfExists(storyMediaFile(storyMediaId).toPath)).failed.foreach { e =>
      logger.error(s"Failed to delete story media file story_$storyMediaId.jpg: ${e.getMessage}")
    }
  }

  private def haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double = {
    val earthRadiusMeters = 6371000.0
    val dLat              = math.toRadians(lat2 - lat1)
    val dLng              = math.toRadians(lng2 - lng1)
    val a                 = math.pow(math.sin(dLat / 2), 2) +
      math.cos(math.toRadians(lat1)) * math.cos(math.toRadians(lat2)) * math.pow(math.sin(dLng / 2), 2)
    2 * earthRadiusMeters * math.asin(math.sqrt(a))
  }
}
