/**
 * Models for the Project Sidewalk overall stats API (/v3/api/overallStats): one city-wide snapshot of exploration,
 * user, label, validation, and AI-performance counts.
 */
package models.api

import models.api.ApiModelUtils.{labelTypeOrdering, toSnakeKey}
import play.api.libs.functional.syntax._
import play.api.libs.json._

import java.time.{Duration, OffsetDateTime}

case class LabelSevStats(n: Int, nWithSeverity: Option[Int], severityMean: Option[Double], severitySD: Option[Double])

object LabelSevStats {
  implicit val labelSevStatsWrites: Writes[LabelSevStats] = (
    (__ \ "count").write[Int] and
      (__ \ "count_with_severity").write[Option[Int]] and
      (__ \ "severity_mean").write[Option[Double]] and
      (__ \ "severity_sd").write[Option[Double]]
  )(unlift(LabelSevStats.unapply))
}

case class LabelAccuracy(n: Int, nAgree: Int, nDisagree: Int, accuracy: Option[Double], nWithValidation: Int)

object LabelAccuracy {
  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      (__ \ "accuracy").writeNullable[Double] and
      (__ \ "has_a_validation").write[Int]
  )(unlift(LabelAccuracy.unapply))
}

case class AiConcurrence(aiYesHumanConcurs: Int, aiYesHumanDiffers: Int, aiNoHumanDiffers: Int, aiNoHumanConcurs: Int)

object AiConcurrence {
  private val voteTypeOrder: Seq[String] = Seq("human_majority_vote", "admin_majority_vote")

  /**
   * Sorts (vote type, _) pairs of an `ai_stats` inner map. Unrecognized keys sort last rather than being dropped.
   */
  val voteTypeOrdering: Ordering[(String, Any)] = Ordering.by { case (voteType, _) =>
    val i = voteTypeOrder.indexOf(voteType)
    if (i < 0) Int.MaxValue else i
  }

