/**
 * Models for the Project Sidewalk Daily Stats API endpoints
 * (/v3/api/overallStatsByDay and /v3/api/aggregateStatsByDay). (#4274)
 */
package models.api

import play.api.libs.json.OWrites

import java.time.LocalDate

/**
 * A single record in the daily label-and-validation time series.
 *
 * Each record covers one calendar day (in US/Pacific time) and one label type. Label counts are
 * bucketed by label.time_created; validation counts are bucketed by label_validation.end_timestamp.
 * The two date dimensions are independent: on a given day a city may place many labels and also
 * validate labels that were placed on earlier days.
 *
 * @param date                       The calendar date (Pacific time).
 * @param labelType                  Label type name (e.g. "CurbRamp", "NoCurbRamp").
 * @param humanLabels                Labels placed by human users on this date.
 * @param aiLabels                   Labels placed by AI users on this date.
 * @param humanValidationsAgree      Human validations with result "agree" completed on this date.
 * @param humanValidationsDisagree   Human validations with result "disagree" completed on this date.
 * @param humanValidationsUnsure     Human validations with result "unsure" completed on this date.
 * @param aiValidationsAgree         AI validations with result "agree" completed on this date.
 * @param aiValidationsDisagree      AI validations with result "disagree" completed on this date.
 * @param aiValidationsUnsure        AI validations with result "unsure" completed on this date.
 */
case class DailyStatRecord(
    date: LocalDate,
    labelType: String,
    humanLabels: Int,
    aiLabels: Int,
    humanValidationsAgree: Int,
    humanValidationsDisagree: Int,
    humanValidationsUnsure: Int,
    aiValidationsAgree: Int,
    aiValidationsDisagree: Int,
    aiValidationsUnsure: Int
)

object DailyStatRecord extends ApiFields[DailyStatRecord] {
  import ApiFields.field

  override val fields: Seq[ApiField[DailyStatRecord]] = Seq(
    field("date")(_.date.toString),
    field("label_type")(_.labelType),
    field("human_labels")(_.humanLabels),
    field("ai_labels")(_.aiLabels),
    field("human_validations_agree")(_.humanValidationsAgree),
    field("human_validations_disagree")(_.humanValidationsDisagree),
    field("human_validations_unsure")(_.humanValidationsUnsure),
    field("ai_validations_agree")(_.aiValidationsAgree),
    field("ai_validations_disagree")(_.aiValidationsDisagree),
    field("ai_validations_unsure")(_.aiValidationsUnsure)
  )

  implicit val writes: OWrites[DailyStatRecord] = (record: DailyStatRecord) => toJson(record)

  /**
   * Merges label-stat and validation-stat rows (each keyed by date + label_type) into one unified
   * sequence of DailyStatRecord. Either sequence may have keys the other lacks; missing entries are
   * filled with zeros.
   *
   * @param labels      Rows from the labels-by-day query: (date, labelType, humanLabels, aiLabels).
   * @param validations Rows from the validations-by-day query: (date, labelType, humanAgree,
   *                    humanDisagree, humanUnsure, aiAgree, aiDisagree, aiUnsure).
   * @return            Merged sequence sorted by date then label type.
   */
  def merge(
      labels: Seq[(LocalDate, String, Int, Int)],
      validations: Seq[(LocalDate, String, Int, Int, Int, Int, Int, Int)]
  ): Seq[DailyStatRecord] = {
    val labelMap      = labels.map(r => (r._1, r._2) -> (r._3, r._4)).toMap
    val validationMap = validations.map(r => (r._1, r._2) -> (r._3, r._4, r._5, r._6, r._7, r._8)).toMap
    (labelMap.keySet ++ validationMap.keySet).toSeq.sortBy(k => (k._1, k._2)).map { key =>
      val (date, labelType)        = key
      val (humanLabels, aiLabels)  = labelMap.getOrElse(key, (0, 0))
      val (ha, hd, hu, aa, ad, au) = validationMap.getOrElse(key, (0, 0, 0, 0, 0, 0))
      DailyStatRecord(date, labelType, humanLabels, aiLabels, ha, hd, hu, aa, ad, au)
    }
  }
}
