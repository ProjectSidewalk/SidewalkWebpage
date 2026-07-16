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
 * Locks the response contract of the Streets API: GET /v3/api/streets returns a GeoJSON FeatureCollection by default
 * and a snake_case CSV header for filetype=csv (400 INVALID_PARAMETER on a malformed bbox), and GET
 * /v3/api/streetTypes returns the {status, street_types:[{name, description, count}]} envelope. Asserts shape, not data.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the routes end to end. The endpoints are
 * `UserAwareAction` (no auth needed) and make no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class StreetsApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/streets" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      val features = (json \ "features").asOpt[Seq[JsObject]]
      features mustBe defined
      // Every feature carries the needs-re-audit boolean (#4384), and a never-audited street is never outdated.
      features.get.foreach { feature =>
        val props    = feature \ "properties"
        val outdated = (props \ "outdated").as[Boolean]
        if ((props \ "audit_count").as[Int] == 0) outdated mustBe false
      }
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      // Header from StreetDataForApi.csvHeader; assert snake_case field names are present and camelCase absent.
      body must include(
        "street_edge_id,osm_way_id,region_id,region_name,way_type,status,user_ids,label_count,audit_count,outdated," +
          "user_count,first_label_date,last_label_date,start_point,end_point"
      )
      body must not include "streetEdgeId"
      body must not include "labelCount"
    }

    "return 400 INVALID_PARAMETER for an unrecognized status value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?status=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "status"
    }

    "accept a valid status filter" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox&status=no_imagery")).get
      status(resp) mustBe OK
    }

    "return 400 INVALID_PARAMETER for a malformed bbox, as an RFC 7807 problem+json body" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      contentType(resp) mustBe Some("application/problem+json") // RFC 7807 media type (#3931).
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "about:blank"
      (json \ "title").as[String] mustBe "Invalid Parameter"
      (json \ "status").as[Int] mustBe 400
      (json \ "code").as[String] mustBe "INVALID_PARAMETER"
      (json \ "detail").asOpt[String] mustBe defined
      (json \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/streetTypes" should {
    "return 200 JSON with the {status, street_types:[{name, description, count}]} envelope" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streetTypes")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "status").as[String] mustBe "OK"
      (json \ "streetTypes").toOption mustBe None // old camelCase envelope gone (#3871)
      val streetTypes = (json \ "street_types").as[Seq[JsObject]]

      // Each entry must expose name/description/count (StreetTypeForApi). If the DB has no streets the array can be
      // empty, so only assert the per-element shape when at least one entry is present.
      streetTypes.headOption.foreach { entry =>
        (entry \ "name").asOpt[String] mustBe defined
        (entry \ "description").asOpt[String] mustBe defined
        (entry \ "count").asOpt[Int] mustBe defined
      }
    }
  }
}