  implicit val aiConcurrenceWrites: Writes[AiConcurrence] = (
    (__ \ "ai_yes_human_concurs").write[Int] and
      (__ \ "ai_yes_human_differs").write[Int] and
      (__ \ "ai_no_human_differs").write[Int] and
      (__ \ "ai_no_human_concurs").write[Int]
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
    Seq("total_validations" -> JsNumber(nValidations.toDouble)) ++
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
      "launch_date"                   -> launchDate,
      "avg_timestamp_last_100_labels" -> avgTimestampLast100Labels.map(_.toString),
      "km_explored"                   -> kmExplored,
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
          ("label_count", JsNumber(nLabels.toDouble)),
          ("label_count_with_severity", JsNumber(nLabelsWithSeverity.toDouble)),
          ("avg_label_timestamp", avgLabelTimestamp.map(t => JsString(t.toString)).getOrElse(JsNull)),
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
        // { "Overall" -> "human_maj_vote" -> { "ai_yes_human_concurs": ###, ... }, ... }, "CurbRamp" -> { ... }, ... }.
        aiPerformance.toSeq.sorted(labelTypeOrdering).map { case (lType, statsMap) =>
          lType -> JsObject(
            statsMap.toSeq.sorted(AiConcurrence.voteTypeOrdering).map(stats => stats._1 -> Json.toJson(stats._2))
          )
        }
      )
    )
  }

  /**
   * One response is a single object rather than a series of records, so the CSV is a vertical listing rather than a
   * header plus data rows.
   *
   * @return One "snake_case_key,value" line per stat (#3871), in the same order as the JSON.
   */
  def toCsvRows: Seq[String] = {
    def row(label: String, value: Any): String = s"${toSnakeKey(label)},$value"

    val topLevelRows: Seq[String] = Seq(
      row("Launch Date", launchDate),
      row("Recent Labels Average Timestamp", avgTimestampLast100Labels.getOrElse("NA")),
      row("KM Explored", kmExplored),
      row("KM Explored Without Overlap", kmExploreNoOverlap),
      row("KM Explored Multiple Users", kmExploredMultipleUsers),
      row("KM Explored Single User", kmExploredSingleUser),
      row("KM Needs Reaudit", kmNeedsReaudit),
      row("KM Explorable", kmOpen), // Auditable-now network (status = open); alias of KM Open below.
      row("KM Open", kmOpen),
      row("KM No Imagery", kmNoImagery),
      row("KM Closed", kmClosed),
      row("KM Disabled", kmDisabled),
      row("Total User Count", nUsers),
      row("Explore User Count", nExplorers),
      row("Validate User Count", nValidators),
      row("Registered User Count", nRegistered),
      row("Anonymous User Count", nAnon),
      row("Turker User Count", nTurker),
      row("Researcher User Count", nResearcher),
      row("Total Label Count", nLabels),
      row("Total Label Count With Severity", nLabelsWithSeverity),
      row("Average Label Timestamp", avgLabelTimestamp.getOrElse("NA")),
      row("Average Age of Image When Labeled", avgImageAgeByLabel.map(avg => s"${avg.toDays} Days").getOrElse("NA")),
      row("Stddev Label Timestamp", stddevLabelTimestamp.map(sd => s"${sd.toDays} Days").getOrElse("NA")),
      row("Stddev Age of Image When Labeled", stddevImageAgeByLabel.map(sd => s"${sd.toDays} Days").getOrElse("NA"))
    )

    val severityRows: Seq[String] =
      severityByLabelType.toSeq.sorted(labelTypeOrdering).flatMap { case (labType, sevStats) =>
        Seq(
          row(s"$labType Count", sevStats.n),
          row(s"$labType Count With Severity", sevStats.nWithSeverity.getOrElse("NA")),
          row(s"$labType Severity Mean", sevStats.severityMean.map(_.toString).getOrElse("NA")),
          row(s"$labType Severity SD", sevStats.severitySD.map(_.toString).getOrElse("NA"))
        )
      }

    val validationRows: Seq[String] =
      Seq(("Combined", validations.combined), ("Human", validations.human), ("AI", validations.ai)).flatMap {
        case (srcLabel, srcStats) =>
          row(s"$srcLabel Total Validations", srcStats.nValidations) +:
            srcStats.accuracyByLabelType.toSeq.sorted(labelTypeOrdering).flatMap { case (labType, accStats) =>
              Seq(
                row(s"$srcLabel $labType Labels Validated", accStats.n),
                row(s"$srcLabel $labType Agreed Count", accStats.nAgree),
                row(s"$srcLabel $labType Disagreed Count", accStats.nDisagree),
                row(s"$srcLabel $labType Accuracy", accStats.accuracy.map(_.toString).getOrElse("NA")),
                row(s"$srcLabel $labType Labels With a Validation", accStats.nWithValidation)
              )
            }
      }

    val aiRows: Seq[String] = aiPerformance.toSeq.sorted(labelTypeOrdering).flatMap { case (labelType, aiStatsMap) =>
      aiStatsMap.toSeq.sorted(AiConcurrence.voteTypeOrdering).flatMap { case (voteType, aiStats) =>
        val voteTypeText: String =
          if (voteType == "human_majority_vote") "Human Majority Vote" else "Admin Majority Vote"
        Seq(
          row(s"$labelType AI Yes and $voteTypeText Concurs", aiStats.aiYesHumanConcurs),
          row(s"$labelType AI Yes but $voteTypeText Differs", aiStats.aiYesHumanDiffers),
          row(s"$labelType AI No but $voteTypeText Differs", aiStats.aiNoHumanDiffers),
          row(s"$labelType AI No and $voteTypeText Concurs", aiStats.aiNoHumanConcurs)
        )
      }
    }

    topLevelRows ++ severityRows ++ validationRows ++ aiRows
  }
}
