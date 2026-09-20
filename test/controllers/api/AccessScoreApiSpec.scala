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
 * Locks the response contract of the v3 AccessScore API (#3855, #5095): GET /v3/api/accessScoreStreets,
 * /v3/api/accessScoreIntersections, and /v3/api/accessScoreRegions return a GeoJSON FeatureCollection by default and a
 * snake_case CSV header for filetype=csv, and reject a malformed bbox / non-positive regionId with 400
 * INVALID_PARAMETER. Asserts shape, not data.
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
        "street_edge_id,osm_way_id,street_name,region_id,score,segment_score,start_intersection_id,end_intersection_id," +
          "start_intersection_score,end_intersection_score,audit_count,length_meters,label_count," +
          "mean_grade,max_grade,net_grade,total_climb_meters,total_descent_meters,meters_over_5pct," +
          "meters_over_8pct,grade_confidence,grade_quality,dem_source,cluster_counts.CurbRamp"
      )
      body must include(
        "sub_scores.NoSidewalk,severity_counts.CurbRamp.1,severity_counts.CurbRamp.2,severity_counts.CurbRamp.3," +
          "severity_counts.CurbRamp.null"
      )
      body must include("tag_adjustments.CurbRamp")
      body must include("tag_adjustments.NoSidewalk,start_point,end_point")
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
        // The headline's components are always present, null where an end has no scored intersection (#5095).
        props.keys must contain allOf ("segment_score", "start_intersection_id", "end_intersection_id",
          "start_intersection_score", "end_intersection_score")
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

  "GET /v3/api/streetGradientProfile" should {
    "answer 404 NOT_FOUND for a street that does not exist" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streetGradientProfile?streetEdgeId=2147483647")).get
      status(resp) mustBe NOT_FOUND
      (contentAsJson(resp) \ "code").as[String] mustBe "NOT_FOUND"
      (contentAsJson(resp) \ "detail").as[String] must include("No street with id")
    }

    "answer 400 when streetEdgeId is missing or not an integer" in {
      status(route(app, FakeRequest(GET, "/v3/api/streetGradientProfile")).get) mustBe BAD_REQUEST
      status(route(app, FakeRequest(GET, "/v3/api/streetGradientProfile?streetEdgeId=abc")).get) mustBe BAD_REQUEST
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
      (json \ "intersection_types").as[Seq[String]] mustBe Seq("CurbRamp", "NoCurbRamp", "Crosswalk", "Signal")
      (json \ "segment_types").as[Seq[String]] mustBe Seq("Obstacle", "SurfaceProblem", "NoSidewalk")
      (json \ "attribution_radius_meters").as[Double] mustBe 25.0
      (json \ "length_normalization" \ "per_meters").as[Double] mustBe 100.0
      (json \ "length_normalization" \ "min_length_meters").as[Double] mustBe 25.0
      (json \ "type_weights" \ "Obstacle" \ "length_normalized").as[Boolean] mustBe true
      (json \ "type_weights" \ "CurbRamp" \ "length_normalized").as[Boolean] mustBe false
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
      // Present on every deployment; null only until clustering has run once (the CI database has no job runs).
      (json \ "clusters_updated_at").toOption mustBe defined

      val body = contentAsString(resp)
      body must not include "baseWeight"
      body must not include "scoredTypes"
    }

    "publish the slope limits and the city's elevation-model credits under gradient" in {
      // The grade layer's breaks and the map's credit line both read these (#5223); a city that has not been sampled
      // still publishes the limits, with no sources to credit.
      val json = contentAsJson(route(app, FakeRequest(GET, "/v3/api/accessScoreConfig")).get)
      (json \ "gradient" \ "walking_surface_limit").as[Double] mustBe 0.05
      (json \ "gradient" \ "ramp_limit").as[Double] mustBe (1.0 / 12.0)
      val sources = (json \ "gradient" \ "sources").as[Seq[JsObject]]
      sources.foreach { source =>
        (source \ "dem_source").as[String] must not be empty
        (source \ "credit").as[String] must not be empty
        (source \ "street_count").as[Int] must be > 0
      }
    }

    "publish the completion floor the Spotlight and the AccessScore tool both apply" in {
      // The one number behind "which regions are ranked" (#5215). Both readers take it from here, so a literal in
      // either would be a second definition of the same rule.
      val resp  = route(app, FakeRequest(GET, "/v3/api/accessScoreConfig")).get
      val floor = (contentAsJson(resp) \ "min_region_completion").as[Double]
      floor must (be >= 0.0 and be <= 1.0)
      floor mustBe service.AccessScoreSpotlight.MinRegionCompletion
    }
  }

  "GET /v3/api/accessScoreSpotlight" should {
    "return the documented envelope, defaulting to regions" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "unit").as[String] mustBe "regions"
      (json \ "min_completion").as[Double] mustBe service.AccessScoreSpotlight.MinRegionCompletion
      (json \ "qualifying").as[Int] must be >= 0
      (json \ "total").as[Int] must be >= 0
      (json \ "top").asOpt[Seq[JsObject]] mustBe defined
      (json \ "bottom").asOpt[Seq[JsObject]] mustBe defined
      (json \ "nearest").asOpt[Seq[JsObject]] mustBe defined
      // Present on every deployment; null until the nightly snapshot has run once (the CI database has no runs).
      (json \ "computed_at").toOption mustBe defined
    }

    "rank streets when asked to" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight?unit=streets&n=3")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "unit").as[String] mustBe "streets"
      (json \ "top").as[Seq[JsObject]].size must be <= 3
      // A street has no "closest to being ranked" call to action -- that ask belongs to a neighborhood.
      (json \ "nearest").as[Seq[JsObject]] mustBe empty
    }

    "rank across public cities when scope=cities" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight?scope=cities")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "unit").as[String] mustBe "regions"
      (json \ "nearest").as[Seq[JsObject]] mustBe empty
      // Every cross-city row names the deployment it came from, so a click can leave for the right site.
      (json \ "top").as[Seq[JsObject]].foreach { row =>
        (row \ "city_id").asOpt[String] mustBe defined
        (row \ "city_url").asOpt[String] mustBe defined
      }
    }

    "return 400 INVALID_PARAMETER for an unknown unit" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight?unit=intersections")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "unit"
    }

    "return 400 INVALID_PARAMETER for an out-of-range n" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight?n=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "n"

      val tooMany = route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight?n=500")).get
      status(tooMany) mustBe BAD_REQUEST
      (contentAsJson(tooMany) \ "parameter").as[String] mustBe "n"
    }

    "keep every output field name snake_case" in {
      val body = contentAsString(route(app, FakeRequest(GET, "/v3/api/accessScoreSpotlight")).get)
      body must not include "minCompletion"
      body must not include "computedAt"
      body must not include "regionId"
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
        "region_id,name,score,coverage,audited_street_count,total_street_count,intersection_score," +
          "intersection_count,scored_intersection_count,avg_cluster_counts.CurbRamp"
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

  "GET /v3/api/accessScoreIntersections" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreIntersections?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/accessScoreIntersections?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "intersection_id,region_id,degree,grade_separated,street_edge_ids,audit_count,score,label_count," +
          "cluster_counts.CurbRamp,cluster_counts.NoCurbRamp,cluster_counts.Crosswalk,cluster_counts.Signal," +
          "sub_scores.CurbRamp"
      )
      body must include(
        "severity_counts.CurbRamp.1,severity_counts.CurbRamp.2,severity_counts.CurbRamp.3," +
          "severity_counts.CurbRamp.null"
      )
      body must include("tag_adjustments.Signal,lat,lng")
      // Along-length types never score an intersection, so they have no columns here.
      body must not include "n_obstacle"
      body must not include "intersectionId"
    }

    "serve the whole city from the cache with Point features carrying the per-bucket inputs" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreIntersections")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"

      // The CI database is empty, so the shape check only runs where there is an intersection to check.
      (json \ "features").as[Seq[JsObject]].headOption.foreach { feature =>
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        val props = (feature \ "properties").as[JsObject]
        (props \ "degree").as[Int] must be >= 3
        (props \ "street_edge_ids").as[Seq[Int]].size must be >= 1
        (props \ "severity_counts").as[JsObject].keys mustBe Set("CurbRamp", "NoCurbRamp", "Crosswalk", "Signal")
        (props \ "severity_counts" \ "CurbRamp").as[JsObject].keys mustBe Set("1", "2", "3", "null")
        props.keys must contain allOf ("grade_separated", "score", "sub_scores", "tag_adjustments")
      }
      status(route(app, FakeRequest(GET, "/v3/api/accessScoreIntersections")).get) mustBe OK
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreIntersections?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreIntersections?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }
}
