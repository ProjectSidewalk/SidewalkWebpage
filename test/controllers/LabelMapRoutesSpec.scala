package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Locks the response contract of the two streamed label-map endpoints (#3932): GET /labels/all must return a GeoJSON
 * FeatureCollection with the exact property set the LabelMap frontend renders from, including when the result is
 * empty (the streamed chunked framing must still produce valid JSON); GET /adminapi/labels/all is admin-gated, so
 * unauthenticated requests must redirect to sign-in (never 404). Asserts shape, not data values.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the routes end to end. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class LabelMapRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // Chunked streamed responses need a real Materializer to consume; the test default is NoMaterializer, which only
  // works for strict bodies.
  implicit lazy val mat: Materializer = app.materializer

  // The label properties the LabelMap frontend renders from (createLayer paint expressions + MapSidebarFilter).
  private val publicPropertyKeys = Set("label_id", "label_type", "severity", "correct", "has_validations",
    "ai_validation", "expired", "has_backup", "high_quality_user", "ai_generated", "tags")

  "GET /labels/all" should {
    "return 200 GeoJSON FeatureCollection with the exact public label properties" in {
      val resp = route(app, FakeRequest(GET, "/labels/all")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      val features = (json \ "features").as[Seq[JsObject]]
      // Shape assertions only apply when the connected DB has labels; empty results are locked by the case below.
      features.headOption.foreach { feature =>
        (feature \ "type").as[String] mustBe "Feature"
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        (feature \ "geometry" \ "coordinates").as[Seq[Double]] must have size 2
        (feature \ "properties").as[JsObject].keys mustBe publicPropertyKeys
      }
    }

    "return a valid empty FeatureCollection when filters match nothing" in {
      // A nonexistent region streams zero rows; the chunked framing must still emit the FeatureCollection envelope.
      val resp = route(app, FakeRequest(GET, "/labels/all?regions=999999999")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").as[Seq[JsObject]] mustBe empty
    }
  }

  "GET /adminapi/labels/all" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/labels/all")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      val sc = status(resp)
      sc must (be >= 300 and be < 400)
    }
  }
}
