package models.story

import java.io.File
import java.time.OffsetDateTime

/**
 * A story's media as rendered to a viewer: everything the card needs plus a freshly-signed, time-limited serving URL.
 */
case class StoryMediaForView(
    storyMediaId: Int,
    mediaType: String,
    mimeType: String,
    url: String,
    width: Option[Int],
    height: Option[Int],
    altText: Option[String]
)

/**
 * A story as rendered to a viewer on the label-detail card. `displayName` is already resolved against the story's
 * display-name mode (None = show as anonymous); `isOwn`/`hidden` drive the author's delete button and the
 * "hidden by moderators" chip.
 */
case class StoryForView(
    storyId: Int,
    labelId: Int,
    storyText: String,
    displayName: Option[String],
    isOwn: Boolean,
    hidden: Boolean,
    createdAt: OffsetDateTime,
    media: Option[StoryMediaForView]
)

/**
 * A story as rendered on the admin moderation queue: always carries the account username and full moderation state,
 * regardless of the public display-name mode.
 */
case class StoryForAdmin(
    story: Story,
    username: String,
    labelType: String,
    media: Option[StoryMediaForView]
)

/** A story on the author's own dashboard management list (hidden ones included, so they can still retract). */
case class StoryForOwner(
    story: Story,
    labelType: String,
    media: Option[StoryMediaForView]
)

/**
 * An uploaded photo as it arrives from the multipart request, before validation/re-encoding. No declared MIME type:
 * the ingest pipeline trusts only the sniffed image format, never what the client claims.
 */
case class StoryPhotoUpload(tempFile: File, altText: Option[String])

/**
 * Why a story submission was refused. `messageKey` is a client-side i18n key (labelmap namespace) so the composer can
 * localize; `defaultMessage` is the English fallback served alongside it.
 */
sealed abstract class StoryRejection(val messageKey: String, val defaultMessage: String)

object StoryRejection {
  case object LabelNotFound
      extends StoryRejection("story.error.label-not-found", "That label doesn't exist or has been removed.")
  case object TextMissing extends StoryRejection("story.error.text-missing", "Your story text can't be empty.")
  case class TextTooLong(maxLength: Int)
      extends StoryRejection("story.error.text-too-long", s"Stories are limited to $maxLength characters.")
  case object TextRejected
      extends StoryRejection("story.error.text-rejected", "Your story contains language we can't publish.")
  case object InvalidDisplayNameMode
      extends StoryRejection("story.error.invalid-display-name", "Invalid display-name option.")
  case object AlreadyExists
      extends StoryRejection("story.error.already-exists", "You've already shared a story on this label.")
  case object RateLimited
      extends StoryRejection("story.error.rate-limited", "You've shared several stories recently — try again tomorrow.")
  case object PhotoTooLarge extends StoryRejection("story.error.photo-too-large", "That photo is too large to upload.")
  case object PhotoInvalid
      extends StoryRejection("story.error.photo-invalid", "We couldn't read that file as an image (JPEG or PNG).")
}
