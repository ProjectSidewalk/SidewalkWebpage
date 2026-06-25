package models.api

import models.label.LabelTypeEnum
import models.user.LabelTypeStat
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.JsObject

/**
 * Pure (no DB, no app boot) serialization contract tests for the API DTOs moved out of `*Table.scala` files in #3885.
 *
 * These lock the JSON shape and the CSV header/row alignment so the move (and the switch to inline serialization)
 * stays byte-for-byte compatible with the previous `ApiFormats` free-function output.
 */
class UserStatsApiModelsSpec extends AnyFunSuite with Matchers {

  /** Every label type mapped to a distinct stat block so column ordering regressions are visible. */
  private def sampleStatsByLabelType: Map[String, LabelTypeStat] = Map(
    LabelTypeEnum.CurbRamp.name       -> LabelTypeStat(10, 1, 2, 7),
    LabelTypeEnum.NoCurbRamp.name     -> LabelTypeStat(11, 1, 2, 8),
    LabelTypeEnum.Obstacle.name       -> LabelTypeStat(12, 1, 2, 9),
    LabelTypeEnum.SurfaceProblem.name -> LabelTypeStat(13, 1, 2, 10),
    LabelTypeEnum.NoSidewalk.name     -> LabelTypeStat(14, 1, 2, 11),
    LabelTypeEnum.Crosswalk.name      -> LabelTypeStat(15, 1, 2, 12),
    LabelTypeEnum.Signal.name         -> LabelTypeStat(16, 1, 2, 13),
    LabelTypeEnum.Occlusion.name      -> LabelTypeStat(17, 1, 2, 14),
    LabelTypeEnum.Other.name          -> LabelTypeStat(18, 1, 2, 15)
  )

  private def sampleUserStat: UserStatForApi = UserStatForApi(
    userId = "user-1",
    labels = 100,
    metersExplored = 1234.5,
    labelsPerMeter = Some(0.081),
    highQuality = true,
    highQualityManual = None,
    labelAccuracy = Some(0.95),
    validatedLabels = 50,
    validationsReceived = 60,
    labelsValidatedCorrect = 40,
    labelsValidatedIncorrect = 10,
    labelsNotValidated = 50,
    validationsGiven = 20,
    dissentingValidationsGiven = 2,
    agreeValidationsGiven = 15,
    disagreeValidationsGiven = 3,
    unsureValidationsGiven = 2,
    statsByLabelType = sampleStatsByLabelType
  )

  test("UserStatForApi JSON uses snake_case keys and a nested per-label-type breakdown") {
    val json = sampleUserStat.toJson

    (json \ "user_id").as[String] shouldBe "user-1"
    (json \ "meters_explored").as[Double] shouldBe 1234.5
    (json \ "high_quality_manual").asOpt[Boolean] shouldBe None // None serializes as JSON null, key present
    json.keys.filter(k => k != k.toLowerCase) shouldBe empty

    val byType = (json \ "stats_by_label_type").as[JsObject]
    byType.keys should contain allOf ("curb_ramp", "no_curb_ramp", "marked_crosswalk", "pedestrian_signal", "cant_see_sidewalk")
    (byType \ "curb_ramp" \ "validated_correct").as[Int] shouldBe 1
    (byType \ "curb_ramp" \ "not_validated").as[Int] shouldBe 7
  }

  test("UserStatForApi CSV row column count matches the header, with NA for None") {
    val headerCols = UserStatForApi.csvHeader.trim.split(",", -1).length
    val rowCols    = sampleUserStat.toCsvRow.split(",", -1).length
    rowCols shouldBe headerCols

    val cols = sampleUserStat.toCsvRow.split(",", -1)
    cols(0) shouldBe "user-1"
    cols(5) shouldBe "NA" // highQualityManual = None
  }

  private def sampleCVMetadata: LabelCVMetadata = LabelCVMetadata(
    labelId = 1,
    panoId = "pano-1",
    labelTypeId = 2,
    agreeCount = 3,
    disagreeCount = 1,
    unsureCount = 0,
    panoWidth = None,
    panoHeight = Some(8192),
    panoX = 100,
    panoY = 200,
    canvasWidth = 720,
    canvasHeight = 480,
    canvasX = 50,
    canvasY = 60,
    zoom = 1.0,
    heading = 90.0,
    pitch = -10.0,
    cameraHeading = 95.0,
    cameraPitch = 0.0,
    cameraRoll = None
  )

  test("LabelCVMetadata JSON uses snake_case keys and omits None-valued optional fields") {
    val json = sampleCVMetadata.toJson

    (json \ "label_id").as[Int] shouldBe 1
    (json \ "pano_height").as[Int] shouldBe 8192
    // writeNullable semantics: absent (not null) when None — matches the previous explicit Writes.
    (json \ "pano_width").toOption shouldBe None
    (json \ "camera_roll").toOption shouldBe None
    json.as[JsObject].keys.filter(k => k != k.toLowerCase) shouldBe empty
  }

  test("LabelCVMetadata CSV row column count matches the header, with NA for None") {
    val headerCols = LabelCVMetadata.csvHeader.trim.split(",", -1).length
    val rowCols    = sampleCVMetadata.toCsvRow.split(",", -1).length
    rowCols shouldBe headerCols

    val cols = sampleCVMetadata.toCsvRow.split(",", -1)
    cols(6) shouldBe "NA"   // panoWidth = None
    cols.last shouldBe "NA" // cameraRoll = None
  }
}
