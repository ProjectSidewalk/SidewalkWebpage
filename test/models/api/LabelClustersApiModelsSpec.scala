package models.api

import models.pano.PanoSource
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsObject, Json}

import java.time.OffsetDateTime

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/labelClusters` GeoJSON field names.
 *
 * Guards the v3 naming convention (#3871): all output field names are snake_case. The compiler cannot see a JSON key
 * casing regression, so this locks it — `regionId`/`regionName` previously leaked into the GeoJSON properties while
 * every other key (and the CSV header) was snake_case.
 */
class LabelClustersApiModelsSpec extends AnyFunSuite with Matchers {

  /** A fully-populated cluster (no nested raw labels) so every property key is present to inspect. */
  private def sampleCluster: LabelClusterForApi = LabelClusterForApi(
    labelClusterId = 1,
    labelType = "CurbRamp",
    streetEdgeId = 10,
    osmWayId = 100L,
    regionId = 5,
    regionName = "Downtown",
    avgImageCaptureDate = None,
    avgLabelDate = None,
    medianSeverity = Some(3),
    agreeCount = 2,
    disagreeCount = 1,
    unsureCount = 0,
    clusterSize = 3,
    labelIds = Seq(1, 2, 3),
    userIds = Seq("u1", "u2"),
    tagCounts = Map("missing tactile warning" -> 2),
    labels = None,
    avgLatitude = 47.6,
    avgLongitude = -122.3
  )

  test("region fields are snake_case (region_id/region_name), not camelCase") {
    val props = (sampleCluster.toJson \ "properties").as[JsObject]

    (props \ "region_id").as[Int] shouldBe 5
    (props \ "region_name").as[String] shouldBe "Downtown"
    (props \ "regionId").toOption shouldBe None
    (props \ "regionName").toOption shouldBe None
  }

  test("every GeoJSON property key is snake_case (no uppercase letters)") {
    val props     = (sampleCluster.toJson \ "properties").as[JsObject]
    val offenders = props.keys.filter(k => k != k.toLowerCase)
    offenders shouldBe empty
  }

  /** A raw in-cluster label; panoSource is optional because the cluster query LEFT JOINs pano_data. */
  private def sampleRawLabel(panoSource: Option[PanoSource.PanoSource]): RawLabelInClusterDataForApi =
    RawLabelInClusterDataForApi(
      labelId = 8, userId = "u1", panoId = "abc123", panoSource = panoSource, severity = Some(2),
      timeCreated = OffsetDateTime.parse("2023-08-16T23:47:25Z"), latitude = 47.6, longitude = -122.3,
      correct = Some(true), imageCaptureDate = None
    )

  test("raw label JSON carries snake_case pano_source when known and omits it when unknown") {
    val withSource = Json.toJson(sampleRawLabel(Some(PanoSource.Gsv))).as[JsObject]
    (withSource \ "pano_source").as[String] shouldBe "gsv"
    (withSource \ "panoSource").toOption shouldBe None

    val withoutSource = Json.toJson(sampleRawLabel(None)).as[JsObject]
    (withoutSource \ "pano_source").toOption shouldBe None
  }

  test("raw label CSV rows keep the pano_source column position, empty when the provider is unknown") {
    val header        = RawLabelInClusterDataForApi.csvHeader.trim.split(",")
    val panoSourceIdx = header.indexOf("pano_source")
    panoSourceIdx should be > 0

    val withSource = RawLabelInClusterDataForApi.toCsvRow(1, sampleRawLabel(Some(PanoSource.Gsv))).split(",", -1)
    withSource(panoSourceIdx) shouldBe "gsv"

    val withoutSource = RawLabelInClusterDataForApi.toCsvRow(1, sampleRawLabel(None)).split(",", -1)
    withoutSource(panoSourceIdx) shouldBe ""
    // The row must keep the same column count as the header even with the field empty.
    withoutSource.length shouldBe header.length
  }
}
