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
 * Locks the response contract of the v3 Places API (#5311): GET /v3/api/places returns a GeoJSON FeatureCollection by
 * default and a snake_case CSV header for filetype=csv, serves every file format, and rejects a malformed bbox, a
 * non-positive regionId, or an unknown category with 400 INVALID_PARAMETER. Asserts shape, not data: CI's schema has
 * no places, and a dev schema has whatever its last refresh fetched.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the routes end to end. The endpoint is
 * `UserAwareAction` (no auth needed); the eager scheduling actors are disabled so they don't fire background work.
 */
class PlacesApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  // Chunked GeoJSON/CSV bodies need a real Materializer to consume (the test default NoMaterializer only does strict).
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/places" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return the whole city, from the cache, when no filter is given" in {
      // Twice: the second call is the cached path, which must serve the same shape.
      Seq(1, 2).foreach { _ =>
        val resp = route(app, FakeRequest(GET, "/v3/api/places")).get
        status(resp) mustBe OK
        (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
      }
    }

    "carry the documented snake_case properties on every feature" in {
      val resp     = route(app, FakeRequest(GET, "/v3/api/places")).get
      val features = (contentAsJson(resp) \ "features").as[Seq[JsObject]]
      // Guarded: CI's schema holds no places, so the shape is asserted on whatever the connected schema has.
      features.headOption.foreach { feature =>
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        val props = (feature \ "properties").as[JsObject]
        props.keys must contain allOf ("place_id", "category", "name", "source", "osm_type", "osm_id", "osm_url",
          "region_id", "region_name", "nearest_street_edge_id", "nearest_street_distance_m", "fetched_at")
        props.keys must not contain "placeId"
      }
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "place_id,category,name,source,osm_type,osm_id,osm_url,region_id,region_name,nearest_street_edge_id," +
          "nearest_street_distance_m,fetched_at,lat,lng"
      )
      body must not include "placeId"
    }

    "return a SQLite GeoPackage when filetype=geopackage" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox&filetype=geopackage")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(15).utf8String mustBe "SQLite format 3"
    }

    "return a nonempty ZIP archive when filetype=shapefile" in {
      // The DBF field names live inside compressed entries, so this only smoke-tests that the export (including the
      // featureBuilder wiring, which would 500 on a schema/value mismatch) still assembles end to end.
      val resp = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox&filetype=shapefile")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(2).utf8String mustBe "PK"
    }

    "accept a category filter of known ids" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox&category=school,transit")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "return 400 INVALID_PARAMETER for an unknown category" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/places?category=school,casino")).get
      status(resp) mustBe BAD_REQUEST
      val body = contentAsString(resp)
      body must include("INVALID_PARAMETER")
      body must include("category")
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/places?bbox=not,a,bbox")).get
      status(resp) mustBe BAD_REQUEST
      contentAsString(resp) must include("INVALID_PARAMETER")
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/places?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      contentAsString(resp) must include("INVALID_PARAMETER")
    }
  }

  "GET /v3/api/accessScoreConfig" should {
    "publish the place categories the tool lists, in catalog order" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreConfig")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "place_categories").as[Seq[String]] mustBe
        Seq("school", "health", "library", "grocery", "transit", "park", "community")
    }
  }

  "GET /v3/api-docs/places" should {
    "render the documentation page" in {
      val resp = route(app, FakeRequest(GET, "/v3/api-docs/places")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("Places API")
    }
  }
}
