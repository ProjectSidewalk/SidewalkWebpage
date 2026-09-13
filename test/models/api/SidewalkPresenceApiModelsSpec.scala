package models.api

import org.locationtech.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsNull, JsObject}

import java.time.OffsetDateTime

/**
 * Pure (no DB, no app boot) contract test for the `/v3/api/sidewalkPresence` field names (#5279).
 *
 * Guards the v3 naming convention (#3871): every output field name is snake_case, and the CSV columns line up with
 * the header, the geometry summarized as start and end points. The compiler cannot see a JSON key casing regression,
 * so this locks it.
 */
class SidewalkPresenceApiModelsSpec extends AnyFunSuite with Matchers {

  private val gf = new GeometryFactory(new PrecisionModel(), 4326)

  private val line =
    gf.createLineString(Array(new Coordinate(-122.3546715, 47.5309889), new Coordinate(-122.3546693, 47.5319025)))

  /** A face called absent, so every property is populated. */
  private def absentFace: SidewalkPresenceForApi = SidewalkPresenceForApi(
    streetEdgeId = 10425, streetSide = "left", osmWayId = 6479562L, regionId = 44, regionName = "Highland Park",
    wayType = "residential", status = "open", presence = "absent", presenceBasis = "no_sidewalk_labels",
    noSidewalkLabelCount = 3, noSidewalkUserCount = 2, labelCount = 5, auditCount = 2,
    firstNoSidewalkLabelDate = Some(OffsetDateTime.parse("2019-11-04T22:31:07Z")),
    lastNoSidewalkLabelDate = Some(OffsetDateTime.parse("2023-02-18T17:05:44Z")), geometry = line
  )

  /** The other side of the same street, with nothing to date. */
  private def presentFace: SidewalkPresenceForApi = absentFace.copy(
    streetSide = "right", presence = "present", presenceBasis = "audited_no_labels", noSidewalkLabelCount = 0,
    noSidewalkUserCount = 0, labelCount = 2, firstNoSidewalkLabelDate = None, lastNoSidewalkLabelDate = None
  )

  test("a face is a GeoJSON Feature carrying the street's LineString") {
    val json = absentFace.toJson
    (json \ "type").as[String] shouldBe "Feature"
    (json \ "geometry" \ "type").as[String] shouldBe "LineString"
    (json \ "geometry" \ "coordinates")(0)(0).as[Double] shouldBe -122.3546715
  }

  test("every GeoJSON property key is snake_case (no uppercase letters)") {
    val props     = (absentFace.toJson \ "properties").as[JsObject]
    val offenders = props.keys.filter(k => k != k.toLowerCase)
    offenders shouldBe empty
    (props \ "street_side").as[String] shouldBe "left"
    (props \ "presence_basis").as[String] shouldBe "no_sidewalk_labels"
    (props \ "no_sidewalk_label_count").as[Int] shouldBe 3
    (props \ "first_no_sidewalk_label_date").as[String] shouldBe "2019-11-04T22:31:07Z"
    (props \ "streetSide").toOption shouldBe None
  }

  test("a face without NoSidewalk labels carries null dates, not missing keys") {
    val props = (presentFace.toJson \ "properties").as[JsObject]
    (props \ "first_no_sidewalk_label_date").get shouldBe JsNull
    (props \ "last_no_sidewalk_label_date").get shouldBe JsNull
  }

  test("the CSV header names the JSON properties plus the geometry's two endpoints, in order") {
    SidewalkPresenceForApi.csvHeader shouldBe
      "street_edge_id,street_side,osm_way_id,region_id,region_name,way_type,status,presence,presence_basis," +
      "no_sidewalk_label_count,no_sidewalk_user_count,label_count,audit_count,first_no_sidewalk_label_date," +
      "last_no_sidewalk_label_date,start_point,end_point"
  }

  test("a CSV row has one cell per header column, empty where the JSON is null") {
    val header = SidewalkPresenceForApi.csvHeader.split(",")
    // The two point cells are quoted "lng,lat" pairs, so split outside quotes.
    val cells = presentFace.toCsvRow.split(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)")
    cells.length shouldBe header.length
    cells(header.indexOf("presence")) shouldBe "present"
    cells(header.indexOf("first_no_sidewalk_label_date")) shouldBe ""
    cells(header.indexOf("start_point")) shouldBe "\"-122.3546715,47.5309889\""
  }
}
