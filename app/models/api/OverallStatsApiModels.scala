/**
 * Models for the Project Sidewalk overall stats API (/v3/api/overallStats): one city-wide snapshot of exploration,
 * user, label, validation, and AI-performance counts.
 */
package models.api

import models.api.ApiModelUtils.{labelTypeOrdering, toCsvKeyValueRows}
import play.api.libs.functional.syntax._
import play.api.libs.json._

import java.time.{Duration, OffsetDateTime}

case class LabelSevStats(
    n: Int,
    nWithSeverity: Option[Int],
    severityMean: Option[Double],
    severityStddev: Option[Double]
)

object LabelSevStats {
  implicit val labelSevStatsWrites: Writes[LabelSevStats] = (
    (__ \ "count").write[Int] and
      (__ \ "count_with_severity").write[Option[Int]] and
      (__ \ "severity_mean").write[Option[Double]] and
      // "stddev", not "sd", so the endpoint spells standard deviation one way (see the label stddev_* fields).
      (__ \ "severity_stddev").write[Option[Double]]
  )(unlift(LabelSevStats.unapply))
}

case class LabelAccuracy(n: Int, nAgree: Int, nDisagree: Int, accuracy: Option[Double], nWithValidation: Int)

object LabelAccuracy {
  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      // Written as an explicit null rather than dropped, so a label type with no validations still has the key.
      (__ \ "accuracy").write[Option[Double]] and
      (__ \ "has_a_validation").write[Int]
  )(unlift(LabelAccuracy.unapply))
}

case class AiConcurrence(
    aiYesMajVoteConcurs: Int,
    aiYesMajVoteDiffers: Int,
    aiNoMajVoteDiffers: Int,
    aiNoMajVoteConcurs: Int
)

object AiConcurrence {
  private val voteTypeOrder: Seq[String] = Seq("human_majority_vote", "admin_majority_vote")

  /**
   * Sorts (vote type, _) pairs of an `ai_stats` inner map. Unrecognized keys sort last rather than being dropped.
   */
  val voteTypeOrdering: Ordering[(String, Any)] = Ordering.by { case (voteType, _) =>
    val i = voteTypeOrder.indexOf(voteType)
    if (i < 0) Int.MaxValue else i
  }

  // "maj_vote" rather than "human": the key one level up says whose majority vote this is, and "human" there means a
  // specific source of votes (every non-AI validator), not admins.
  implicit val aiConcurrenceWrites: Writes[AiConcurrence] = (
    (__ \ "ai_yes_maj_vote_concurs").write[Int] and
      (__ \ "ai_yes_maj_vote_differs").write[Int] and
      (__ \ "ai_no_maj_vote_differs").write[Int] and
      (__ \ "ai_no_maj_vote_concurs").write[Int]
  )(unlift(AiConcurrence.unapply))
}

/**
 * Validation stats for a single source of votes (combined = all votes, human = non-AI votes, ai = AI votes).
 *
 * @param nValidations        Raw count of label_validation rows from this source.
 * @param accuracyByLabelType Per-label-type majority-vote breakdown, keyed by label type name plus "Overall".
 */
case class ValidationSourceStats(nValidations: Int, accuracyByLabelType: Map[String, LabelAccuracy]) {

  def toJson: JsObject = JsObject(
    Seq("total_validations" -> JsNumber(nValidations)) ++
      // Turns into { "Overall" -> { "validated" -> ###, ... }, "CurbRamp" -> { "validated" -> ###, ... }, ... }.
      accuracyByLabelType.toSeq.sorted(labelTypeOrdering).map(s => s._1 -> Json.toJson(s._2))
  )
}

case class ValidationStats(
    combined: ValidationSourceStats,
    human: ValidationSourceStats,
    ai: ValidationSourceStats
)

