/**
 * Models for the Project Sidewalk Validations API.
 *
 * This file contains the data structures used for API requests, responses, and error handling related to validations.
 */
package models.api

import models.api.ApiModelUtils.escapeCsvField
import models.computation.StreamingApiType
import models.label.LocationXY
import play.api.libs.json.{JsObject, Json, OFormat}

import java.time.OffsetDateTime

/**
 * Represents filter criteria for the Validations API (v3).
 *
 * @param labelId Optional label ID to filter validations by the validated label
 * @param userId Optional user ID to filter validations by the user who performed the validation
 * @param validationResult Optional validation result to filter by (1 = Agree, 2 = Disagree, 3 = Unsure)
 * @param labelTypeId Optional label type ID to filter by the type of the validated label
 * @param validationTimestamp Optional timestamp to filter validations by when they occurred (using startTimestamp)
 * @param changedTags Optional boolean to filter validations where tags were changed (oldTags != newTags)
 * @param changedSeverityLevels Optional boolean to filter validations where severity was changed
 *                              (oldSeverity != newSeverity)
 */
case class ValidationFiltersForApi(
    labelId: Option[Int] = None,
    userId: Option[String] = None,
    validationResult: Option[Int] = None,
    labelTypeId: Option[Int] = None,
    validationTimestamp: Option[OffsetDateTime] = None,
    changedTags: Option[Boolean] = None,
    changedSeverityLevels: Option[Boolean] = None
)

/**
 * Represents a label validation for the API.
 * Implements StreamingApiType to support streaming output formats like JSON and CSV.
 * Note: Validations do not include geographic coordinates - those are properties of the labels being validated.
 *
 * @param labelValidationId Unique identifier for the validation
 * @param labelId ID of the validated label
 * @param labelTypeId Type ID of the validated label
 * @param labelType String representation of the label type
 * @param validationResult Numeric result of validation (1 = Agree, 2 = Disagree, 3 = Unsure)
 * @param validationResultString String representation of the validation result
 * @param oldSeverity Previous severity assigned to the label
 * @param newSeverity New severity assigned during validation
 * @param oldTags Previous tags assigned to the label
 * @param newTags New tags assigned during validation
 * @param userId ID of the user who performed the validation
 * @param validatorType Whether the validation was performed by a human or AI
 * @param missionId ID of the mission during which the validation was performed
 * @param canvasXY Canvas X/Y coordinates of the label when it was validated; can be None if label was offscreen
 * @param heading Pano heading when validation occurred
 * @param pitch Pano pitch when validation occurred
 * @param zoom Pano zoom level when validation occurred
 * @param canvasHeight Height of the canvas
 * @param canvasWidth Width of the canvas
 * @param startTimestamp When the validation was started
 * @param endTimestamp When the validation was completed
 * @param source Source of the validation
 */
case class ValidationDataForApi(
    labelValidationId: Int,
    labelId: Int,
    labelTypeId: Int,
    labelType: String,
    validationResult: Int,
    validationResultString: String,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    userId: String,
    validatorType: String,
    missionId: Int,
    canvasXY: Option[LocationXY],
    heading: Float,
    pitch: Float,
    zoom: Float,
    canvasHeight: Int,
    canvasWidth: Int,
    startTimestamp: OffsetDateTime,
    endTimestamp: OffsetDateTime,
    source: String
) extends StreamingApiType {

  /**
   * Converts this ValidationDataForApi object to a JSON object.
   * Since validations don't have geographic coordinates, this returns a standard JSON object rather than GeoJSON.
   *
   * @return A JsObject containing the validation data
   */
  override def toJson: JsObject = {
    Json.obj(
      "label_validation_id"      -> labelValidationId,
      "label_id"                 -> labelId,
      "label_type_id"            -> labelTypeId,
      "label_type"               -> labelType,
      "validation_result"        -> validationResult,
      "validation_result_string" -> validationResultString,
      "old_severity"             -> oldSeverity,
      "new_severity"             -> newSeverity,
      "old_tags"                 -> oldTags,
      "new_tags"                 -> newTags,
      "user_id"                  -> userId,
      "validator_type"           -> validatorType,
      "mission_id"               -> missionId,
      "canvas_x"                 -> canvasXY.map(_.x),
      "canvas_y"                 -> canvasXY.map(_.y),
      "heading"                  -> heading,
      "pitch"                    -> pitch,
      "zoom"                     -> zoom,
      "canvas_height"            -> canvasHeight,
      "canvas_width"             -> canvasWidth,
      "start_timestamp"          -> startTimestamp.toString,
      "end_timestamp"            -> endTimestamp.toString,
      "source"                   -> source
    )
  }

  /**
   * Converts this ValidationDataForApi object to a CSV row string.
   *
   * The fields are ordered to match the header defined in the companion object. Complex fields like arrays are
   * serialized as JSON strings.
   *
   * @return A comma-separated string representing this validation's data
   */
  override def toCsvRow: String = {
    val fields = Seq(
      labelValidationId.toString,
      labelId.toString,
      labelTypeId.toString,
      escapeCsvField(labelType),
      validationResult.toString,
      escapeCsvField(validationResultString),
      oldSeverity.map(_.toString).getOrElse(""),
      newSeverity.map(_.toString).getOrElse(""),
      escapeCsvField(oldTags.mkString("[", ",", "]")),
      escapeCsvField(newTags.mkString("[", ",", "]")),
      escapeCsvField(userId),
      validatorType,
      missionId.toString,
      canvasXY.map(_.x.toString).getOrElse(""),
      canvasXY.map(_.y.toString).getOrElse(""),
      heading.toString,
      pitch.toString,
      zoom.toString,
      canvasHeight.toString,
      canvasWidth.toString,
      startTimestamp.toString,
      endTimestamp.toString,
      escapeCsvField(source)
    )
    fields.mkString(",")
  }
}

/**
 * Companion object for ValidationDataForApi containing CSV header definition
 */
object ValidationDataForApi {

  /**
   * CSV header string with field names in the same order as the toCsvRow output.
   * This should be included as the first line when generating CSV output.
   */
  val csvHeader: String = "label_validation_id,label_id,label_type_id,label_type,validation_result," +
    "validation_result_string,old_severity,new_severity,old_tags,new_tags,user_id,validator_type,mission_id,canvas_x," +
    "canvas_y,heading,pitch,zoom,canvas_height,canvas_width,start_timestamp,end_timestamp,source\n"
}

/**
 * Represents a validation result type for API responses.
 *
 * @param id The numeric identifier for the validation result (1-3)
 * @param name The string representation of the result ("Agree", "Disagree", "Unsure")
 * @param count Number of validations with this result in the database
 * @param countHuman Number of validations with this result performed by human users
 * @param countAi Number of validations with this result performed by AI
 */
case class ValidationResultTypeForApi(
    id: Int,
    name: String,
    count: Int,
    countHuman: Int,
    countAi: Int
)

/**
 * Companion object for ValidationResultTypeForApi containing JSON formatter
 */
object ValidationResultTypeForApi {
  implicit val format: OFormat[ValidationResultTypeForApi] = Json.format[ValidationResultTypeForApi]
}
