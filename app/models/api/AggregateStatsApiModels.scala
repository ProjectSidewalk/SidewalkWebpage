/**
 * Models for the Project Sidewalk aggregate stats API (/v3/api/aggregateStats): every deployment's counts summed into
 * one cross-city total.
 */
package models.api

import models.api.ApiModelUtils.toSnakeKey
import play.api.libs.json.{JsObject, Json}

/**
 * Represents label statistics for a specific label type.
 *
 * @param labels Total number of labels for this type
 * @param labelsValidated Total number of labels validated for this type
 * @param labelsValidatedAgree Number of validated labels that were agreed upon
 * @param labelsValidatedDisagree Number of validated labels that were disagreed upon
 */
case class LabelTypeStats(
    labels: Int,
    labelsValidated: Int,
    labelsValidatedAgree: Int,
    labelsValidatedDisagree: Int
)

/**
 * Represents aggregate statistics across all Project Sidewalk deployments.
 *
 * @param kmExplored Total kilometers explored across all cities
 * @param kmExploredNoOverlap Total kilometers explored without overlap across all cities
 * @param totalLabels Total number of (non-tutorial) labels across all cities. Equals the sum of `byLabelType` label
 *                    counts by construction (#3981), so the per-type breakdown always reconciles with this total.
 * @param tutorialLabels Total number of practice/tutorial labels across all cities. Tracked separately because tutorial
 *                       labels are excluded from `totalLabels` and `byLabelType` (they would skew the per-type ratios).
 * @param totalValidations Total number of validations across all cities
 * @param totalUsers Number of distinct contributors across all cities — users who added at least one (non-tutorial)
 *                   label or validated at least one label. Counted as distinct people: because `user_id` is a global
 *                   identifier shared across city schemas, a user active in multiple cities is counted once (the union
 *                   of contributor ids, not the sum of per-city counts). The legacy DC deployment contributes a fixed
 *                   historical estimate (`legacyDCUserCount`) since it has no per-user records.
 * @param numCities Number of cities where Project Sidewalk is deployed
 * @param numCountries Number of countries where Project Sidewalk is deployed
 * @param numLanguages Number of distinct languages supported
 * @param byLabelType Map of label type to its statistics
 */
case class AggregateStats(
    kmExplored: Double,
    kmExploredNoOverlap: Double,
    totalLabels: Int,
    tutorialLabels: Int,
    totalValidations: Int,
    totalUsers: Int,
    numCities: Int,
    numCountries: Int,
    numLanguages: Int,
    byLabelType: Map[String, LabelTypeStats]
) {

  def toJson: JsObject = {
    val labelTypeJson = byLabelType.map { case (labelType, labelStats) =>
      labelType -> Json.obj(
        "labels"                    -> labelStats.labels,
        "labels_validated"          -> labelStats.labelsValidated,
        "labels_validated_agree"    -> labelStats.labelsValidatedAgree,
        "labels_validated_disagree" -> labelStats.labelsValidatedDisagree
      )
    }

    Json.obj(
      "status"                 -> "OK",
      "km_explored"            -> kmExplored,
      "km_explored_no_overlap" -> kmExploredNoOverlap,
      "total_labels"           -> totalLabels,
      "tutorial_labels"        -> tutorialLabels,
      "total_validations"      -> totalValidations,
      "total_users"            -> totalUsers,
      "num_cities"             -> numCities,
      "num_countries"          -> numCountries,
      "num_languages"          -> numLanguages,
      "by_label_type"          -> labelTypeJson
    )
  }

  /**
   * One response is a single object rather than a series of records, so the CSV is a vertical listing under the
   * companion's two-column header.
   *
   * @return One "snake_case_key,value" line per stat (#3871).
   */
  def toCsvRows: Seq[String] = {
    def row(label: String, value: Any): String = s"${toSnakeKey(label)},$value"

    val basicStats = Seq(
      row("KM Explored", kmExplored),
      row("KM Explored No Overlap", kmExploredNoOverlap),
      row("Total Labels", totalLabels),
      row("Tutorial Labels", tutorialLabels),
      row("Total Validations", totalValidations),
      row("Total Users", totalUsers),
      row("Number of Cities", numCities),
      row("Number of Countries", numCountries),
      row("Number of Languages", numLanguages)
    )

    val labelTypeStats = byLabelType.toSeq.flatMap { case (labelType, labelStats) =>
      Seq(
        row(s"$labelType Labels", labelStats.labels),
        row(s"$labelType Labels Validated", labelStats.labelsValidated),
        row(s"$labelType Labels Validated Agree", labelStats.labelsValidatedAgree),
        row(s"$labelType Labels Validated Disagree", labelStats.labelsValidatedDisagree)
      )
    }

    basicStats ++ labelTypeStats
  }
}

object AggregateStats {
  val csvHeader: String = "metric,value"
}
