package controllers.api

import org.apache.pekko.stream.Materializer
import org.apache.pekko.util.ByteString
import models.utils.MyPostgresProfile.api.given
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * Locks the response contract of the Sidewalk Presence API (#5279): GET /v3/api/sidewalkPresence returns a GeoJSON
 * FeatureCollection by default, a snake_case CSV header for filetype=csv, 400 INVALID_PARAMETER on a bad
 * `presence`, `status`, bbox, or regionId, 400 on a non-integer `minValidatedNoSidewalkLabels`, and the two GIS
 * exports assemble end to end. Asserts shape, not data, except for the OSM siding (#5741), which needs a street with
 * positioned way links and presence faces: CI's seed carries neither, so the spec seeds one street of its own in
 * its own region and deletes it in `afterAll` (a request runs in its own transaction, so a rollback cannot do it).
 *
 * Boots the real application (real Slick/PostGIS) and exercises the route end to end. The endpoint is
 * `UserAwareAction` (no auth needed) and makes no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 *
 * `BeforeAndAfterAll` is mixed in before `GuiceOneAppPerSuite` so that `afterAll` runs while the app is still up.
 */
class SidewalkPresenceApiSpec
    extends SidewalkSpec
    with BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  given mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  private var sidedRegion: Int = 0
  private var sidedStreet: Int = 0
  private val AlongWay         = 9_000_001L // Drawn the street's way, so the face keeps its side.
  private val AgainstWay       = 9_000_002L // Drawn the other way, so the face's side flips.

  override def beforeAll(): Unit = {
    super.beforeAll()
    sidedRegion = run(insertRegion())
    sidedStreet = run(insertStreet(Some(sidedRegion)))
    val _ = run(
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id, street_from_frac,
                                              street_to_frac, way_from_frac, way_to_frac, same_direction, matched_at)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), $AlongWay,
                     $sidedStreet, 0, 0.5, 0.2, 1, TRUE, now()),
                    ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 2 FROM osm_way_street_edge), $AgainstWay,
                     $sidedStreet, 0.5, 1, 0, 0.7, FALSE, now())""" andThen
        sqlu"""INSERT INTO sidewalk_presence (street_edge_id, street_side, presence, presence_basis,
                                              no_sidewalk_label_count, no_sidewalk_user_count, label_count, audit_count)
               VALUES ($sidedStreet, 'left', 'unknown', 'unaudited', 0, 0, 0, 0),
                      ($sidedStreet, 'right', 'unknown', 'unaudited', 0, 0, 0, 0)"""
    )
  }

  override def afterAll(): Unit = {
    try {
      // The presence faces and the region link go with the street; the way links have no cascade.
      val _ = run(
        sqlu"DELETE FROM osm_way_street_edge WHERE street_edge_id = $sidedStreet" andThen
          sqlu"DELETE FROM street_edge WHERE street_edge_id = $sidedStreet" andThen
          sqlu"DELETE FROM region WHERE region_id = $sidedRegion"
      )
    } finally super.afterAll()
  }

  "GET /v3/api/sidewalkPresence" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      val features = (json \ "features").asOpt[Seq[JsObject]]
      features mustBe defined

      // tinyBbox is deliberately empty, so this rarely runs; when it does, the face contract must hold.
      features.get.headOption.foreach { feature =>
        (feature \ "geometry" \ "type").as[String] mustBe "LineString"
        (feature \ "properties" \ "street_side").as[String] must (be("left") or be("right"))
        (feature \ "properties" \ "presence").as[String] must (be("present") or be("absent") or be("unknown"))
      }
    }

    "side each of the street's OSM ways for the face, flipping where the way runs the other direction (#5741)" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?regionId=$sidedRegion")).get
      status(resp) mustBe OK
      val faces = (contentAsJson(resp) \ "features").as[Seq[JsObject]].map(f => (f \ "properties").as[JsObject])
      faces.map(f => (f \ "street_side").as[String]).sorted mustBe Seq("left", "right")

      faces.foreach { face =>
        val streetSide = (face \ "street_side").as[String]
        val otherSide  = if (streetSide == "left") "right" else "left"
        // Both ways cover half the street, so the primary is the lower id.
        (face \ "osm_way_id").as[Long] mustBe AlongWay

        val ways = (face \ "osm_ways").as[Seq[JsObject]]
        ways.map(_.keys).distinct mustBe Seq(
          Set("osm_way_id", "street_from_frac", "street_to_frac", "way_from_frac", "way_to_frac", "osm_side")
        )
        ways.map(w => ((w \ "osm_way_id").as[Long], (w \ "osm_side").as[String])) mustBe
          Seq((AlongWay, streetSide), (AgainstWay, otherSide))
        ways.map(w => ((w \ "street_from_frac").as[Double], (w \ "way_to_frac").as[Double])) mustBe
          Seq((0.0, 1.0), (0.5, 0.7))
      }
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "street_edge_id,street_side,osm_way_id,region_id,region_name,way_type,status,presence,presence_basis," +
          "no_sidewalk_label_count,no_sidewalk_user_count,label_count,audit_count,first_no_sidewalk_label_date," +
          "last_no_sidewalk_label_date,validated_no_sidewalk_count,rejected_no_sidewalk_count,osm_ways,start_point," +
          "end_point"
      )
      body must not include "streetEdgeId"
      body must not include "noSidewalkLabelCount"
    }

    "accept a valid presence filter" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&presence=present,absent")).get
      status(resp) mustBe OK
    }

    "accept the validator-confirmed tier filter, and reject one that is not a number" in {
      val ok = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&minValidatedNoSidewalkLabels=1")).get
      status(ok) mustBe OK
      val bad =
        route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&minValidatedNoSidewalkLabels=one")).get
      status(bad) mustBe BAD_REQUEST
    }

    "return 400 INVALID_PARAMETER for an unrecognized presence value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?presence=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "presence"
    }

    "accept a valid status filter" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&status=open")).get
      status(resp) mustBe OK
    }

    "return 400 INVALID_PARAMETER for an unrecognized status value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?status=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "status"
    }

    "return 400 INVALID_PARAMETER for an unrecognized wayType value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?wayType=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "wayType"
    }

    "return 400 INVALID_PARAMETER for a malformed bbox, as an RFC 7807 problem+json body" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      contentType(resp) mustBe Some("application/problem+json")
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "about:blank"
      (json \ "title").as[String] mustBe "Invalid Parameter"
      (json \ "status").as[Int] mustBe 400
      (json \ "code").as[String] mustBe "INVALID_PARAMETER"
      (json \ "detail").asOpt[String] mustBe defined
      (json \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/sidewalkPresence?filetype=geopackage" should {
    "return a SQLite GeoPackage whose schema carries the canonical field names" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&filetype=geopackage")).get
      status(resp) mustBe OK

      val bytes = contentAsBytes(resp)
      // A GeoPackage is a raw SQLite database; its column names appear as plain text in the schema pages, so a
      // byte-level search proves the fields reached the export without pulling in a SQLite reader as a test dep.
      bytes.take(15).utf8String mustBe "SQLite format 3"
      bytes.containsSlice(ByteString("presence_basis")) mustBe true
      bytes.containsSlice(ByteString("no_sidewalk_label_count")) mustBe true
      bytes.containsSlice(ByteString("validated_no_sidewalk_count")) mustBe true
      bytes.containsSlice(ByteString("osm_ways")) mustBe true
    }
  }

  "GET /v3/api/sidewalkPresence?filetype=shapefile" should {
    "return a nonempty ZIP archive" in {
      // The DBF field names live inside compressed entries, so this only smoke-tests that the export (including the
      // featureBuilder wiring, which would 500 on a schema/value mismatch) still assembles end to end.
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&filetype=shapefile")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(2).utf8String mustBe "PK"
    }
  }
}
