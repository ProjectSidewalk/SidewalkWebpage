/**
 * Models for the Project Sidewalk User Stats API.
 *
 * This file contains the data structure returned by the `/v3/api/userStats` endpoint, summarizing each
 * registered user's labeling and validation activity.
 */
package models.api

import models.label.LabelTypeEnum
import models.user.LabelTypeStat
import play.api.libs.json.{JsObject, Writes}

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

  override def toJson: JsObject = UserStatForApi.toJson(this)

  override def toCsvRow: String = UserStatForApi.toCsvRow(this)
}

object UserStatForApi extends ApiFields[UserStatForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[UserStatForApi]] = Seq[ApiField[UserStatForApi]](
    field("user_id")(_.userId),
    field("labels")(_.labels),
    field("meters_explored")(_.metersExplored),
    field("labels_per_meter")(_.labelsPerMeter),
    field("high_quality")(_.highQuality),
    field("high_quality_manual")(_.highQualityManual),
    field("label_accuracy")(_.labelAccuracy),
    field("validated_labels")(_.validatedLabels),
    field("validations_received")(_.validationsReceived),
    field("labels_validated_correct")(_.labelsValidatedCorrect),
    field("labels_validated_incorrect")(_.labelsValidatedIncorrect),
    field("labels_not_validated")(_.labelsNotValidated),
    field("validations_given")(_.validationsGiven),
    field("dissenting_validations_given")(_.dissentingValidationsGiven),
    field("agree_validations_given")(_.agreeValidationsGiven),
    field("disagree_validations_given")(_.disagreeValidationsGiven),
    field("unsure_validations_given")(_.unsureValidationsGiven)
  ) ++ LabelTypeEnum.orderedNames.flatMap { labelType =>
    Seq(
      field(s"stats_by_label_type.$labelType.labels")(_.statsByLabelType(labelType).labels),
      field(s"stats_by_label_type.$labelType.validated_correct")(_.statsByLabelType(labelType).validatedCorrect),
      field(s"stats_by_label_type.$labelType.validated_incorrect")(_.statsByLabelType(labelType).validatedIncorrect),
      field(s"stats_by_label_type.$labelType.not_validated")(_.statsByLabelType(labelType).notValidated)
    )
  }

  implicit val userStatWrites: Writes[UserStatForApi] = (userStat: UserStatForApi) => userStat.toJson
}
