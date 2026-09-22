package controllers.api

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Locks the response contract of the v3 Places API (#5311): GET /v3/api/places returns a GeoJSON FeatureCollection by
 * default and a snake_case CSV header for filetype=csv, serves every file format, and rejects a malformed bbox, a
 * non-positive regionId, or an unknown category with 400 INVALID_PARAMETER. CI's schema has no places and a dev
 * schema has whatever its last refresh fetched, so the cases that need a row seed a city-sourced one and delete it
 * after: the route reads through its own connection, so a rolled-back transaction could not serve it.
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

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  /**
   * Runs `body` with one committed city-sourced library inside `tinyBbox`, deleted afterwards whatever happens. A
   * city row has no OSM reference, region, or street, which is the sparsest shape the properties contract covers.
   */
  private def withSeededPlace[T](body: Int => T): T = {
    val placeId = run(sql"""INSERT INTO place (category, name, source, tags, geom, fetched_at)
                            VALUES ('library', 'Spec Library', 'city', '{}',
                                    ST_SetSRID(ST_MakePoint(0.0005, 0.0005), 4326), now())
                            RETURNING place_id""".as[Int].head)
    try body(placeId)
    finally {
      val _ = run(sqlu"DELETE FROM place WHERE place_id = $placeId")
    }
  }

  private def featureIds(query: String): Seq[Int] = {
    val resp = route(app, FakeRequest(GET, s"/v3/api/places?$query")).get
    status(resp) mustBe OK
    (contentAsJson(resp) \ "features").as[Seq[JsObject]].map(f => (f \ "properties" \ "place_id").as[Int])
  }

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

    "carry the documented snake_case properties on every feature, nulls included" in withSeededPlace { placeId =>
      val resp     = route(app, FakeRequest(GET, s"/v3/api/places?$tinyBbox")).get
      val features = (contentAsJson(resp) \ "features").as[Seq[JsObject]]
      val feature  = features.find(f => (f \ "properties" \ "place_id").as[Int] == placeId).get
      (feature \ "geometry" \ "type").as[String] mustBe "Point"
      (feature \ "geometry" \ "coordinates").as[Seq[Double]] mustBe Seq(0.0005, 0.0005)
      val props = (feature \ "properties").as[JsObject]
      props.keys must contain allOf ("place_id", "category", "name", "source", "osm_type", "osm_id", "osm_url",
        "region_id", "region_name", "nearest_street_edge_id", "nearest_street_distance_m", "fetched_at")
      props.keys must not contain "placeId"
      (props \ "category").as[String] mustBe "library"
      (props \ "name").as[String] mustBe "Spec Library"
      (props \ "source").as[String] mustBe "city"
      // A city row has no OSM object to link, and this one sits in no region and near no street.
      Seq("osm_type", "osm_id", "osm_url", "region_id", "region_name", "nearest_street_edge_id",
        "nearest_street_distance_m").foreach(key => (props \ key).get mustBe JsNull)
    }

    "filter by category, city-wide when no location filter is given" in withSeededPlace { placeId =>
      featureIds(s"$tinyBbox&category=library") must contain(placeId)
      featureIds(s"$tinyBbox&category=school,transit") must not contain placeId
      // A category on its own is not confined to the configured map box: every place is inside the city already.
      featureIds("category=library") must contain(placeId)
      featureIds("category=school") must not contain placeId
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
        Seq("school", "health", "library", "grocery", "transit", "park", "community", "government")
    }
  }

  "GET /v3/api-docs/places" should {
    "render the documentation page" in {
      val resp = route(app, FakeRequest(GET, "/v3/api-docs/places")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("Places API")
    }

    // A rule's qualifier is the difference between a passport office and a maintenance yard, so the tag table has to
    // print it; without this the page would promise every office=government object.
    "spell out a qualified rule's second tag in the category table" in {
      val page = contentAsString(route(app, FakeRequest(GET, "/v3/api-docs/places")).get)
      page must include("<code>office=government</code> with <code>government</code> one of")
      page must include("<code>public_service</code>")
    }
  }
}
