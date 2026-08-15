package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Contract tests for the Region API endpoints.
 *
 * Covers GET /v3/api/regions (CSV format + happy-path shape) and GET /v3/api/regionWithMostLabels
 * (both the success and the not-found cases). The bbox/regionId 400 paths are already covered by
 * PublicApiSpec and are not duplicated here.
 *
 * Boots the real application (real Slick/PostGIS). Endpoints are UserAwareAction (no auth). The eager
 * scheduling actors are disabled so they don't fire background DB/WS work during tests.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class RegionApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/regions?filetype=csv" should {
    "return 200 CSV with the documented snake_case header" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/regions?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include(
        "region_id,name,label_count,street_count,user_count,audit_count,total_distance_m,audited_distance_m," +
          "outdated_distance_m,completion_rate,first_label_date,last_label_date,center_point"
      )
      // camelCase headers must not appear per v3 naming convention (#3871).
      body must not include "regionId"
      body must not include "labelCount"
      body must not include "completionRate"
    }
  }

  "GET /v3/api/regions?filetype=geojson" should {
    "expose snake_case coverage fields (total_distance_m, audited_distance_m, completion_rate) on each feature" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?filetype=geojson")).get
      status(resp) mustBe OK

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"

      // Assert the contract on the first feature if the seed has any regions; shape, not data values.
      val features = (json \ "features").as[Seq[play.api.libs.json.JsValue]]
      features.headOption.foreach { feature =>
        val props = feature \ "properties"
        (props \ "total_distance_m").asOpt[Double] mustBe defined
        (props \ "audited_distance_m").asOpt[Double] mustBe defined
        // Distance needing re-audit (#4384): non-negative, and bounded by the region's total street distance.
        val outdated = (props \ "outdated_distance_m").as[Double]
        outdated must be >= 0.0
        outdated must be <= ((props \ "total_distance_m").as[Double] + 0.001)
        // completion_rate is a fraction in [0, 1].
        val rate = (props \ "completion_rate").as[Double]
        rate must be >= 0.0
        rate must be <= 1.0
        // camelCase keys must not leak into properties per #3871.
        (props \ "completionRate").asOpt[Double] mustBe empty
      }
    }
  }

  "GET /v3/api/regions?filetype=geopackage" should {
    "return a SQLite GeoPackage whose schema carries outdated_distance_m (#4384)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?filetype=geopackage")).get
      status(resp) mustBe OK

      val bytes = contentAsBytes(resp)
      // A GeoPackage is a raw SQLite database; its column names appear as plain text in the schema pages, so a
      // byte-level search proves the field reached the export without pulling in a SQLite reader as a test dep.
      bytes.take(15).utf8String mustBe "SQLite format 3"
      bytes.containsSlice(org.apache.pekko.util.ByteString("outdated_distance_m")) mustBe true
      bytes.containsSlice(org.apache.pekko.util.ByteString("audited_distance_m")) mustBe true
    }
  }

  "GET /v3/api/regions?filetype=shapefile" should {
    "return a nonempty ZIP archive" in {
      // The DBF field names live inside compressed entries, so this only smoke-tests that the export (including the
      // outdDistM featureBuilder wiring, which would 500 on a schema/value mismatch) still assembles end to end.
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?filetype=shapefile")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(2).utf8String mustBe "PK"
    }
  }

  "GET /v3/api/regionWithMostLabels" should {
    // The DB may or may not have labeled regions depending on the seed, so we accept either a 200
    // (with a valid region object) or a 404 with a standard ApiError body.
    "return either 200 with region data or 404 with an ApiError envelope" in {
      val resp       = route(app, FakeRequest(GET, "/v3/api/regionWithMostLabels")).get
      val httpStatus = status(resp)

      httpStatus match {
        case 200 =>
          contentType(resp) mustBe Some("application/json")
          // The region object should have at minimum a region_id field.
          (contentAsJson(resp) \ "region_id").asOpt[Int] mustBe defined

        case 404 =>
          // Must use the standard RFC 7807 problem+json envelope, NOT an ad-hoc Json.obj (#3931).
          contentType(resp) mustBe Some("application/problem+json")
          val json = contentAsJson(resp)
          (json \ "status").as[Int] mustBe 404
          (json \ "code").as[String] mustBe "NOT_FOUND"
          (json \ "title").as[String] mustBe "Not Found"
          (json \ "type").as[String] mustBe "about:blank"
          (json \ "detail").asOpt[String] mustBe defined // RFC 7807 renamed `message` -> `detail`.

        case other =>
          fail(s"Expected 200 or 404 but got $other")
      }
    }
  }
}
