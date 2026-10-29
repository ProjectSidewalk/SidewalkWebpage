package formats.json

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, Reads}

object CommentSubmissionFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  case class CommentSubmission(
      auditTaskId: Int,
      missionId: Int,
      streetEdgeId: Int,
      comment: String,
      panoId: String,
      heading: Double,
      pitch: Double,
      zoom: Double,
      lat: Double,
      lng: Double
  )

  /**
   * A comment riding in with a Validate-tool vote. `reason` is the id of the canned reason the text is, when the
   * validator picked one rather than typing (#5475); it must be one the label's type offers for that vote.
   */
  case class ValidationCommentSubmission(
      missionId: Int,
      labelId: Int,
      comment: String,
      reason: Option[String],
      panoId: String,
      heading: Double,
      pitch: Double,
      zoom: Double,
      lat: Double,
      lng: Double
  )

  /** A comment from the label detail card or a Gallery card; `reason` as in [[ValidationCommentSubmission]]. */
  case class LabelMapValidationCommentSubmission(
      labelId: Int,
      labelType: String,
      comment: String,
      reason: Option[String],
      panoId: String,
      heading: Double,
      pitch: Double,
      zoom: Double,
      lat: Double,
      lng: Double
  )

  given commentSubmissionReads: Reads[CommentSubmission] = Json.reads[CommentSubmission]

  given validationCommentSubmissionReads: Reads[ValidationCommentSubmission] = Json.reads[ValidationCommentSubmission]

  given labelMapValidationCommentSubmissionReads: Reads[LabelMapValidationCommentSubmission] =
    Json.reads[LabelMapValidationCommentSubmission]
}
