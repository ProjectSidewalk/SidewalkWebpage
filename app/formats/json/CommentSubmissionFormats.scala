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

  case class ValidationCommentSubmission(
      missionId: Int,
      labelId: Int,
      comment: String,
      panoId: String,
      heading: Double,
      pitch: Double,
      zoom: Double,
      lat: Double,
      lng: Double
  )

  case class LabelMapValidationCommentSubmission(
      labelId: Int,
      labelType: String,
      comment: String,
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
