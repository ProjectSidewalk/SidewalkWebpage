package models.api

import models.label.StreetSide
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import org.scalatest.OptionValues
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.JsObject

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pure (no DB, no app boot) contract tests for `/v3/api/rawLabels` output fields the compiler can't check.
 *
 * `pano_url` (#3853) is provider-aware: GSV gets Google's documented Maps URLs link (no API key, matching the in-app
 * `PanoInfoPopover.js` shape), Mapillary gets a web-app link, infra3d has no viewer so it is `null` / an empty CSV
 * column. `high_quality_user` (#5067) must reach both JSON and CSV, under the column its header names. `street_side` and
 * `centerline_offset_m` (#2886) are nullable and must round-trip as the enum's string / a JSON null.
 */
class LabelApiModelsSpec extends AnyFunSuite with Matchers with OptionValues {

  /** A label fixture parameterized by imagery provider and view angles; all other fields are arbitrary but valid. */
  private def sampleLabel(
      source: PanoSource,
      heading: Option[Double] = Some(94.3114318847656),
      pitch: Option[Double] = Some(-24.6774997711182),
      streetSide: Option[StreetSide.Value] = Some(StreetSide.Left),
      centerlineOffsetM: Option[Double] = Some(4.25)
  ): LabelDataForApi = LabelDataForApi(
    labelId = 8,
    userId = "user-uuid",
    panoId = "DsCvWstZYz9JL81V9NloOQ",
    panoSource = source,
    labelType = "CurbRamp",
    severity = Some(1),
    tags = List.empty,
    description = None,
    timeCreated = OffsetDateTime.of(2023, 8, 16, 0, 0, 0, 0, ZoneOffset.UTC),
    highQualityUser = true,
    streetEdgeId = 951,
    osmWayId = 11584845L,
    regionId = 1,
    regionName = "Teaneck",
    streetSide = streetSide,
    centerlineOffsetM = centerlineOffsetM,
    latitude = 40.8839912414551,
    longitude = -74.0243606567383,
    correct = Some(true),
    agreeCount = 2,
    disagreeCount = 0,
    unsureCount = 0,
    validations = Seq.empty,
    auditTaskId = Some(6),
    missionId = Some(3),
    imageCaptureDate = Some("2012-08"),
    heading = heading,
    pitch = pitch,
    zoom = Some(2.0),
    canvasX = Some(395),
    canvasY = Some(151),
    canvasWidth = Some(480),
    canvasHeight = Some(720),
    panoX = Some(1781),
    panoY = Some(3980),
    panoWidth = Some(13312),
    panoHeight = Some(6656),
    cameraHeading = Some(228.928619384766),
    cameraPitch = Some(-0.998329997062683),
    cameraRoll = Some(0.888324597068312)
  )

  test("GSV pano_url uses Google's documented Maps URLs format with label heading/pitch and no API key") {
    val url = sampleLabel(PanoSource.Gsv).panoUrl.value

    url shouldBe "https://www.google.com/maps/@?api=1&map_action=pano&pano=DsCvWstZYz9JL81V9NloOQ" +
      "&heading=94.3114318847656&pitch=-24.6774997711182"
    url should not include "key="
    url should not include "signature="
  }

  test("GSV pano_url defaults missing heading/pitch to 0.0") {
    val url = sampleLabel(PanoSource.Gsv, heading = None, pitch = None).panoUrl.value
    url should endWith("&heading=0.0&pitch=0.0")
  }

  test("Mapillary pano_url links to the Mapillary web app by pKey") {
    sampleLabel(PanoSource.Mapillary).panoUrl.value shouldBe
      "https://www.mapillary.com/app/?pKey=DsCvWstZYz9JL81V9NloOQ&focus=photo"
  }

  test("infra3d has no shareable viewer URL (None)") {
    sampleLabel(PanoSource.Infra3d).panoUrl shouldBe None
  }

  test("GeoJSON properties carry pano_url for GSV and null for infra3d") {
    val gsvProps = (sampleLabel(PanoSource.Gsv).toJson \ "properties").as[JsObject]
    (gsvProps \ "pano_url").as[String] should startWith("https://www.google.com/maps/@?api=1")
    (gsvProps \ "image_url").toOption shouldBe None // renamed; old key must not leak

    val infraProps = (sampleLabel(PanoSource.Infra3d).toJson \ "properties").as[JsObject]
    (infraProps \ "pano_url").toOption.map(_.toString) shouldBe Some("null")
  }

  test("CSV row renders the GSV pano_url and an empty column for infra3d") {
    sampleLabel(PanoSource.Gsv).toCsvRow should include("https://www.google.com/maps/@?api=1")

    // pano_url is the antepenultimate column (followed by latitude,longitude); for infra3d it is empty.
    sampleLabel(PanoSource.Infra3d).toCsvRow should endWith(",,40.8839912414551,-74.0243606567383")
  }

  test("high_quality_user reaches GeoJSON properties and the CSV column its header names") {
    val label = sampleLabel(PanoSource.Gsv)
    (label.toJson \ "properties" \ "high_quality_user").as[Boolean] shouldBe true

    val columnIndex = LabelDataForApi.csvHeader.trim.split(",").indexOf("high_quality_user")
    columnIndex should be >= 0
    label.toCsvRow.split(",", -1)(columnIndex) shouldBe "true"
  }

  test("street_side and centerline_offset_m reach GeoJSON properties and their CSV columns, null when unset") {
    val header      = LabelDataForApi.csvHeader.trim.split(",")
    val sideIndex   = header.indexOf("street_side")
    val offsetIndex = header.indexOf("centerline_offset_m")
    sideIndex should be >= 0
    offsetIndex should be >= 0

    val sided = sampleLabel(PanoSource.Gsv)
    (sided.toJson \ "properties" \ "street_side").as[String] shouldBe "left"
    (sided.toJson \ "properties" \ "centerline_offset_m").as[Double] shouldBe 4.25
    sided.toCsvRow.split(",", -1)(sideIndex) shouldBe "left"
    sided.toCsvRow.split(",", -1)(offsetIndex) shouldBe "4.25"

    // Within the floor: the offset is still reported, the side is not.
    val nearLine = sampleLabel(PanoSource.Gsv, streetSide = None, centerlineOffsetM = Some(-0.4))
    (nearLine.toJson \ "properties" \ "street_side").toOption.map(_.toString) shouldBe Some("null")
    (nearLine.toJson \ "properties" \ "centerline_offset_m").as[Double] shouldBe -0.4
    nearLine.toCsvRow.split(",", -1)(sideIndex) shouldBe ""

    val unpositioned = sampleLabel(PanoSource.Gsv, streetSide = None, centerlineOffsetM = None)
    (unpositioned.toJson \ "properties" \ "centerline_offset_m").toOption.map(_.toString) shouldBe Some("null")
    unpositioned.toCsvRow.split(",", -1)(offsetIndex) shouldBe ""
  }
}
