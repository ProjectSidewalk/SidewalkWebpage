package formats.json

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, Reads}

import java.time.OffsetDateTime

object GalleryFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

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

  given galleryEnvironmentSubmissionReads: Reads[GalleryEnvironmentSubmission] =
    Json.reads[GalleryEnvironmentSubmission]

  given galleryInteractionSubmissionReads: Reads[GalleryInteractionSubmission] =
    Json.reads[GalleryInteractionSubmission]

  given galleryTaskSubmissionReads: Reads[GalleryTaskSubmission] = Json.reads[GalleryTaskSubmission]

  given galleryLabelsRequestReads: Reads[GalleryLabelsRequest] = Json.reads[GalleryLabelsRequest]
}
