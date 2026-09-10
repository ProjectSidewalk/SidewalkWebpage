package models.api

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsNull, JsObject, JsValue}

import java.time.Duration

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/overallStats` JSON and CSV shapes.
 *
 * Guards the breaking response-shape change from #4223: the `validations` block splits into combined/human/ai. This
 * is the kind of regression the compiler cannot catch — a serialization-shape change is invisible to the type system.
 */
class OverallStatsApiModelsSpec extends AnyFunSuite with Matchers {

  /** Builds a ProjectSidewalkStats with distinct combined/human/ai values so the test can tell the blocks apart. */
  private def sampleStats: ProjectSidewalkStats = {
    def source(
        total: Int,
        overall: LabelAccuracy,
        curbRamp: LabelAccuracy,
        other: LabelAccuracy
    ): ValidationSourceStats =
      ValidationSourceStats(
        nValidations = total,
        accuracyByLabelType = Map("Overall" -> overall, "CurbRamp" -> curbRamp, "Other" -> other)
      )

    ProjectSidewalkStats(
      launchDate = "2021-06-15",
      avgTimestampLast100Labels = None,
      kmExplored = 10.0,
      kmExploreNoOverlap = 8.0,
      kmExploredMultipleUsers = 3.0,
      kmExploredSingleUser = 5.0, // 8.0 no-overlap − 3.0 multiple
      kmNeedsReaudit = 1.5,
      kmOpen = 12.0,
      kmNoImagery = 1.0,
      kmClosed = 0.5,
      kmDisabled = 0.2,
      nUsers = 5,
      nExplorers = 4,
      nValidators = 3,
      nRegistered = 2,
      nAnon = 1,
      nTurker = 0,
      nResearcher = 1,
      nLabels = 50,
      nLabelsWithSeverity = 40,
      avgLabelTimestamp = None,
      avgImageAgeByLabel = None,
      stddevLabelTimestamp = Some(Duration.ofDays(120)),
      stddevImageAgeByLabel = Some(Duration.ofDays(365)),
      severityByLabelType = Map("CurbRamp" -> LabelSevStats(30, Some(25), Some(1.2), Some(0.5))),
      validations = ValidationStats(
        // "Other" has accuracy = None on purpose, so the null-accuracy assertions have something to bite on.
        combined = source(
          100,
          LabelAccuracy(80, 70, 10, Some(0.875), 90),
          LabelAccuracy(40, 38, 2, Some(0.95), 45),
          LabelAccuracy(0, 0, 0, None, 0)
        ),
        human = source(
          90,
          LabelAccuracy(72, 63, 9, Some(0.875), 81),
          LabelAccuracy(36, 34, 2, Some(0.944), 40),
          LabelAccuracy(0, 0, 0, None, 0)
        ),
        ai = source(
          10,
          LabelAccuracy(8, 7, 1, Some(0.875), 9),
          LabelAccuracy(4, 4, 0, Some(1.0), 5),
          LabelAccuracy(0, 0, 0, None, 0)
        )
      ),
      // Inserted CurbRamp-before-Overall and admin-before-human so the ordering test can't pass on insertion order.
      aiPerformance = Map(
        "CurbRamp" -> Map(
          "admin_majority_vote" -> AiConcurrence(4, 3, 2, 1),
          "human_majority_vote" -> AiConcurrence(8, 7, 6, 5)
        ),
        "Overall" -> Map(
          "admin_majority_vote" -> AiConcurrence(40, 30, 20, 10),
          "human_majority_vote" -> AiConcurrence(80, 70, 60, 50)
        )
      )
    )
  }

  test("overallStats validations block splits into combined/human/ai, each with total + per-type accuracy") {
    val json: JsValue        = sampleStats.toJson
    val validations: JsValue = (json \ "validations").get

    (validations.as[JsObject].keys) shouldBe Set("combined", "human", "ai")

    (validations \ "combined" \ "total_validations").as[Int] shouldBe 100
    (validations \ "human" \ "total_validations").as[Int] shouldBe 90
    (validations \ "ai" \ "total_validations").as[Int] shouldBe 10

    // Combined Overall block carries the full LabelAccuracy field set.
    val combinedOverall = validations \ "combined" \ "Overall"
    (combinedOverall \ "validated").as[Int] shouldBe 80
    (combinedOverall \ "agreed").as[Int] shouldBe 70
    (combinedOverall \ "disagreed").as[Int] shouldBe 10
    (combinedOverall \ "accuracy").as[Double] shouldBe 0.875
    (combinedOverall \ "has_a_validation").as[Int] shouldBe 90

    // Sources are genuinely distinct (the whole point of #4223).
    (validations \ "ai" \ "CurbRamp" \ "accuracy").as[Double] shouldBe 1.0
    (validations \ "human" \ "CurbRamp" \ "agreed").as[Int] shouldBe 34
  }

  test("old flat validations shape is gone (breaking-change guard)") {
    val json = sampleStats.toJson
    // Pre-#4223 these lived directly under `validations`; they must now only exist under a source block.
    (json \ "validations" \ "Overall").toOption shouldBe None
    (json \ "validations" \ "total_validations").toOption shouldBe None
  }

  test("km-by-status + redundant-coverage km serialize, with km_explorable aliasing the open bucket (#3080)") {
    val json = sampleStats.toJson
    (json \ "km_explored_multiple_users").as[Double] shouldBe 3.0
    (json \ "km_explored_single_user").as[Double] shouldBe 5.0
    (json \ "km_needs_reaudit").as[Double] shouldBe 1.5
    (json \ "km_explorable").as[Double] shouldBe 12.0
    (json \ "km_by_status" \ "open").as[Double] shouldBe 12.0
    (json \ "km_by_status" \ "no_imagery").as[Double] shouldBe 1.0
    (json \ "km_by_status" \ "closed").as[Double] shouldBe 0.5
    (json \ "km_by_status" \ "disabled").as[Double] shouldBe 0.2
  }

  test("stddev of label/image dates serialize as day-valued durations (#3031)") {
    val labels = sampleStats.toJson \ "labels"
    (labels \ "stddev_label_timestamp").as[String] shouldBe "120 days"
    (labels \ "stddev_age_of_image_when_labeled").as[String] shouldBe "365 days"
  }

  test("a label type with no validations keeps every key, with a null accuracy") {
    val json  = sampleStats.toJson
    val other = json \ "validations" \ "combined" \ "Other"
    (other \ "accuracy").get shouldBe JsNull
    (other \ "validated").as[Int] shouldBe 0
    (other \ "has_a_validation").as[Int] shouldBe 0

    sampleStats.toCsvRows should contain("validations.combined.Other.accuracy,")
  }

  test("CSV keys are the dotted JSON path of the value they carry (#3871, #4320)") {
    val rows = sampleStats.toCsvRows

    rows.head shouldBe "launch_date,2021-06-15"
    rows should contain("km_explored,10.0")
    rows should contain("km_needs_reaudit,1.5")
    rows should contain("km_by_status.open,12.0")
    rows should contain("user_counts.registered,2")
    rows should contain("labels.count,50")
    rows should contain("labels.stddev_label_timestamp,120 days")
    rows should contain("labels.CurbRamp.severity_stddev,0.5")

    rows should contain("validations.combined.total_validations,100")
    rows should contain("validations.human.total_validations,90")
    rows should contain("validations.ai.total_validations,10")
    rows should contain("validations.combined.CurbRamp.validated,40")

    rows should contain("labels.avg_label_timestamp,") // A missing value is an empty cell.
  }

  test("every CSV key names a real path into the JSON, and vice versa (#4320)") {
    def jsonPaths(prefix: String, value: JsValue): Seq[String] = value match {
      case obj: JsObject =>
        obj.fields.toSeq.flatMap { case (key, v) => jsonPaths(if (prefix.isEmpty) key else s"$prefix.$key", v) }
      case _ => Seq(prefix)
    }

    sampleStats.toCsvRows.map(_.split(",", 2).head) shouldBe jsonPaths("", sampleStats.toJson)
  }

  test("ai_stats orders label types and vote types the same way in JSON and CSV") {
    val aiStats = (sampleStats.toJson \ "ai_stats").as[JsObject]
    aiStats.fields.map(_._1) shouldBe Seq("Overall", "CurbRamp")
    (aiStats \ "Overall").as[JsObject].fields.map(_._1) shouldBe Seq("human_majority_vote", "admin_majority_vote")

    val rows         = sampleStats.toCsvRows
    val overallHuman = rows.indexOf("ai_stats.Overall.human_majority_vote.ai_yes_maj_vote_concurs,80")
    overallHuman should be >= 0
    overallHuman should be < rows.indexOf("ai_stats.Overall.admin_majority_vote.ai_yes_maj_vote_concurs,40")
    overallHuman should be < rows.indexOf("ai_stats.CurbRamp.human_majority_vote.ai_yes_maj_vote_concurs,8")
  }
}
