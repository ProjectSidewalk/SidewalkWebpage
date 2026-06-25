/**
 * Models for the Project Sidewalk User Stats API.
 *
 * This file contains the data structure returned by the `/v3/api/userStats` endpoint, summarizing each
 * registered user's labeling and validation activity.
 */
package models.api

import models.label.LabelTypeEnum
import models.user.LabelTypeStat
import play.api.libs.json.{JsObject, Json, Writes}

/**
 * Per-user labeling and validation statistics for the User Stats API.
 *
 * Implements StreamingApiType to support streaming output formats like JSON and CSV. `statsByLabelType`
 * is keyed by `LabelTypeEnum` name and is expected to contain an entry for every label type.
 *
 * @param userId Anonymized user identifier
 * @param labels Total number of labels the user has placed
 * @param metersExplored Distance explored by the user, in meters
 * @param labelsPerMeter Labels placed per meter explored, if computable
 * @param highQuality Whether the user is currently considered high quality
 * @param highQualityManual Manual high-quality override, if set
 * @param labelAccuracy The user's label accuracy, if they have validated labels
 * @param validatedLabels Number of the user's labels that have been validated
 * @param validationsReceived Number of validations the user's labels have received
 * @param labelsValidatedCorrect Number of the user's labels validated as correct
 * @param labelsValidatedIncorrect Number of the user's labels validated as incorrect
 * @param labelsNotValidated Number of the user's labels not yet validated
 * @param validationsGiven Number of validations the user has given to others
 * @param dissentingValidationsGiven Validations the user gave that disagreed with the majority
 * @param agreeValidationsGiven Number of "agree" validations the user gave
 * @param disagreeValidationsGiven Number of "disagree" validations the user gave
 * @param unsureValidationsGiven Number of "unsure" validations the user gave
 * @param statsByLabelType Per-label-type breakdown of label and validation counts
 */
case class UserStatForApi(
    userId: String,
    labels: Int,
    metersExplored: Double,
    labelsPerMeter: Option[Double],
    highQuality: Boolean,
    highQualityManual: Option[Boolean],
    labelAccuracy: Option[Double],
    validatedLabels: Int,
    validationsReceived: Int,
    labelsValidatedCorrect: Int,
    labelsValidatedIncorrect: Int,
    labelsNotValidated: Int,
    validationsGiven: Int,
    dissentingValidationsGiven: Int,
    agreeValidationsGiven: Int,
    disagreeValidationsGiven: Int,
    unsureValidationsGiven: Int,
    statsByLabelType: Map[String, LabelTypeStat]
) extends StreamingApiType {

  /**
   * Converts this UserStatForApi object to a JSON object with snake_case field names (#3871).
   *
   * @return A JsObject representing the user's stats, with a nested `stats_by_label_type` breakdown.
   */
  override def toJson: JsObject = {
    Json.obj(
      "user_id"                      -> userId,
      "labels"                       -> labels,
      "meters_explored"              -> metersExplored,
      "labels_per_meter"             -> labelsPerMeter,
      "high_quality"                 -> highQuality,
      "high_quality_manual"          -> highQualityManual,
      "label_accuracy"               -> labelAccuracy,
      "validated_labels"             -> validatedLabels,
      "validations_received"         -> validationsReceived,
      "labels_validated_correct"     -> labelsValidatedCorrect,
      "labels_validated_incorrect"   -> labelsValidatedIncorrect,
      "labels_not_validated"         -> labelsNotValidated,
      "validations_given"            -> validationsGiven,
      "dissenting_validations_given" -> dissentingValidationsGiven,
      "agree_validations_given"      -> agreeValidationsGiven,
      "disagree_validations_given"   -> disagreeValidationsGiven,
      "unsure_validations_given"     -> unsureValidationsGiven,
      "stats_by_label_type"          -> Json.obj(
        "curb_ramp"         -> Json.toJson(statsByLabelType(LabelTypeEnum.CurbRamp.name)),
        "no_curb_ramp"      -> Json.toJson(statsByLabelType(LabelTypeEnum.NoCurbRamp.name)),
        "obstacle"          -> Json.toJson(statsByLabelType(LabelTypeEnum.Obstacle.name)),
        "surface_problem"   -> Json.toJson(statsByLabelType(LabelTypeEnum.SurfaceProblem.name)),
        "no_sidewalk"       -> Json.toJson(statsByLabelType(LabelTypeEnum.NoSidewalk.name)),
        "marked_crosswalk"  -> Json.toJson(statsByLabelType(LabelTypeEnum.Crosswalk.name)),
        "pedestrian_signal" -> Json.toJson(statsByLabelType(LabelTypeEnum.Signal.name)),
        "cant_see_sidewalk" -> Json.toJson(statsByLabelType(LabelTypeEnum.Occlusion.name)),
        "other"             -> Json.toJson(statsByLabelType(LabelTypeEnum.Other.name))
      )
    )
  }

  /**
   * Converts this UserStatForApi object to a CSV row matching the companion object's `csvHeader`.
   *
   * The per-label-type stats are flattened into four columns each, in the same label-type order as the
   * header. `None` options are rendered as "NA".
   *
   * @return A comma-separated string representing this user's stats.
   */
  override def toCsvRow: String = {
    s"${userId},${labels},${metersExplored},${formatOptionForCsv(labelsPerMeter)},${highQuality}," +
      s"${formatOptionForCsv(highQualityManual)},${formatOptionForCsv(labelAccuracy)},${validatedLabels}," +
      s"${validationsReceived},${labelsValidatedCorrect},${labelsValidatedIncorrect},${labelsNotValidated}," +
      s"${validationsGiven},${dissentingValidationsGiven},${agreeValidationsGiven}," +
      s"${disagreeValidationsGiven},${unsureValidationsGiven}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.CurbRamp.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.NoCurbRamp.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.Obstacle.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.SurfaceProblem.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.NoSidewalk.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.Crosswalk.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.Signal.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.Occlusion.name))}," +
      s"${labelTypeStatToCsvRow(statsByLabelType(LabelTypeEnum.Other.name))}"
  }

  /** Renders an option for CSV, using "NA" for `None` (matches the historical userStats CSV format). */
  private def formatOptionForCsv(x: Option[Any]): String = x.map(_.toString).getOrElse("NA").replace("\"", "\"\"")

  /** Flattens one label type's stats into the four CSV columns: labels, correct, incorrect, not-validated. */
  private def labelTypeStatToCsvRow(l: LabelTypeStat): String =
    s"${l.labels},${l.validatedCorrect},${l.validatedIncorrect},${l.notValidated}"
}

