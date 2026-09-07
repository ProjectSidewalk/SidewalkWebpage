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
      body must include("score_no_sidewalk,n_curb_ramp_sev1,n_curb_ramp_sev2,n_curb_ramp_sev3,n_curb_ramp_sev_null")
      body must include("tag_adj_curb_ramp")
      body must include("tag_adj_no_sidewalk,start_point,end_point")
      body must not include "streetEdgeId"
      body must not include "lengthMeters"
    }

    "serve the whole city from the cache with the per-bucket inputs on every feature" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreStreets")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"

      // The CI database is empty, so the shape check only runs where there is a street to check.
      (json \ "features").as[Seq[JsObject]].headOption.foreach { feature =>
        val props = (feature \ "properties").as[JsObject]
        (props \ "severity_counts").as[JsObject].keys mustBe
          Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal", "NoSidewalk")
        (props \ "severity_counts" \ "CurbRamp").as[JsObject].keys mustBe Set("1", "2", "3", "null")
        (props \ "tag_adjustments").as[JsObject].keys mustBe (props \ "severity_counts").as[JsObject].keys
      }
      // A second call is served from the same cached computation.
      status(route(app, FakeRequest(GET, "/v3/api/accessScoreStreets")).get) mustBe OK
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

  "GET /v3/api/accessScoreConfig" should {
    "return the engine's configuration with snake_case keys, types in canonical order, and named presets" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreConfig")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "scored_types").as[Seq[String]] mustBe
        Seq("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal", "NoSidewalk")
      (json \ "severity_buckets").as[Seq[String]] mustBe Seq("1", "2", "3", "null")
      (json \ "type_weights" \ "NoSidewalk" \ "scoring").as[String] mustBe "street_condition"
      (json \ "type_weights" \ "CurbRamp" \ "base_weight").as[Double] mustBe 0.75
      (json \ "quality_multiplier" \ "3").as[Double] mustBe -1.0
      (json \ "severity_multiplier" \ "null").as[Double] mustBe 0.33
      (json \ "street_condition_saturation_count").as[Int] mustBe 3
      (json \ "tag_active_threshold").as[Double] mustBe 0.5
      (json \ "tag_adjustments").as[Seq[JsObject]].map(a => (a \ "label_type").as[String]) must contain("Signal")
      (json \ "preset_order").as[Seq[String]].head mustBe "default"
      (json \ "presets" \ "default" \ "NoSidewalk").as[Double] mustBe 2.0

      val body = contentAsString(resp)
      body must not include "baseWeight"
      body must not include "scoredTypes"
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
