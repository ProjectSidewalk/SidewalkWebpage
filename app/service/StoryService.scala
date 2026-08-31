package service

import com.drew.imaging.ImageMetadataReader
import com.drew.metadata.exif.{ExifSubIFDDirectory, GpsDirectory}
import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.label.{LabelTypeEnum, LatLng}
import models.story._
import models.utils.MyPostgresProfile.api._
import models.utils.{CommonUtils, ImageUtils, MyPostgresProfile, ProfanityGuard}
import org.postgresql.util.PSQLException
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.{Configuration, Environment, Logger}

import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import java.time.temporal.ChronoUnit
import java.time.{OffsetDateTime, ZoneOffset}
import javax.imageio.ImageIO
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@ImplementedBy(classOf[StoryServiceImpl])
trait StoryService {
  def getStoriesForLabel(labelId: Int, viewerUserId: Option[String], isAdmin: Boolean): Future[Seq[StoryForView]]
  def isLabelAccessProblem(labelId: Int): Future[Option[Boolean]]
  def submitStory(
      labelId: Int,
      userId: String,
      storyText: String,
      displayNameMode: String,
      photo: Option[StoryPhotoUpload]
  ): Future[Either[StoryRejection, StoryForView]]
  def updateOwnStory(
      storyId: Int,
      userId: String,
      storyText: String,
      displayNameMode: String,
      newPhoto: Option[StoryPhotoUpload],
      removePhoto: Boolean,
      altText: Option[String]
  ): Future[Either[StoryRejection, Unit]]
  def adminUpdateStory(
      storyId: Int,
      storyText: String,
      displayNameMode: String,
      newPhoto: Option[StoryPhotoUpload],
      removePhoto: Boolean,
      altText: Option[String]
  ): Future[Either[StoryRejection, Unit]]
  def deleteOwnStory(storyId: Int, userId: String): Future[Boolean]
  def getStoriesForUser(userId: String): Future[Seq[StoryForOwner]]
  def getStoriesForCity(n: Int): Future[Seq[StoryForListing]]
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
    environment: Environment,
    storyTable: models.story.StoryTable,
    labelTable: models.label.LabelTable,
    labelService: LabelService,
    panoDataService: PanoDataService,
    signingService: ImageSigningService,
    cpuEc: CpuIntensiveExecutionContext,
    implicit val ec: ExecutionContext
) extends StoryService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

  val maxTextLength: Int            = config.get[Int]("stories.max-text-length")
  private val maxAltTextLength: Int = config.get[Int]("stories.max-alt-text-length")
  private val maxPerDay: Int        = config.get[Int]("stories.max-per-user-per-day")
  private val photoMaxBytes: Long   = config.get[Long]("stories.photo-max-bytes")
  // Resolved through MediaDirs, the same resolver PersistentMediaDirCheck models the write path with (#4925).
  private val mediaBaseDir: File = MediaDirs.cityDir(config, environment, "story.media.directory")

  // Upload formats the composer's accept attribute advertises, validated against the SNIFFED format (never the
  // client-declared MIME type). Deliberately narrow: the stock JVM ImageIO has no WebP/HEIC reader, so widening this
  // list means adding a decoder dependency (e.g. TwelveMonkeys), not just a new name here.
  private val ACCEPTED_FORMATS = Set("jpeg", "png")
  // Decompression-bomb guard: reject images whose declared dimensions are absurd before fully decoding them.
  private val MAX_SOURCE_DIMENSION = 12000
  // A sane per-edge size can still be a decompression bomb: a 12000x12000 flat-color PNG is ~100 KB on the wire but
  // decodes to a ~576 MB raster. Cap total decoded pixels too, so a handful of concurrent uploads can't exhaust the
  // shared JVM heap regardless of how small the compressed bytes are (#4054 hardening).
  private val MAX_SOURCE_PIXELS: Long = 40000000L
  // Longest edge of the re-encoded photo; large enough for the enlarge view, small enough to serve cheaply.
  private val MAX_OUTPUT_EDGE = 2560
  private val JPEG_QUALITY    = 0.85f
  // Upload GPS within this many meters of the label counts as "near" — consumer GPS is ±5-50m in urban canyons, so
  // this only corroborates rough co-location, never adjudicates position (#4054).
  private val NEAR_LABEL_METERS = 250.0
  // Lived-experience stories are personal accounts that essentially never legitimately contain URLs, so any link reads
  // as spam (#4054 anti-abuse). Matches an explicit scheme, a `www.` host, or a bare domain on a common/abused TLD.
  private val LinkPattern =
    ("(?i)(https?://|www\\.|\\b[a-z0-9-]+\\.(com|net|org|io|co|ru|cn|xyz|top|info|biz|link|click|shop|online|site|" +
      "store)\\b)").r

  /**
   * Metadata read from an upload's EXIF: the coarse recency/near-label signals that drive the card, plus the raw
   * capture time and GPS (when present). The raw values are persisted for internal analysis only — never surfaced.
   */
  private case class PhotoMetadata(
      captureRecency: Option[String],
      nearLabel: Option[Boolean],
      capturedAt: Option[OffsetDateTime],
      lat: Option[Double],
      lng: Option[Double]
  )

  /** The re-encoded photo staged in a temp file, plus the metadata (`PhotoMetadata`) carried into the media row. */
  private case class ProcessedPhoto(
      staged: File,
      width: Int,
      height: Int,
      sizeBytes: Long,
      meta: PhotoMetadata
  )

  def storyMediaFile(storyMediaId: Int): File = new File(mediaBaseDir, s"story_$storyMediaId.jpg")

  def getStoriesForLabel(labelId: Int, viewerUserId: Option[String], isAdmin: Boolean): Future[Seq[StoryForView]] = {
    db.run(storyTable.getForLabel(labelId, viewerUserId, isAdmin))
      .map(_.map { case (story, media, username) =>
        toStoryForView(story, media, username, viewerUserId)
      })
  }

  /**
   * Whether the label marks an accessibility problem (vs a positive feature like a curb ramp), from
   * LabelTypeEnum.isAccessProblem — the card's story prompts flip phrasing on this. None when the label doesn't exist.
   */
  def isLabelAccessProblem(labelId: Int): Future[Option[Boolean]] = {
    db.run(storyTable.labelTypeIdForLabel(labelId))
      .map(_.flatMap(typeId => LabelTypeEnum.byId.get(typeId).map(_.isAccessProblem)))
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
    contentRejection(text, displayNameMode, photo.flatMap(_.altText)) match {
      case Some(rejection) => Future.successful(Left(rejection))
      case None            =>
        val since  = OffsetDateTime.now(ZoneOffset.UTC).minusHours(24)
        val checks = for {
          labelOk   <- storyTable.labelExists(labelId)
          duplicate <- storyTable.userHasStoryOnLabel(labelId, userId)
          recent    <- storyTable.countByUserSince(userId, since)
          // Only when the cap is already hit: the timestamp whose 24h expiry frees the next slot, so the rejection
          // can carry how long that is instead of the composer guessing.
          freesAt <-
            if (recent >= maxPerDay) storyTable.nthNewestInWindowAt(userId, since, maxPerDay)
            else DBIO.successful(None)
        } yield {
          if (!labelOk) Some(StoryRejection.LabelNotFound)
          else if (duplicate) Some(StoryRejection.AlreadyExists)
          else if (recent >= maxPerDay)
            Some(
              StoryRejection.RateLimited(
                StoryServiceImpl.secondsUntilFree(freesAt, OffsetDateTime.now(ZoneOffset.UTC))
              )
            )
          else None
        }
        db.run(checks).flatMap {
          case Some(rejection) => Future.successful(Left(rejection))
          case None            =>
            photo match {
              case None         => insertStory(labelId, userId, text, displayNameMode, None)
              case Some(upload) =>
                labelService.getLabelLatLng(labelId).flatMap { labelLatLng =>
                  Future(processPhoto(upload, labelLatLng))(cpuEc).flatMap {
                    case Left(rejection) => Future.successful(Left(rejection))
                    case Right(p)        =>
                      // Whatever happens downstream (duplicate-race Left, DB error, failed move), the staged file was
                      // either moved into place or must not outlive the request — one cleanup for every path.
                      insertStory(labelId, userId, text, displayNameMode, Some((upload, p))).andThen { case _ =>
                        val _ = Try(Files.deleteIfExists(p.staged.toPath))
                      }
                  }
                }
            }
        }
    }
  }

  /**
   * Edits the author's own story in place (#4054). Same text validation as submission, but no daily-rate-limit
   * charge and no duplicate check — an edit isn't a new story. Visibility/moderation state is preserved: a
   * moderator-hidden story stays hidden through an edit. Photo semantics: `newPhoto` replaces the existing photo
   * (taking precedence over `removePhoto`), `removePhoto` drops it, and otherwise the photo is kept with its
   * alt text set to `altText` (None clears it).
   */
  def updateOwnStory(
      storyId: Int,
      userId: String,
      storyText: String,
      displayNameMode: String,
      newPhoto: Option[StoryPhotoUpload],
      removePhoto: Boolean,
      altText: Option[String]
  ): Future[Either[StoryRejection, Unit]] =
    updateStory(storyTable.getOwned(storyId, userId), storyText, displayNameMode, newPhoto, removePhoto, altText)

  /** An admin editing any user's story (content moderation from the user's admin dashboard); no ownership gate. */
  def adminUpdateStory(
      storyId: Int,
      storyText: String,
      displayNameMode: String,
      newPhoto: Option[StoryPhotoUpload],
      removePhoto: Boolean,
      altText: Option[String]
  ): Future[Either[StoryRejection, Unit]] =
    updateStory(storyTable.getById(storyId), storyText, displayNameMode, newPhoto, removePhoto, altText)

  /**
   * The shared edit path: `lookup` decides who may reach the story (owner-only or any admin); the content rules and
   * photo semantics are the same either way.
   */
  private def updateStory(
      lookup: DBIO[Option[Story]],
      storyText: String,
      displayNameMode: String,
      newPhoto: Option[StoryPhotoUpload],
      removePhoto: Boolean,
      altText: Option[String]
  ): Future[Either[StoryRejection, Unit]] = {
    val text = storyText.trim
    // The alt text is validated whether it rides a replacement photo (newPhoto) or re-applies to the kept one; the
    // controller derives both from the same form field, so `altText` carries it in every case except a bare removal.
    contentRejection(text, displayNameMode, if (removePhoto) None else altText) match {
      case Some(rejection) => Future.successful(Left(rejection))
      case None            =>
        db.run(lookup).flatMap {
          case None        => Future.successful(Left(StoryRejection.StoryNotFound))
          case Some(story) =>
            val storyId = story.storyId
            val userId  = story.userId
            newPhoto match {
              case Some(upload) =>
                labelService.getLabelLatLng(story.labelId).flatMap { labelLatLng =>
                  Future(processPhoto(upload, labelLatLng))(cpuEc).flatMap {
                    case Left(rejection) => Future.successful(Left(rejection))
                    case Right(p)        =>
                      replaceStoryPhoto(story, text, displayNameMode, upload, p).andThen { case _ =>
                        val _ = Try(Files.deleteIfExists(p.staged.toPath))
                      }
                  }
                }
              case None =>
                val action = (for {
                  oldMedia <- storyTable.getMediaForStory(storyId)
                  _        <- storyTable.updateOwnedContent(storyId, userId, text, displayNameMode)
                  _        <-
                    if (removePhoto) storyTable.deleteMediaForStory(storyId)
                    else if (oldMedia.nonEmpty) storyTable.updateMediaAltText(storyId, altText)
                    else DBIO.successful(0)
                } yield oldMedia).transactionally
                db.run(action).map { oldMedia =>
                  if (removePhoto) oldMedia.foreach(m => deleteMediaFile(m.storyMediaId))
                  Right(())
                }
            }
        }
    }
  }

  /**
   * Swaps the story's photo for an already-processed replacement and updates the text. Place-before-destroy: the new
   * media row is inserted (to mint its id-derived path) and the file moved into place *before* the text edit and the
   * old row are committed, so any failure — a failed move or a failed commit — compensates back to a true no-op: the
   * old photo, its bytes, and the pre-edit text are all left untouched rather than a story stripped of its photo.
   *
   * The tradeoff is a brief window (the duration of the file move) where both the old and new media rows exist; the
   * card would render the story twice for that sub-second span. That is strictly preferable to the alternative's
   * silent data loss, and consistent with insertStory's existing "row exists before its file lands" window.
   */
  private def replaceStoryPhoto(
      story: Story,
      text: String,
      displayNameMode: String,
      upload: StoryPhotoUpload,
      p: ProcessedPhoto
  ): Future[Either[StoryRejection, Unit]] = {
    val now    = OffsetDateTime.now
    val newRow = StoryMedia(0, story.storyId, "photo", "image/jpeg", Some(p.width), Some(p.height), None,
      Some(p.sizeBytes), upload.altText, p.meta.captureRecency, p.meta.nearLabel, p.meta.capturedAt, p.meta.lat,
      p.meta.lng, now)
    db.run(storyTable.getMediaForStory(story.storyId)).flatMap { oldMedia =>
      db.run(storyTable.insertMedia(newRow)).flatMap { newMediaId =>
        val placeThenCommit = for {
          _ <- Future {
            val target = storyMediaFile(newMediaId)
            target.getParentFile.mkdirs()
            Files.move(p.staged.toPath, target.toPath, StandardCopyOption.ATOMIC_MOVE)
            ()
          }(cpuEc)
          _ <- db.run(
            (for {
              _ <- storyTable.updateOwnedContent(story.storyId, story.userId, text, displayNameMode)
              _ <- storyTable.deleteMediaRows(oldMedia.map(_.storyMediaId))
            } yield ()).transactionally
          )
        } yield ()
        placeThenCommit
          .map { _ =>
            oldMedia.foreach(m => deleteMediaFile(m.storyMediaId))
            Right(())
          }
          .recoverWith { case e =>
            logger.error(s"Failed to replace media file for story ${story.storyId}: ${e.getMessage}")
            // Undo the new row and any file we placed; the old photo/bytes/text were never touched.
            db.run(storyTable.deleteMediaRows(Seq(newMediaId))).flatMap { _ =>
              val _ = Try(Files.deleteIfExists(storyMediaFile(newMediaId).toPath))
              Future.failed(e)
            }
          }
      }
    }
  }

  def deleteOwnStory(storyId: Int, userId: String): Future[Boolean] = {
    // One transaction: the media paths must be read before the story delete cascades the media rows away.
    val action = (for {
      media   <- storyTable.getMediaForStory(storyId)
      deleted <- storyTable.deleteOwned(storyId, userId)
    } yield (media, deleted)).transactionally
    db.run(action).map { case (media, deleted) =>
      if (deleted > 0) media.foreach(m => deleteMediaFile(m.storyMediaId))
      deleted > 0
    }
  }

  /**
   * Signed label-preview URLs (saved crop, else provider static image) for the given labels, resolved with one
   * batched pano-metadata query — the same crop-then-GSV strategy as the Gallery and the admin activity feed.
   * Used for photoless stories so every listing row can still carry an image.
   *
   * @param labelTypesById The label type of each label needing a preview, keyed by label id.
   * @return               Preview URL per label id; labels with no saved crop and no usable pano are absent.
   */
  private def labelPreviewUrls(labelTypesById: Map[Int, LabelTypeEnum.Base]): Future[Map[Int, String]] = {
    if (labelTypesById.isEmpty) Future.successful(Map.empty)
    else
      db.run(labelTable.getPanoMetadataForLabels(labelTypesById.keys.toSeq)).map { metas =>
        val metaById = metas.map { case (labelId, panoId, source, heading, pitch, zoom) =>
          labelId -> ((panoId, source, heading, pitch, zoom))
        }.toMap
        labelTypesById.flatMap { case (labelId, labelType) =>
          panoDataService
            .cropUrl(labelId, labelType)
            .orElse(metaById.get(labelId).flatMap { case (panoId, source, heading, pitch, zoom) =>
              panoDataService.getImageUrl(panoId, source, heading, pitch, zoom)
            })
            .map(labelId -> _)
        }
      }
  }

  def getStoriesForUser(userId: String): Future[Seq[StoryForOwner]] = {
    db.run(storyTable.getForUser(userId)).flatMap { rows =>
      // Photoless stories fall back to a label preview so every dashboard row can carry a thumbnail (#4656).
      val photolessTypes = rows.collect { case (story, None, labelTypeId) =>
        story.labelId -> LabelTypeEnum.byId(labelTypeId)
      }.toMap
      labelPreviewUrls(photolessTypes).map { previewById =>
        rows.map { case (story, media, labelTypeId) =>
          val labelType = LabelTypeEnum.byId(labelTypeId)
          StoryForOwner(
            story,
            labelType.name,
            labelType.isAccessProblem,
            media.map(toMediaForView),
            labelImageUrl = if (media.isDefined) None else previewById.get(story.labelId)
          )
        }
      }
    }
  }

  def getStoriesForCity(n: Int): Future[Seq[StoryForListing]] = {
    db.run(storyTable.getVisibleForCity(n)).flatMap { rows =>
      val photolessTypes = rows.collect { case (story, None, _, labelTypeId, _, _, _) =>
        story.labelId -> LabelTypeEnum.byId(labelTypeId)
      }.toMap
      labelPreviewUrls(photolessTypes).map { previewById =>
        rows.map { case (story, media, username, labelTypeId, regionId, regionName, address) =>
          StoryForListing(
            storyId = story.storyId,
            labelId = story.labelId,
            labelType = LabelTypeEnum.byId(labelTypeId),
            regionId = regionId,
            regionName = regionName,
            address = address,
            storyText = story.storyText,
            displayName = if (story.displayNameMode == Story.DisplayNameUsername) Some(username) else None,
            createdAt = story.createdAt,
            media = media.map(toMediaForView),
            labelImageUrl = if (media.isDefined) None else previewById.get(story.labelId)
          )
        }
      }
    }
  }

  def getRecentStories(n: Int): Future[Seq[StoryForAdmin]] = {
    db.run(storyTable.getRecent(n))
      .map(_.map { case (story, media, username, labelTypeId) =>
        StoryForAdmin(story, username, LabelTypeEnum.labelTypeIdToLabelType(labelTypeId), media.map(toMediaForView))
      })
  }

  def setStoryVisibility(storyId: Int, adminUserId: String, hidden: Boolean): Future[Boolean] = {
    db.run(storyTable.setVisibility(storyId, visible = !hidden, adminUserId, OffsetDateTime.now)).map(_ > 0)
  }

  def adminDeleteStory(storyId: Int): Future[Boolean] = {
    // One transaction: the media paths must be read before the story delete cascades the media rows away.
    val action = (for {
      media   <- storyTable.getMediaForStory(storyId)
      deleted <- storyTable.delete(storyId)
    } yield (media, deleted)).transactionally
    db.run(action).map { case (media, deleted) =>
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
      hidden = !story.visible,
      createdAt = story.createdAt,
      media = media.map(toMediaForView)
    )
  }

  private def toMediaForView(m: StoryMedia): StoryMediaForView = {
    StoryMediaForView(
      storyMediaId = m.storyMediaId,
      mediaType = m.mediaType,
      mimeType = m.mimeType,
      // Reverse-routed so the signed path can't drift from what serveStoryMedia verifies.
      url = signingService.signedUrl(controllers.routes.StoryController.serveStoryMedia(m.storyMediaId).url),
      width = m.width,
      height = m.height,
      altText = m.altText
    )
  }

  /**
   * The content-validation checks shared by submission and in-place edit (#4054): display-name mode, story text
   * (presence, length, profanity), and the photo's alt text (length, profanity). Centralizing this is what keeps an
   * edit from bypassing a rule the submit path enforces — the alt text especially, since it renders publicly (card
   * caption, `img alt`, `aria-label`) yet isn't the story body.
   *
   * @param text            The trimmed story text.
   * @param displayNameMode The requested display-name mode.
   * @param altText         The photo's alt text, if a photo is attached; None when there's no photo to describe.
   * @return                The first failing check, or None when the content is acceptable.
   */
  private def contentRejection(
      text: String,
      displayNameMode: String,
      altText: Option[String]
  ): Option[StoryRejection] = {
    if (!Story.validDisplayNameModes.contains(displayNameMode)) Some(StoryRejection.InvalidDisplayNameMode)
    else if (text.isEmpty) Some(StoryRejection.TextMissing)
    else if (text.length > maxTextLength) Some(StoryRejection.TextTooLong(maxTextLength))
    else if (!ProfanityGuard.isClean(text)) Some(StoryRejection.TextRejected)
    else if (containsLink(text)) Some(StoryRejection.LinksNotAllowed)
    else
      altText match {
        case Some(alt) if alt.length > maxAltTextLength => Some(StoryRejection.AltTextTooLong(maxAltTextLength))
        case Some(alt) if !ProfanityGuard.isClean(alt)  => Some(StoryRejection.AltTextRejected)
        case Some(alt) if containsLink(alt)             => Some(StoryRejection.LinksNotAllowed)
        case _                                          => None
      }
  }

  /** Whether the text contains something that looks like a URL/link — treated as spam in a personal story (#4054). */
  private def containsLink(s: String): Boolean = LinkPattern.findFirstIn(s).isDefined

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
    val story = Story(0, labelId, userId, text, displayNameMode, visible = true, None, None, now)

    val insertAction = (for {
      storyId <- storyTable.insert(story)
      media   <- photo match {
        case Some((upload, p)) =>
          val m = StoryMedia(0, storyId, "photo", "image/jpeg", Some(p.width), Some(p.height), None, Some(p.sizeBytes),
            upload.altText, p.meta.captureRecency, p.meta.nearLabel, p.meta.capturedAt, p.meta.lat, p.meta.lng, now)
          storyTable.insertMedia(m).map(mediaId => Some(m.copy(storyMediaId = mediaId)))
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
              // Same filesystem by construction (staged under mediaBaseDir), so the rename is truly atomic — a
              // concurrent reader sees the complete file or nothing.
              Files.move(p.staged.toPath, target.toPath, StandardCopyOption.ATOMIC_MOVE)
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
   * Validates and re-encodes an uploaded photo. Runs on the cpu-intensive EC (caller's responsibility). Metadata is
   * read from the ORIGINAL bytes (re-encoding strips EXIF from the served image, which is also why we re-encode); the
   * capture time and GPS are carried into the media row for internal use, never onto the delivered file or any output.
   */
  private def processPhoto(
      upload: StoryPhotoUpload,
      labelLatLng: Option[LatLng]
  ): Either[StoryRejection, ProcessedPhoto] = {
    if (upload.tempFile.length > photoMaxBytes) {
      Left(StoryRejection.PhotoTooLarge)
    } else if (!sourceImageOk(upload.tempFile)) {
      Left(StoryRejection.PhotoInvalid)
    } else {
      val meta = extractPhotoMetadata(upload.tempFile, labelLatLng)
      // The decode sits inside a Try: ImageIO.read can throw (not just return null) on a file whose header sniffs
      // fine but whose pixel data it can't decode — e.g. a CMYK JPEG or a truncated PNG.
      Try(Option(ImageIO.read(upload.tempFile))).toOption.flatten match {
        case None      => Left(StoryRejection.PhotoInvalid)
        case Some(src) =>
          try {
            val out    = ImageUtils.scaleToMaxEdge(src, MAX_OUTPUT_EDGE)
            val staged = stageJpeg(out)
            Right(ProcessedPhoto(staged, out.getWidth, out.getHeight, staged.length, meta))
          } catch {
            case e: Exception =>
              logger.error(s"Failed to re-encode story photo: ${e.getMessage}")
              Left(StoryRejection.PhotoInvalid)
          }
      }
    }
  }

  /**
   * Writes the re-encoded photo to a temp file in the staging dir, deleting it again if the write dies midway.
   * Staging lives inside the media tree (not java.io.tmpdir) so the post-commit placement is a same-filesystem
   * atomic rename; a crash can only leave junk under staging/, never a half-written serving file.
   */
  private def stageJpeg(img: BufferedImage): File = {
    val stagingDir = new File(mediaBaseDir, "staging")
    stagingDir.mkdirs()
    val staged = File.createTempFile("story_staged_", ".jpg", stagingDir)
    try {
      ImageUtils.writeJpeg(img, staged, JPEG_QUALITY)
      staged
    } catch {
      case e: Exception =>
        val _ = Try(Files.deleteIfExists(staged.toPath))
        throw e
    }
  }

  /** See [[ImageUtils.sniffAcceptedFormat]] — accepted formats and decompression-bomb caps applied to a photo. */
  private def sourceImageOk(file: File): Boolean =
    ImageUtils.sniffAcceptedFormat(file, ACCEPTED_FORMATS, MAX_SOURCE_DIMENSION, MAX_SOURCE_PIXELS).isDefined

  /**
   * Reads the EXIF metadata we keep from an upload: the coarse recency bucket + near-label flag that drive the card,
   * plus the raw capture time and GPS (when present) that we persist for internal analysis but never surface. Absent
   * or corrupt metadata is normal, and degrades every field to None.
   */
  private def extractPhotoMetadata(file: File, labelLatLng: Option[LatLng]): PhotoMetadata = {
    Try {
      val metadata = ImageMetadataReader.readMetadata(file)
      val geo      = Option(metadata.getFirstDirectoryOfType(classOf[GpsDirectory]))
        .flatMap(d => Option(d.getGeoLocation))
        .filterNot(_.isZero) // (0,0) is a common "no fix" placeholder, not a real location.
      val captureDate = Option(metadata.getFirstDirectoryOfType(classOf[ExifSubIFDDirectory]))
        .flatMap(d => Option(d.getDateOriginal))

      // EXIF DateTimeOriginal carries no zone; store the instant read as UTC (good enough for coarse analysis).
      val capturedAt = captureDate.map(_.toInstant.atOffset(ZoneOffset.UTC))
      val recency    = capturedAt.map { at =>
        val days = math.max(0L, ChronoUnit.DAYS.between(at.toInstant, OffsetDateTime.now.toInstant))
        if (days <= 7) "within_week"
        else if (days <= 31) "within_month"
        else if (days <= 366) "within_year"
        else "older"
      }
      val near = for {
        g     <- geo
        label <- labelLatLng
      } yield CommonUtils.haversineMeters(g.getLatitude, g.getLongitude, label.lat, label.lng) <= NEAR_LABEL_METERS
      PhotoMetadata(recency, near, capturedAt, geo.map(_.getLatitude), geo.map(_.getLongitude))
    }.getOrElse(PhotoMetadata(None, None, None, None, None))
  }

  /** File deletion failures only leave an orphaned file (never a dangling DB row), so log-and-continue is safe. */
  private def deleteMediaFile(storyMediaId: Int): Unit = {
    Try(Files.deleteIfExists(storyMediaFile(storyMediaId).toPath)).failed.foreach { e =>
      logger.error(s"Failed to delete story media file story_$storyMediaId.jpg: ${e.getMessage}")
    }
  }
}

object StoryServiceImpl {

  /**
   * How long until the story posted at `freesAt` leaves the rolling 24h window, freeing a submission slot.
   *
   * Ceiled to whole seconds — a fractional second rounds *up* — and floored at one, so the value we quote (in the
   * 429 body and on its `Retry-After` header) is never a moment before the slot actually opens: a caller who retries
   * exactly when told must not be refused again. Pure so the sub-second edges are unit-testable.
   *
   * @param freesAt When the oldest story still counting against the cap was posted; None when the cap isn't hit.
   * @param now     The current instant.
   * @return        Seconds to wait, or None when there is no wait to report.
   */
  private[service] def secondsUntilFree(freesAt: Option[OffsetDateTime], now: OffsetDateTime): Option[Long] =
    freesAt.map { posted =>
      val waitMs = ChronoUnit.MILLIS.between(now, posted.plusHours(24))
      math.max(1L, (waitMs + 999) / 1000)
    }
}
