package formats.json

import java.sql.Timestamp
import play.api.libs.json.{JsBoolean, JsPath, Reads}

import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object ValidationTaskSubmissionFormats {
  case class InteractionSubmission(action: String, missionId: Int, gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Float], note: Option[String], timestamp: Long)
  case class LabelValidationSubmission(labelId: Int, missionId: Int, validationResult: Int, canvasX: Int, canvasY: Int, heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: Long, endTimestamp: Long)
  case class ValidationMissionProgress(missionId: Int, labelsProgress: Int, completed: Boolean, skipped: Boolean)
  case class ValidationTaskSubmission(interactions: Seq[InteractionSubmission], labels: Seq[LabelValidationSubmission], missionProgress: ValidationMissionProgress)

  implicit val interactionSubmissionReads: Reads[InteractionSubmission] = (
    (JsPath \ "action").read[String] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "heading").readNullable[Float] and
      (JsPath \ "pitch").readNullable[Float] and
      (JsPath \ "zoom").readNullable[Float] and
      (JsPath \ "note").readNullable[String] and
      (JsPath \ "timestamp").read[Long]
    )(InteractionSubmission.apply _)

  implicit val labelValidationSubmissionReads: Reads[LabelValidationSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "validation_result").read[Int] and
      (JsPath \ "canvas_x").read[Int] and
      (JsPath \ "canvas_y").read[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Float] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[Long] and
      (JsPath \ "end_timestamp").read[Long]
    )(LabelValidationSubmission.apply _)

  implicit val validationMissionReads: Reads[ValidationMissionProgress] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "labels_progress").read[Int] and
      (JsPath \ "completed").read[Boolean] and
      (JsPath \ "skipped").read[Boolean]
    )(ValidationMissionProgress.apply _)

  implicit val validationTaskSubmissionReads: Reads[ValidationTaskSubmission] = (
    (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "labels").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "missionProgress").read[ValidationMissionProgress]
    )(ValidationTaskSubmission.apply _) // .map(ValidationTaskSubmission(_))
}
