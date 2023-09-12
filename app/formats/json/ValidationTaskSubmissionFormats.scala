package formats.json

import java.sql.Timestamp
import play.api.libs.json.{JsBoolean, JsPath, Reads}

import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object ValidationTaskSubmissionFormats {
  case class EnvironmentSubmission(missionId: Option[Int], browser: Option[String], browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int], availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int], screenHeight: Option[Int], operatingSystem: Option[String], language: String)
  case class InteractionSubmission(action: String, missionId: Option[Int], gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Float], note: Option[String], timestamp: Long, isMobile: Boolean)
  case class LabelValidationSubmission(labelId: Int, missionId: Int, validationResult: Int, canvasX: Option[Int], canvasY: Option[Int], heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: Long, endTimestamp: Long, source: String)
  case class SkipLabelSubmission(labels: Seq[LabelValidationSubmission])
  case class ValidationMissionProgress(missionId: Int, missionType: String, labelsProgress: Int, labelTypeId: Int, completed: Boolean, skipped: Boolean)
  case class ValidationTaskSubmission(interactions: Seq[InteractionSubmission], environment: EnvironmentSubmission, labels: Seq[LabelValidationSubmission], missionProgress: Option[ValidationMissionProgress])
  case class LabelMapValidationSubmission(labelId: Int, labelType: String, validationResult: Int, canvasX: Option[Int], canvasY: Option[Int], heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: Long, endTimestamp: Long, source: String)

  implicit val environmentSubmissionReads: Reads[EnvironmentSubmission] = (
    (JsPath \ "mission_id").readNullable[Int] and
      (JsPath \ "browser").readNullable[String] and
      (JsPath \ "browser_version").readNullable[String] and
      (JsPath \ "browser_width").readNullable[Int] and
      (JsPath \ "browser_height").readNullable[Int] and
      (JsPath \ "avail_width").readNullable[Int] and
      (JsPath \ "avail_height").readNullable[Int] and
      (JsPath \ "screen_width").readNullable[Int] and
      (JsPath \ "screen_height").readNullable[Int] and
      (JsPath \ "operating_system").readNullable[String] and
      (JsPath \ "language").read[String]
    )(EnvironmentSubmission.apply _)

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
      (JsPath \ "source").read[String]
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
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "labels").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "missionProgress").readNullable[ValidationMissionProgress]
    )(ValidationTaskSubmission.apply _) // .map(ValidationTaskSubmission(_))

  implicit val labelMapValidationSubmissionReads: Reads[LabelMapValidationSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
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
      (JsPath \ "source").read[String]
    )(LabelMapValidationSubmission.apply _)

  implicit val skipLabelReads: Reads[SkipLabelSubmission] = (
    (JsPath \ "labels").read[Seq[LabelValidationSubmission]]
  ).map(SkipLabelSubmission(_))
}
