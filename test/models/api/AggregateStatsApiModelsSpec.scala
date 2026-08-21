package models.api

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/aggregateStats` JSON and CSV shapes.
 *
 * Locks the v3 snake_case naming convention (#3871) for both formats, which are serialized independently and so can
 * drift apart without the compiler noticing.
 */
class AggregateStatsApiModelsSpec extends AnyFunSuite with Matchers {

  private def sampleStats: AggregateStats = AggregateStats(
    kmExplored = 1000.5,
    kmExploredNoOverlap = 800.25,
    totalLabels = 300,
    tutorialLabels = 40,
    totalValidations = 250,
    totalUsers = 60,
    numCities = 12,
    numCountries = 5,
    numLanguages = 8,
    byLabelType = Map("CurbRamp" -> LabelTypeStats(200, 150, 140, 10), "NoSidewalk" -> LabelTypeStats(100, 50, 45, 5))
  )

  test("JSON uses snake_case keys and nests per-label-type counts under by_label_type") {
    val json = sampleStats.toJson

    (json \ "status").as[String] shouldBe "OK"
    (json \ "km_explored").as[Double] shouldBe 1000.5
    (json \ "km_explored_no_overlap").as[Double] shouldBe 800.25
    (json \ "total_labels").as[Int] shouldBe 300
    (json \ "tutorial_labels").as[Int] shouldBe 40
    (json \ "total_validations").as[Int] shouldBe 250
    (json \ "total_users").as[Int] shouldBe 60
    (json \ "num_cities").as[Int] shouldBe 12
    (json \ "num_countries").as[Int] shouldBe 5
    (json \ "num_languages").as[Int] shouldBe 8

    val curbRamp = json \ "by_label_type" \ "CurbRamp"
    (curbRamp \ "labels").as[Int] shouldBe 200
    (curbRamp \ "labels_validated").as[Int] shouldBe 150
    (curbRamp \ "labels_validated_agree").as[Int] shouldBe 140
    (curbRamp \ "labels_validated_disagree").as[Int] shouldBe 10
  }

  test("CSV is snake_case key/value rows under a metric,value header") {
    AggregateStats.csvHeader shouldBe "metric,value"

    val rows = sampleStats.toCsvRows
    rows should contain("km_explored,1000.5")
    rows should contain("total_labels,300")
    rows should contain("total_users,60")
    rows should contain("number_of_countries,5")

    // Label type names are split on their camelCase boundary, matching the JSON's per-type block.
    rows should contain("curb_ramp_labels,200")
    rows should contain("no_sidewalk_labels_validated_disagree,5")
  }
}
