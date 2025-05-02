package formats.json

import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.CommentSubmissionFormats.ValidationCommentSubmission
import formats.json.PanoHistoryFormats._
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads}

import java.time.OffsetDateTime

object ValidationTaskSubmissionFormats {
  case class EnvironmentSubmission(missionId: Option[Int], browser: Option[String], browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int], availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int], screenHeight: Option[Int], operatingSystem: Option[String], language: String, cssZoom: Int)
  case class InteractionSubmission(action: String, missionId: Option[Int], gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Float], note: Option[String], timestamp: OffsetDateTime)
  case class LabelValidationSubmission(labelId: Int, missionId: Int, validationResult: Int, oldSeverity: Option[Int], newSeverity: Option[Int], oldTags: List[String], newTags: List[String], comment: Option[ValidationCommentSubmission], canvasX: Option[Int], canvasY: Option[Int], heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: OffsetDateTime, endTimestamp: OffsetDateTime, source: String, undone: Boolean, redone: Boolean)
  case class SkipLabelSubmission(labels: Seq[LabelValidationSubmission], adminParams: AdminValidateParams)
  case class ValidationMissionProgress(missionId: Int, missionType: String, labelsProgress: Int, labelsTotal: Int, labelTypeId: Int, completed: Boolean, skipped: Boolean)
  case class ValidationTaskSubmission(interactions: Seq[InteractionSubmission], environment: EnvironmentSubmission, validations: Seq[LabelValidationSubmission], missionProgress: Option[ValidationMissionProgress], adminParams: AdminValidateParams, panoHistories: Seq[PanoHistorySubmission], source: String, timestamp: OffsetDateTime)
  case class LabelMapValidationSubmission(labelId: Int, labelType: String, validationResult: Int, oldSeverity: Option[Int], newSeverity: Option[Int], oldTags: List[String], newTags: List[String], canvasX: Option[Int], canvasY: Option[Int], heading: Float, pitch: Float, zoom: Float, canvasHeight: Int, canvasWidth: Int, startTimestamp: OffsetDateTime, endTimestamp: OffsetDateTime, source: String, undone: Boolean, redone: Boolean)

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
      (JsPath \ "language").read[String] and
      (JsPath \ "css_zoom").read[Int]
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
      (JsPath \ "timestamp").read[OffsetDateTime]
    )(InteractionSubmission.apply _)

  implicit val labelValidationSubmissionReads: Reads[LabelValidationSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "mission_id").read[Int] and
      (JsPath \ "validation_result").read[Int] and
      (JsPath \ "old_severity").readNullable[Int] and
      (JsPath \ "new_severity").readNullable[Int] and
      (JsPath \ "old_tags").read[List[String]] and
      (JsPath \ "new_tags").read[List[String]] and
      (JsPath \ "comment").readNullable[ValidationCommentSubmission] and
      (JsPath \ "canvas_x").readNullable[Int] and
      (JsPath \ "canvas_y").readNullable[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Float] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[OffsetDateTime] and
      (JsPath \ "end_timestamp").read[OffsetDateTime] and
      (JsPath \ "source").read[String] and
      (JsPath \ "undone").read[Boolean] and
      (JsPath \ "redone").read[Boolean]
    )(LabelValidationSubmission.apply _)

  implicit val validationMissionReads: Reads[ValidationMissionProgress] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "mission_type").read[String] and
      (JsPath \ "labels_progress").read[Int] and
      (JsPath \ "labels_total").read[Int] and
      (JsPath \ "label_type_id").read[Int] and
      (JsPath \ "completed").read[Boolean] and
      (JsPath \ "skipped").read[Boolean]
    )(ValidationMissionProgress.apply _)

  implicit val adminValidateParamsReads: Reads[AdminValidateParams] = (
    (JsPath \ "admin_version").read[Boolean] and
      (JsPath \ "label_type_id").readNullable[Int] and
      (JsPath \ "user_ids").readNullable[Seq[String]] and
      (JsPath \ "neighborhood_ids").readNullable[Seq[Int]]
    )(AdminValidateParams.apply _)

  implicit val validationTaskSubmissionReads: Reads[ValidationTaskSubmission] = (
    (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "validations").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "mission_progress").readNullable[ValidationMissionProgress] and
      (JsPath \ "admin_params").read[AdminValidateParams] and
      (JsPath \ "pano_histories").read[Seq[PanoHistorySubmission]] and
      (JsPath \ "source").read[String] and
      (JsPath \ "timestamp").read[OffsetDateTime]
    )(ValidationTaskSubmission.apply _)

  implicit val labelMapValidationSubmissionReads: Reads[LabelMapValidationSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "validation_result").read[Int] and
      (JsPath \ "old_severity").readNullable[Int] and
      (JsPath \ "new_severity").readNullable[Int] and
      (JsPath \ "old_tags").read[List[String]] and
      (JsPath \ "new_tags").read[List[String]] and
      (JsPath \ "canvas_x").readNullable[Int] and
      (JsPath \ "canvas_y").readNullable[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Float] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[OffsetDateTime] and
      (JsPath \ "end_timestamp").read[OffsetDateTime] and
      (JsPath \ "source").read[String] and
      (JsPath \ "undone").read[Boolean] and
      (JsPath \ "redone").read[Boolean]
    )(LabelMapValidationSubmission.apply _)

  implicit val skipLabelReads: Reads[SkipLabelSubmission] = (
    (JsPath \ "labels").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "admin_params").read[AdminValidateParams]
  )(SkipLabelSubmission.apply _)
}
