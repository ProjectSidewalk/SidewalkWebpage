package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import play.api.libs.json.Json
import util.UserAgents

/**
 * The single-mobile-definition contract (#4887): `ControllerUtils.isMobile` is the one mobile verdict, and the shared
 * layout stamps it on `<html data-mobile-device>` so `util.isMobile()` reads the server's answer back instead of
 * re-sniffing the UA client-side. These specs pin the stamp on both verdicts — lose it and the Validate app silently
 * treats every page as desktop. Fetches /signIn because it serves every device with no session or data requirements.
 * Also pins the layout's other request-derived body marker, the landing page's navbar-padding opt-out, and the
 * data-mapillary-pano-scoring stamp the pano viewer reads its ranking weights back from (#4411).
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class MobileDetectionSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  "The layout's data-mobile-device stamp" should {
    "carry the server's true verdict on a page served to a mobile browser" in {
      val resp = route(app, FakeRequest(GET, "/signIn").withHeaders(UserAgents.mobile)).get
      status(resp) mustBe OK
      contentAsString(resp) must include("data-mobile-device=\"true\"")
    }

    "carry the server's false verdict on a page served to a desktop browser" in {
      val resp = route(app, FakeRequest(GET, "/signIn")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("data-mobile-device=\"false\"")
    }
  }

  "The layout's data-mapillary-pano-scoring stamp" should {
    // MapillaryViewer.#scorePano parses this back; without it the viewer has no weights and every pano search throws.
    // Stamped on every page rather than beside the dozen pano-viewer script tags, so this checks an unrelated page.
    "carry the parsed scoring parameters on any page" in {
      val resp = route(app, FakeRequest(GET, "/signIn")).get
      status(resp) mustBe OK
      val stamp: String = "data-mapillary-pano-scoring=\"([^\"]*)\"".r
        .findFirstMatchIn(contentAsString(resp))
        .map(_.group(1))
        .getOrElse(fail("the layout did not stamp data-mapillary-pano-scoring"))
      Json.parse(stamp.replace("&quot;", "\"")) mustBe Json.parse(models.utils.MapillaryPanoScoring.json)
    }
  }

  "The layout's landing padding opt-out" should {
    // The class must key on request.path, not the layout's `url` parameter — that parameter defaults to "/", so the
    // many views that omit it would otherwise all read as the landing page and lose their fixed-navbar padding.
    "mark the landing page's body and no other page's" in {
      val landing = route(app, FakeRequest(GET, "/")).get
      status(landing) mustBe OK
      contentAsString(landing) must include("no-navbar-offset")

      val signIn = route(app, FakeRequest(GET, "/signIn")).get
      status(signIn) mustBe OK
      contentAsString(signIn) must not include "no-navbar-offset"
    }
  }
}
