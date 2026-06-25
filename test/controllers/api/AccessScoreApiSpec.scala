package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Locks the response contract of the v3 AccessScore API (#3855): GET /v3/api/accessScoreStreets and
 * /v3/api/accessScoreRegions return a GeoJSON FeatureCollection by default and a snake_case CSV header for filetype=csv,
 * and reject a malformed bbox / non-positive regionId with 400 INVALID_PARAMETER. Asserts shape, not data.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the routes end to end. The endpoints are
 * `UserAwareAction` (no auth needed); the eager scheduling actors are disabled so they don't fire background work.
 *
 * Requires a Postgres+PostGIS database whose city schema uses the new `cluster`/`cluster_label` model.
 */
class AccessScoreApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  // Chunked GeoJSON/CSV bodies need a real Materializer to consume (the test default NoMaterializer only does strict).
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/accessScoreStreets" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreStreets?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreStreets?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      // Per-type columns are generated from AccessScoreCalculator.orderedScoredTypes; assert the leading + trailing run.
      body must include(
        "street_edge_id,osm_way_id,region_id,score,audit_count,length_meters,label_count,n_curb_ramp"
      )
      body must include("score_signal,start_point,end_point")
      body must not include "streetEdgeId"
      body must not include "lengthMeters"
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreStreets?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreStreets?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/accessScoreRegions" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreRegions?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreRegions?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "region_id,name,score,coverage,audited_street_count,total_street_count,avg_n_curb_ramp"
      )
      body must include("center_point")
      body must not include "regionId"
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreRegions?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }
  }
}
