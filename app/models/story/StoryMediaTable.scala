package models.story

import models.utils.MyPostgresProfile.api._
import slick.lifted.{ProvenShape, Tag}

import java.time.OffsetDateTime

/**
 * Media attached to a lived-experience story (#4054). The first increment only writes `photo` rows; `mediaType`,
 * `mimeType`, and `durationSecs` are provisioned for the audio/video increments.
 *
 * @param storyMediaId   Primary key. Also names the file on disk (`story_<storyMediaId>.jpg`), so no path column.
 * @param storyId        The story this media belongs to (DB cascades this row when the story is deleted).
 * @param mediaType      One of `photo`, `audio`, `video`.
 * @param mimeType       The mime type the file is served as (post-transcode, e.g. `image/jpeg`).
 * @param width          Pixel width after re-encoding; None for audio.
 * @param height         Pixel height after re-encoding; None for audio.
 * @param durationSecs   Playback length; None for photos.
 * @param fileSizeBytes  Size of the stored (re-encoded) file.
 * @param altText         Author's description for screen readers; None means they explicitly skipped it.
 * @param captureRecency  Coarse age bucket derived from upload metadata; drives the card's "taken recently" hint.
 * @param nearLabel       Whether upload GPS placed the capture near the label; drives the card's corroboration hint.
 * @param photoCapturedAt Raw EXIF capture time (when present), stored for internal analysis only — never surfaced.
 * @param photoLat        Raw EXIF latitude (when present), stored for internal analysis only — never surfaced.
 * @param photoLng        Raw EXIF longitude (when present), stored for internal analysis only — never surfaced.
 * @param createdAt       When the media was ingested.
 */
case class StoryMedia(
    storyMediaId: Int,
    storyId: Int,
    mediaType: String,
    mimeType: String,
    width: Option[Int],
    height: Option[Int],
    durationSecs: Option[Double],
    fileSizeBytes: Option[Long],
    altText: Option[String],
    captureRecency: Option[String],
    nearLabel: Option[Boolean],
    photoCapturedAt: Option[OffsetDateTime],
    photoLat: Option[Double],
    photoLng: Option[Double],
    createdAt: OffsetDateTime
)

class StoryMediaTableDef(tag: Tag) extends Table[StoryMedia](tag, "story_media") {
  def storyMediaId: Rep[Int]                       = column[Int]("story_media_id", O.PrimaryKey, O.AutoInc)
  def storyId: Rep[Int]                            = column[Int]("story_id")
  def mediaType: Rep[String]                       = column[String]("media_type")
  def mimeType: Rep[String]                        = column[String]("mime_type")
  def width: Rep[Option[Int]]                      = column[Option[Int]]("width")
  def height: Rep[Option[Int]]                     = column[Option[Int]]("height")
  def durationSecs: Rep[Option[Double]]            = column[Option[Double]]("duration_secs")
  def fileSizeBytes: Rep[Option[Long]]             = column[Option[Long]]("file_size_bytes")
  def altText: Rep[Option[String]]                 = column[Option[String]]("alt_text")
  def captureRecency: Rep[Option[String]]          = column[Option[String]]("capture_recency")
  def nearLabel: Rep[Option[Boolean]]              = column[Option[Boolean]]("near_label")
  def photoCapturedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("photo_captured_at")
  def photoLat: Rep[Option[Double]]                = column[Option[Double]]("photo_lat")
  def photoLng: Rep[Option[Double]]                = column[Option[Double]]("photo_lng")
  def createdAt: Rep[OffsetDateTime]               = column[OffsetDateTime]("created_at")

  def * : ProvenShape[StoryMedia] =
    (storyMediaId, storyId, mediaType, mimeType, width, height, durationSecs, fileSizeBytes, altText, captureRecency,
      nearLabel, photoCapturedAt, photoLat, photoLng, createdAt) <> ((StoryMedia.apply _).tupled, StoryMedia.unapply)

  def story = foreignKey("story_media_story_id_fkey", storyId, TableQuery[StoryTableDef])(
    _.storyId,
    onDelete = ForeignKeyAction.Cascade
  )
}