case class ProjectSidewalkStats(
    launchDate: String,
    avgTimestampLast100Labels: Option[OffsetDateTime],
    kmExplored: Double,
    kmExploreNoOverlap: Double,
    kmExploredMultipleUsers: Double,
    kmExploredSingleUser: Double,
    kmNeedsReaudit: Double,
    kmOpen: Double,
    kmNoImagery: Double,
    kmClosed: Double,
    kmDisabled: Double,
    nUsers: Int,
    nExplorers: Int,
    nValidators: Int,
    nRegistered: Int,
    nAnon: Int,
    nTurker: Int,
    nResearcher: Int,
    nLabels: Int,
    nLabelsWithSeverity: Int,
    avgLabelTimestamp: Option[OffsetDateTime],
    avgImageAgeByLabel: Option[Duration],
    stddevLabelTimestamp: Option[Duration],
    stddevImageAgeByLabel: Option[Duration],
    severityByLabelType: Map[String, LabelSevStats],
    validations: ValidationStats,
    aiPerformance: Map[String, Map[String, AiConcurrence]]
) {

  def toJson: JsObject = {
    Json.obj(
      "launch_date" -> launchDate,
      "km_explored" -> kmExplored,
      // The no_overlap/multiple/single km count every completed audit regardless of imagery age. km_needs_reaudit is
      // the subset of no_overlap whose completed audits all predate newer imagery (#4384), so km on current imagery =
      // no_overlap − needs_reaudit. km_explored keeps counting all completed audits (total work done, with overlap).
      "km_explored_no_overlap"     -> kmExploreNoOverlap,
      "km_explored_multiple_users" -> kmExploredMultipleUsers,
      "km_explored_single_user"    -> kmExploredSingleUser,
      "km_needs_reaudit"           -> kmNeedsReaudit,
      // `km_explorable` is the auditable-now network (status = open). A street can be audited and later become
      // closed/no_imagery, so km_explored_no_overlap is NOT bounded by km_explorable.
      "km_explorable" -> kmOpen,
      "km_by_status"  -> Json.obj(
        "open"       -> kmOpen,
        "no_imagery" -> kmNoImagery,
        "closed"     -> kmClosed,
        "disabled"   -> kmDisabled
      ),
      "user_counts" -> Json.obj(
        "all_users"  -> nUsers,
        "labelers"   -> nExplorers,
        "validators" -> nValidators,
        "registered" -> nRegistered,
        "anonymous"  -> nAnon,
        "turker"     -> nTurker,
        "researcher" -> nResearcher
      ),
      "labels" -> JsObject(
        Seq(
          // Named to match the same two measures on each label type below.
          ("count", JsNumber(nLabels)),
          ("count_with_severity", JsNumber(nLabelsWithSeverity)),
          ("avg_label_timestamp", avgLabelTimestamp.map(t => JsString(t.toString)).getOrElse(JsNull)),
          (
            "avg_timestamp_last_100_labels",
            avgTimestampLast100Labels.map(t => JsString(t.toString)).getOrElse(JsNull)
          ),
          (
            "avg_age_of_image_when_labeled",
            avgImageAgeByLabel.map(avgImgAge => JsString(s"${avgImgAge.toDays} days")).getOrElse(JsNull)
          ),
          ("stddev_label_timestamp", stddevLabelTimestamp.map(sd => JsString(s"${sd.toDays} days")).getOrElse(JsNull)),
          (
            "stddev_age_of_image_when_labeled",
            stddevImageAgeByLabel.map(sd => JsString(s"${sd.toDays} days")).getOrElse(JsNull)
          )
        ) ++
          // Turns into { "CurbRamp" -> { "count" -> ###, ... }, ... }.
          severityByLabelType.toSeq.sorted(labelTypeOrdering).map(stats => stats._1 -> Json.toJson(stats._2))
      ),
      // Validation stats are split three ways. "combined" includes both human and AI votes (AI votes are baked into
      // the label table's agree/disagree/correct counts); "human" and "ai" isolate each source via the validator role.
      "validations" -> Json.obj(
        "combined" -> validations.combined.toJson,
        "human"    -> validations.human.toJson,
        "ai"       -> validations.ai.toJson
      ),
      "ai_stats" -> JsObject(
        // { "Overall" -> "human_maj_vote" -> { "ai_yes_maj_vote_concurs": ###, ... }, ... }, "CurbRamp" -> {...},...}.
        aiPerformance.toSeq.sorted(labelTypeOrdering).map { case (lType, statsMap) =>
          lType -> JsObject(
            statsMap.toSeq.sorted(AiConcurrence.voteTypeOrdering).map(stats => stats._1 -> Json.toJson(stats._2))
          )
        }
      )
    )
  }

  /** @return One "key,value" line per stat, each key the value's dotted path through the JSON (#3871, #4320). */
  def toCsvRows: Seq[String] = toCsvKeyValueRows(toJson)
}

object ProjectSidewalkStats {
  val csvHeader: String = "metric,value"

}