/**
 * Companion object for UserStatForApi containing the CSV header and JSON writer.
 */
object UserStatForApi {

  // Historical Title-Case header; preserved verbatim for output compatibility with existing API consumers.
  val csvHeader: String = "User ID,Labels,Meters Explored,Labels per Meter,High Quality,High Quality Manual," +
    "Label Accuracy,Validated Labels,Validations Received,Labels Validated Correct,Labels Validated Incorrect," +
    "Labels Not Validated,Validations Given,Dissenting Validations Given,Agree Validations Given," +
    "Disagree Validations Given,Unsure Validations Given,Curb Ramp Labels,Curb Ramps Validated Correct," +
    "Curb Ramps Validated Incorrect,Curb Ramps Not Validated,No Curb Ramp Labels,No Curb Ramps Validated Correct," +
    "No Curb Ramps Validated Incorrect,No Curb Ramps Not Validated,Obstacle Labels,Obstacles Validated Correct," +
    "Obstacles Validated Incorrect,Obstacles Not Validated,Surface Problem Labels,Surface Problems Validated Correct," +
    "Surface Problems Validated Incorrect,Surface Problems Not Validated,No Sidewalk Labels," +
    "No Sidewalks Validated Correct,No Sidewalks Validated Incorrect,No Sidewalks Not Validated," +
    "Marked Crosswalk Labels,Marked Crosswalks Validated Correct,Marked Crosswalks Validated Incorrect," +
    "Marked Crosswalks Not Validated,Pedestrian Signal Labels,Pedestrian Signals Validated Correct," +
    "Pedestrian Signals Validated Incorrect,Pedestrian Signals Not Validated,Cant See Sidewalk Labels," +
    "Cant See Sidewalks Validated Correct,Cant See Sidewalks Validated Incorrect,Cant See Sidewalks Not Validated," +
    "Other Labels,Others Validated Correct,Others Validated Incorrect,Others Not Validated\n"

  implicit val userStatWrites: Writes[UserStatForApi] = (userStat: UserStatForApi) => userStat.toJson
}
