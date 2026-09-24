package formats.json

import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads}

import java.time.OffsetDateTime

object GalleryFormats {
  case class GalleryEnvironmentSubmission(
      browser: Option[String],
      browserVersion: Option[String],
      browserWidth: Option[Int],
      browserHeight: Option[Int],
      screenWidth: Option[Int],
      screenHeight: Option[Int],
      availWidth: Option[Int],
      availHeight: Option[Int],
      operatingSystem: Option[String],
      language: String
  )
  case class GalleryInteractionSubmission(
      action: String,
      panoId: Option[String],
      note: Option[String],
      timestamp: OffsetDateTime
  )
  case class GalleryTaskSubmission(
      environment: GalleryEnvironmentSubmission,
      interactions: Seq[GalleryInteractionSubmission]
  )
  case class GalleryLabelsRequest(
      n: Int,
      labelTypes: Option[Seq[String]],
      validationOptions: Option[Seq[String]],
      regionIds: Option[Seq[Int]],
      severities: Option[Seq[String]],
      // Tags narrow the label type they belong to, so they arrive keyed by type name rather than as one flat list.
      tagsByLabelType: Option[Map[String, Seq[String]]],
      aiValidationOptions: Option[Seq[String]],
      loadedLabels: Seq[Int],
      sort: Option[String],
      staticImageryOnly: Option[Boolean],
      // A review list (#5444). When present and non-empty it replaces every filter above: the Gallery is showing
      // exactly these labels, in this order, so intersecting with a type or validation filter would silently drop
      // items the reviewer asked to see.
      labelIds: Option[Seq[Int]]
  )

  implicit val galleryEnvironmentSubmissionReads: Reads[GalleryEnvironmentSubmission] = (
    (JsPath \ "browser").readNullable[String] and
      (JsPath \ "browser_version").readNullable[String] and
      (JsPath \ "browser_width").readNullable[Int] and
      (JsPath \ "browser_height").readNullable[Int] and
      (JsPath \ "screen_width").readNullable[Int] and
      (JsPath \ "screen_height").readNullable[Int] and
      (JsPath \ "avail_width").readNullable[Int] and
      (JsPath \ "avail_height").readNullable[Int] and
      (JsPath \ "operating_system").readNullable[String] and
      (JsPath \ "language").read[String]
  )(GalleryEnvironmentSubmission.apply _)

  implicit val galleryInteractionSubmissionReads: Reads[GalleryInteractionSubmission] = (
    (JsPath \ "action").read[String] and
      (JsPath \ "pano_id").readNullable[String] and
      (JsPath \ "note").readNullable[String] and
      (JsPath \ "timestamp").read[OffsetDateTime]
  )(GalleryInteractionSubmission.apply _)

  implicit val galleryTaskSubmissionReads: Reads[GalleryTaskSubmission] = (
    (JsPath \ "environment").read[GalleryEnvironmentSubmission] and
      (JsPath \ "interactions").read[Seq[GalleryInteractionSubmission]]
  )(GalleryTaskSubmission.apply _)

  implicit val galleryLabelsRequestReads: Reads[GalleryLabelsRequest] = (
    (JsPath \ "n").read[Int] and
      (JsPath \ "label_types").readNullable[Seq[String]] and
      (JsPath \ "validation_options").readNullable[Seq[String]] and
      (JsPath \ "region_ids").readNullable[Seq[Int]] and
      (JsPath \ "severities").readNullable[Seq[String]] and
      (JsPath \ "tags_by_label_type").readNullable[Map[String, Seq[String]]] and
      (JsPath \ "ai_validation_options").readNullable[Seq[String]] and
      (JsPath \ "loaded_labels").read[Seq[Int]] and
      (JsPath \ "sort").readNullable[String] and
      (JsPath \ "static_imagery_only").readNullable[Boolean] and
      (JsPath \ "label_ids").readNullable[Seq[Int]]
  )(GalleryLabelsRequest.apply _)
}
