package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.Helpers._
import play.api.test.FakeRequest

/**
 * In-JVM functional tests for the public v3 API. Boots the real application (all modules, real Slick/PostGIS) and
 * exercises routes end to end — so a single test covers routing, the DAO/query layer, and JSON/CSV serialization.
 *
 * The read-only v3 endpoints are `UserAwareAction` (no auth) and make no external WS calls on the request path, so
 * this slice needs no Silhouette fixtures or WS stubs. The eager scheduling actors are disabled so they don't fire
 * background DB/WS work during the test. Asserts response *shape/contract*, not data values, so it's robust against
 * whatever the connected test DB contains.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class PublicApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (e.g. CSV via Ok.sendFile) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  "GET /v3/api/overallStats" should {
    "return 200 JSON with the documented top-level structure" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "launch_date").asOpt[String] mustBe defined
      (json \ "km_explored").asOpt[Double] mustBe defined
      (json \ "user_counts").asOpt[JsObject] mustBe defined
      (json \ "labels").asOpt[JsObject] mustBe defined
      (json \ "validations").asOpt[JsObject] mustBe defined
    }

    "return CSV when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats?filetype=csv")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("Launch Date")
    }
  }

  "GET /v3/api/regions" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return CSV with the documented header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?filetype=csv")).get
      status(resp) mustBe OK
      contentAsString(resp) must include(
        "region_id,name,label_count,street_count,user_count,audit_count,first_label_date,last_label_date,center_point"
      )
    }

    "return 400 for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/cities" should {
    "return 200 JSON" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
    }
  }
}
