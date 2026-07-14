package models.api

import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import org.scalatest.OptionValues
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.JsObject

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/rawLabels` `pano_url` field (#3853).
 *
 * Locks the provider-aware behavior the compiler can't see: GSV labels get Google's documented Maps URLs link,
 * Mapillary labels get a Mapillary web-app link, and providers with no shareable viewer (infra3d) get `null` in JSON
 * and an empty CSV column. Also guards that the GSV URL carries no API key and matches the in-app `PanoInfoPopover.js`
 * shape (`map_action=pano`, label heading/pitch passed through unchanged).
 */
class LabelApiModelsSpec extends AnyFunSuite with Matchers with OptionValues {

  /** A label fixture parameterized by imagery provider and view angles; all other fields are arbitrary but valid. */
  private def sampleLabel(
      source: PanoSource,
      heading: Option[Double] = Some(94.3114318847656),
      pitch: Option[Double] = Some(-24.6774997711182)
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
    streetEdgeId = 951,
    osmWayId = 11584845L,
    regionId = 1,
    regionName = "Teaneck",
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
}
