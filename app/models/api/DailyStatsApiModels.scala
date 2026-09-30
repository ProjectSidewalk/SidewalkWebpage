/**
 * Models for the Project Sidewalk Daily Stats API endpoints
 * (/v3/api/overallStatsByDay and /v3/api/aggregateStatsByDay). (#4274)
 */
package models.api

import play.api.libs.json.OWrites
import slick.jdbc.GetResult

import java.time.LocalDate

/** One day's label counts for one label type, split by human vs. AI. */
case class DailyLabelStat(date: LocalDate, labelType: String, humanLabels: Int, aiLabels: Int)

object DailyLabelStat {
  given getResult: GetResult[DailyLabelStat] =
    GetResult(r => DailyLabelStat(LocalDate.parse(r.nextString()), r.nextString(), r.nextInt(), r.nextInt()))
}

/** One day's validation counts for one label type, split by human vs. AI and by vote. */
case class DailyValidationStat(
    date: LocalDate,
    labelType: String,
    humanAgree: Int,
    humanDisagree: Int,
    humanUnsure: Int,
    aiAgree: Int,
    aiDisagree: Int,
    aiUnsure: Int
)

object DailyValidationStat {
  given getResult: GetResult[DailyValidationStat] = GetResult(r =>
    DailyValidationStat(LocalDate.parse(r.nextString()), r.nextString(), r.nextInt(), r.nextInt(), r.nextInt(),
      r.nextInt(), r.nextInt(), r.nextInt())
  )
}

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

  given writes: OWrites[DailyStatRecord] = (record: DailyStatRecord) => toJson(record)

  /**
   * Merges label-stat and validation-stat rows (each keyed by date + label_type) into one unified
   * sequence of DailyStatRecord. Either sequence may have keys the other lacks; missing entries are
   * filled with zeros.
   *
   * @param labels      Rows from the labels-by-day query.
   * @param validations Rows from the validations-by-day query.
   * @return            Merged sequence sorted by date then label type.
   */
  def merge(labels: Seq[DailyLabelStat], validations: Seq[DailyValidationStat]): Seq[DailyStatRecord] = {
    val labelMap      = labels.map(l => (l.date, l.labelType) -> l).toMap
    val validationMap = validations.map(v => (v.date, v.labelType) -> v).toMap
    (labelMap.keySet ++ validationMap.keySet).toSeq.sorted.map { case key @ (date, labelType) =>
      val l = labelMap.getOrElse(key, DailyLabelStat(date, labelType, 0, 0))
      val v = validationMap.getOrElse(key, DailyValidationStat(date, labelType, 0, 0, 0, 0, 0, 0))
      DailyStatRecord(date, labelType, l.humanLabels, l.aiLabels, v.humanAgree, v.humanDisagree, v.humanUnsure,
        v.aiAgree, v.aiDisagree, v.aiUnsure)
    }
  }
}
