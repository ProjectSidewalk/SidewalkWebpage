package formats.json

import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads}

object CommentSubmissionFormats {
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

  implicit val commentSubmissionReads: Reads[CommentSubmission] = (
    (JsPath \ "audit_task_id").read[Int] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "pano_id").read[String] and
      (JsPath \ "heading").read[Double] and
      (JsPath \ "pitch").read[Double] and
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double]
  )(CommentSubmission.apply _)

  implicit val validationCommentSubmissionReads: Reads[ValidationCommentSubmission] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "label_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "pano_id").read[String] and
      (JsPath \ "heading").read[Double] and
      (JsPath \ "pitch").read[Double] and
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double]
  )(ValidationCommentSubmission.apply _)

  implicit val labelMapValidationCommentSubmissionReads: Reads[LabelMapValidationCommentSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "pano_id").read[String] and
      (JsPath \ "heading").read[Double] and
      (JsPath \ "pitch").read[Double] and
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double]
  )(LabelMapValidationCommentSubmission.apply _)
}
