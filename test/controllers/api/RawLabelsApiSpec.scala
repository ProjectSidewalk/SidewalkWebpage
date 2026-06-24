package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.Helpers._
import play.api.test.FakeRequest

/**
 * Locks the response contract of GET /v3/api/rawLabels: GeoJSON FeatureCollection by default, a snake_case CSV header
 * for filetype=csv, and 400 INVALID_PARAMETER (parameter=bbox) for a malformed bbox. Asserts shape, not data values.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the route end to end. The endpoint is a
 * `UserAwareAction` (no auth needed) and makes no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class RawLabelsApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/rawLabels" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[play.api.libs.json.JsObject]] mustBe defined
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      // Header from LabelDataForApi.csvHeader; assert snake_case field names are present and camelCase absent.
      body must include(
        "label_id,user_id,pano_id,label_type,severity,tags,description,time_created,street_edge_id,osm_way_id," +
          "neighborhood,correct,agree_count,disagree_count,unsure_count,validations,audit_task_id,mission_id," +
          "image_capture_date,heading,pitch,zoom,canvas_x,canvas_y,canvas_width,canvas_height,pano_x,pano_y," +
          "pano_width,pano_height,camera_heading,camera_pitch,camera_roll,image_url,latitude,longitude"
      )
      body must not include "labelId"
      body must not include "streetEdgeId"
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }
    // Note: invalid-validationStatus → 400 is covered by PublicApiSpec on the Phase 1 branch (#4261); on this
    // branch that value is still silently dropped (the bug #4261 fixes), so it's intentionally not asserted here.
  }
}
