package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

object CommentSubmissionFormats {
  case class CommentSubmission(auditTaskId: Int, missionId: Int, streetEdgeId: Int, comment: String,
                               gsvPanoramaId: Option[String], heading: Option[Double], pitch: Option[Double],
                               zoom: Option[Int], lat: Option[Double], lng: Option[Double])

  case class ValidationCommentSubmission(missionId: Int, labelId: Int, comment: String,
                                         gsvPanoramaId: String, heading: Option[Double], pitch: Option[Double],
                                         zoom: Option[Int], lat: Option[Double], lng: Option[Double])

  implicit val commentSubmissionReads: Reads[CommentSubmission] = (
    (JsPath \ "audit_task_id").read[Int] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "heading").readNullable[Double] and
      (JsPath \ "pitch").readNullable[Double] and
      (JsPath \ "zoom").readNullable[Int] and
      (JsPath \ "lat").readNullable[Double] and
      (JsPath \ "lng").readNullable[Double]
    )(CommentSubmission.apply _)

  implicit val validationCommentSubmissionReads : Reads[ValidationCommentSubmission] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "label_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "gsv_panorama_id").read[String] and
      (JsPath \ "heading").readNullable[Double] and
      (JsPath \ "pitch").readNullable[Double] and
      (JsPath \ "zoom").readNullable[Int] and
      (JsPath \ "lat").readNullable[Double] and
      (JsPath \ "lng").readNullable[Double]
  )(ValidationCommentSubmission.apply _)
}