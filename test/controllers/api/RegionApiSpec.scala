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
          "completion_rate,first_label_date,last_label_date,center_point"
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
        // completion_rate is a fraction in [0, 1].
        val rate = (props \ "completion_rate").as[Double]
        rate must be >= 0.0
        rate must be <= 1.0
        // camelCase keys must not leak into properties per #3871.
        (props \ "completionRate").asOpt[Double] mustBe empty
      }
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
          // Must use the standard ApiError envelope, NOT an ad-hoc Json.obj.
          contentType(resp) mustBe Some("application/json")
          val json = contentAsJson(resp)
          (json \ "status").as[Int] mustBe 404
          (json \ "code").as[String] mustBe "NOT_FOUND"
          (json \ "message").asOpt[String] mustBe defined

        case other =>
          fail(s"Expected 200 or 404 but got $other")
      }
    }
  }
}
