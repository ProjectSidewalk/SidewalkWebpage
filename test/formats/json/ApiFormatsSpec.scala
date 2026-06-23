package formats.json

import models.label.{LabelAccuracy, ProjectSidewalkStats, ValidationSourceStats, ValidationStats}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsObject, JsValue}

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/overallStats` JSON shape.
 *
 * Guards the breaking response-shape change from #4223: the `validations` block splits into combined/human/ai. This
 * is the kind of regression the compiler cannot catch — a JSON-shape change is invisible to the type system.
 */
class ApiFormatsSpec extends AnyFunSuite with Matchers {

  /** Builds a ProjectSidewalkStats with distinct combined/human/ai values so the test can tell the blocks apart. */
  private def sampleStats: ProjectSidewalkStats = {
    def source(total: Int, overall: LabelAccuracy, curbRamp: LabelAccuracy, other: LabelAccuracy): ValidationSourceStats =
      ValidationSourceStats(
        nValidations = total,
        accuracyByLabelType = Map("Overall" -> overall, "CurbRamp" -> curbRamp, "Other" -> other)
      )

    ProjectSidewalkStats(
      launchDate = "2021-06-15",
      avgTimestampLast100Labels = None,
      kmExplored = 10.0,
      kmExploreNoOverlap = 8.0,
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
      severityByLabelType = Map.empty,
      validations = ValidationStats(
        // "Other" has accuracy = None on purpose, to assert the null-accuracy key is omitted (writeNullable behavior).
        combined =
          source(100, LabelAccuracy(80, 70, 10, Some(0.875), 90), LabelAccuracy(40, 38, 2, Some(0.95), 45),
            LabelAccuracy(0, 0, 0, None, 0)),
        human =
          source(90, LabelAccuracy(72, 63, 9, Some(0.875), 81), LabelAccuracy(36, 34, 2, Some(0.944), 40),
            LabelAccuracy(0, 0, 0, None, 0)),
        ai =
          source(10, LabelAccuracy(8, 7, 1, Some(0.875), 9), LabelAccuracy(4, 4, 0, Some(1.0), 5),
            LabelAccuracy(0, 0, 0, None, 0))
      ),
      aiPerformance = Map.empty
    )
  }

  test("overallStats validations block splits into combined/human/ai, each with total + per-type accuracy") {
    val json: JsValue        = ApiFormats.projectSidewalkStatsToJson(sampleStats)
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
    val json = ApiFormats.projectSidewalkStatsToJson(sampleStats)
    // Pre-#4223 these lived directly under `validations`; they must now only exist under a source block.
    (json \ "validations" \ "Overall").toOption shouldBe None
    (json \ "validations" \ "total_validations").toOption shouldBe None
  }

  test("null accuracy is omitted, but the other fields remain") {
    val json  = ApiFormats.projectSidewalkStatsToJson(sampleStats)
    val other = json \ "validations" \ "combined" \ "Other"
    (other \ "accuracy").toOption shouldBe None
    (other \ "validated").as[Int] shouldBe 0
    (other \ "has_a_validation").as[Int] shouldBe 0
  }
}
