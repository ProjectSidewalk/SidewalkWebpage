package models.api

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.JsObject

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
    val props = (sampleCluster.toJson \ "properties").as[JsObject]
    val offenders = props.keys.filter(k => k != k.toLowerCase)
    offenders shouldBe empty
  }
}
