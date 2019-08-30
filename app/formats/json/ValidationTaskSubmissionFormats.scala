package formats.json

import java.sql.Timestamp
import play.api.libs.json.{JsBoolean, JsPath, Reads}

import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object ValidationTaskSubmissionFormats {
  case class InteractionSubmission(action: String, missionId: Option[Int], gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Float], note: Option[String], timestamp: Long, isMobile: Boolean)
  case class LabelValidationSubmission(labelId: Int, missionId: Int, validationResult: Int, canvasX: Option[Int], canvasY: Option[Int], heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: Long, endTimestamp: Long, isMobile: Boolean)
  case class SkipLabelSubmission(labels: Seq[LabelValidationSubmission])
  case class ValidationMissionProgress(missionId: Int, missionType: String, labelsProgress: Int, labelTypeId: Int, completed: Boolean, skipped: Boolean)
  case class ValidationTaskSubmission(interactions: Seq[InteractionSubmission], labels: Seq[LabelValidationSubmission], missionProgress: Option[ValidationMissionProgress])

  implicit val interactionSubmissionReads: Reads[InteractionSubmission] = (
    (JsPath \ "action").read[String] and
      (JsPath \ "mission_id").readNullable[Int] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "heading").readNullable[Float] and
      (JsPath \ "pitch").readNullable[Float] and
      (JsPath \ "zoom").readNullable[Float] and
      (JsPath \ "note").readNullable[String] and
      (JsPath \ "timestamp").read[Long] and
      (JsPath \ "is_mobile").read[Boolean]
    )(InteractionSubmission.apply _)

  implicit val labelValidationSubmissionReads: Reads[LabelValidationSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "validation_result").read[Int] and
      (JsPath \ "canvas_x").readNullable[Int] and
      (JsPath \ "canvas_y").readNullable[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Float] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[Long] and
      (JsPath \ "end_timestamp").read[Long] and
      (JsPath \ "is_mobile").read[Boolean]
    )(LabelValidationSubmission.apply _)

  implicit val validationMissionReads: Reads[ValidationMissionProgress] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "mission_type").read[String] and
      (JsPath \ "labels_progress").read[Int] and
      (JsPath \ "label_type_id").read[Int] and
      (JsPath \ "completed").read[Boolean] and
      (JsPath \ "skipped").read[Boolean]
    )(ValidationMissionProgress.apply _)

  implicit val validationTaskSubmissionReads: Reads[ValidationTaskSubmission] = (
    (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "labels").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "missionProgress").readNullable[ValidationMissionProgress]
    )(ValidationTaskSubmission.apply _) // .map(ValidationTaskSubmission(_))

  implicit val skipLabelReads: Reads[SkipLabelSubmission] = (
    (JsPath \ "labels").read[Seq[LabelValidationSubmission]]
  ).map(SkipLabelSubmission(_))
}
