package controllers.api

import org.apache.pekko.stream.Materializer
import org.apache.pekko.util.ByteString
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Locks the response contract of the Sidewalk Presence API (#5279): GET /v3/api/sidewalkPresence returns a GeoJSON
 * FeatureCollection by default, a snake_case CSV header for filetype=csv, 400 INVALID_PARAMETER on a bad
 * `presence`, bbox, or regionId, and the two GIS exports assemble end to end. Asserts shape, not data.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the route end to end. The endpoint is
 * `UserAwareAction` (no auth needed) and makes no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class SidewalkPresenceApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

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

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "street_edge_id,street_side,osm_way_id,region_id,region_name,way_type,presence,presence_basis," +
          "no_sidewalk_label_count,no_sidewalk_user_count,label_count,audit_count,first_no_sidewalk_label_date," +
          "last_no_sidewalk_label_date,start_point,end_point"
      )
      body must not include "streetEdgeId"
      body must not include "noSidewalkLabelCount"
    }

    "accept a valid presence filter" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/sidewalkPresence?$tinyBbox&presence=present,absent")).get
      status(resp) mustBe OK
    }

    "return 400 INVALID_PARAMETER for an unrecognized presence value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/sidewalkPresence?presence=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "presence"
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
