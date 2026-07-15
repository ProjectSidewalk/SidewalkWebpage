package formats.json

import models.story._
import play.api.libs.json.{JsObject, Json}

/**
 * JSON writers for the lived-experience story surfaces (#4054). Snake_case keys throughout. Deliberately app-internal:
 * stories are NOT exported through /v3 or dataset dumps (comment-table precedent, not the label.description one), so
 * a contributor's hard-delete retraction can be honored in full. Do not add a models.api DTO for these.
 */
object StoryFormats {

  def mediaToJson(m: StoryMediaForView): JsObject = {
    Json.obj(
      "story_media_id" -> m.storyMediaId,
      "media_type"     -> m.mediaType,
      "mime_type"      -> m.mimeType,
      "url"            -> m.url,
      "width"          -> m.width,
      "height"         -> m.height,
      "alt_text"       -> m.altText
    )
  }

  def storyForViewToJson(s: StoryForView): JsObject = {
    Json.obj(
      "story_id"     -> s.storyId,
      "label_id"     -> s.labelId,
      "text"         -> s.storyText,
      "display_name" -> s.displayName,
      "is_own"       -> s.isOwn,
      "hidden"       -> s.hidden,
      "created_at"   -> s.createdAt,
      "media"        -> s.media.map(mediaToJson)
    )
  }

  def storyForOwnerToJson(s: StoryForOwner): JsObject = {
    Json.obj(
      "story_id"          -> s.story.storyId,
      "label_id"          -> s.story.labelId,
      "label_type"        -> s.labelType,
      "text"              -> s.story.storyText,
      "display_name_mode" -> s.story.displayNameMode,
      "hidden"            -> (s.story.visibility == Story.VisibilityHidden),
      "created_at"        -> s.story.createdAt,
      "media"             -> s.media.map(mediaToJson)
    )
  }

  def storyForAdminToJson(s: StoryForAdmin): JsObject = {
    Json.obj(
      "story_id"          -> s.story.storyId,
      "label_id"          -> s.story.labelId,
      "label_type"        -> s.labelType,
      "user_id"           -> s.story.userId,
      "username"          -> s.username,
      "text"              -> s.story.storyText,
      "display_name_mode" -> s.story.displayNameMode,
      "visibility"        -> s.story.visibility,
      "moderated_by"      -> s.story.moderatedBy,
      "moderated_at"      -> s.story.moderatedAt,
      "created_at"        -> s.story.createdAt,
      "media"             -> s.media.map(mediaToJson)
    )
  }

  def rejectionToJson(r: StoryRejection): JsObject = {
    Json.obj("error" -> r.messageKey, "message" -> r.defaultMessage)
  }
}
