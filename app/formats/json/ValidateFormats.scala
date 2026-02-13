package formats.json

import controllers.helper.ValidateHelper.ValidateParams
import formats.json.CommentSubmissionFormats.ValidationCommentSubmission
import formats.json.LabelFormats.labelTypeReads
import formats.json.PanoFormats._
import models.label.LabelTypeEnum
import models.utils.CommonUtils.UiSource
import models.utils.CommonUtils.UiSource.UiSource
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsError, JsPath, JsSuccess, Reads}

import java.time.OffsetDateTime
import scala.util.{Failure, Success, Try}

object ValidateFormats {
  case class EnvironmentSubmission(
      missionId: Option[Int],
      browser: Option[String],
      browserVersion: Option[String],
      browserWidth: Option[Int],
      browserHeight: Option[Int],
      availWidth: Option[Int],
      availHeight: Option[Int],
      screenWidth: Option[Int],
      screenHeight: Option[Int],
      operatingSystem: Option[String],
      language: String,
      cssZoom: Int
  )
  case class InteractionSubmission(
      action: String,
      missionId: Option[Int],
      panoId: Option[String],
      lat: Option[Float],
      lng: Option[Float],
      heading: Option[Float],
      pitch: Option[Float],
      zoom: Option[Float],
      note: Option[String],
      timestamp: OffsetDateTime
  )
  case class LabelValidationSubmission(
      labelId: Int,
      missionId: Int,
      validationResult: Int,
      oldSeverity: Option[Int],
      newSeverity: Option[Int],
      oldTags: List[String],
      newTags: List[String],
      comment: Option[ValidationCommentSubmission],
      canvasX: Option[Int],
      canvasY: Option[Int],
      heading: Float,
      pitch: Float,
      zoom: Double,
      canvasHeight: Int,
      canvasWidth: Int,
      startTimestamp: OffsetDateTime,
      endTimestamp: OffsetDateTime,
      source: UiSource,
      undone: Boolean,
      redone: Boolean
  )
  case class SkipLabelSubmission(labels: Seq[LabelValidationSubmission], validateParams: ValidateParams)
  case class ValidationMissionProgress(
      missionId: Int,
      missionType: String,
      labelsProgress: Int,
      labelsTotal: Int,
      labelTypeId: Int,
      completed: Boolean,
      skipped: Boolean
  )
  case class ValidationTaskSubmission(
      interactions: Seq[InteractionSubmission],
      environment: EnvironmentSubmission,
      validations: Seq[LabelValidationSubmission],
      missionProgress: Option[ValidationMissionProgress],
      validateParams: ValidateParams,
      panoHistories: Seq[PanoHistorySubmission],
      source: UiSource,
      timestamp: OffsetDateTime
  )
  case class LabelMapValidationSubmission(
      labelId: Int,
      labelType: String,
      validationResult: Int,
      oldSeverity: Option[Int],
      newSeverity: Option[Int],
      oldTags: List[String],
      newTags: List[String],
      canvasX: Option[Int],
      canvasY: Option[Int],
      heading: Float,
      pitch: Float,
      zoom: Double,
      canvasHeight: Int,
      canvasWidth: Int,
      startTimestamp: OffsetDateTime,
      endTimestamp: OffsetDateTime,
      source: UiSource,
      undone: Boolean,
      redone: Boolean
  )

  implicit val uiSourceReads: Reads[UiSource.Value] = Reads { json =>
    json.validate[String].flatMap { uiSource =>
      Try(UiSource.withName(uiSource)) match {
        case Success(source) => JsSuccess(source)
        case Failure(_)      =>
          JsError(s"Invalid viewer type: $uiSource. Valid types are: ${UiSource.values.mkString(", ")}.")
      }
    }
  }

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
      (JsPath \ "pano_id").readNullable[String] and
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
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[OffsetDateTime] and
      (JsPath \ "end_timestamp").read[OffsetDateTime] and
      (JsPath \ "source").read[UiSource.Value] and
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

  implicit val adminValidateParamsReads: Reads[ValidateParams] = (
    (JsPath \ "admin_version").read[Boolean] and
      (JsPath \ "label_type").readNullable[LabelTypeEnum.Base] and
      (JsPath \ "user_ids").readNullable[Seq[String]] and
      (JsPath \ "neighborhood_ids").readNullable[Seq[Int]] and
      (JsPath \ "unvalidated_only").read[Boolean]
  )(ValidateParams.apply _)

  implicit val validationTaskSubmissionReads: Reads[ValidationTaskSubmission] = (
    (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "validations").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "mission_progress").readNullable[ValidationMissionProgress] and
      (JsPath \ "validate_params").read[ValidateParams] and
      (JsPath \ "pano_histories").read[Seq[PanoHistorySubmission]] and
      (JsPath \ "source").read[UiSource.Value] and
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
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "start_timestamp").read[OffsetDateTime] and
      (JsPath \ "end_timestamp").read[OffsetDateTime] and
      (JsPath \ "source").read[UiSource.Value] and
      (JsPath \ "undone").read[Boolean] and
      (JsPath \ "redone").read[Boolean]
  )(LabelMapValidationSubmission.apply _)

  implicit val skipLabelReads: Reads[SkipLabelSubmission] = (
    (JsPath \ "labels").read[Seq[LabelValidationSubmission]] and
      (JsPath \ "validate_params").read[ValidateParams]
  )(SkipLabelSubmission.apply _)
}
