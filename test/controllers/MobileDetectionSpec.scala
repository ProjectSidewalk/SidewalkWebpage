package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * The single-mobile-definition contract (#4887): `ControllerUtils.isMobile` is the one mobile verdict, and the shared
 * layout stamps it on `<html data-mobile-device>` so `util.isMobile()` reads the server's answer back instead of
 * re-sniffing the UA client-side. These specs pin the stamp on both verdicts — lose it and the Validate app silently
 * treats every page as desktop. Fetches /signIn because it serves every device with no session or data requirements.
 * Also pins the layout's other request-derived body marker, the landing page's navbar-padding opt-out.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class MobileDetectionSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  private val mobileUa = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"

  "The layout's data-mobile-device stamp" should {
    "carry the server's true verdict on a page served to a mobile browser" in {
      val resp = route(app, FakeRequest(GET, "/signIn").withHeaders(mobileUa)).get
      status(resp) mustBe OK
      contentAsString(resp) must include("data-mobile-device=\"true\"")
    }

    "carry the server's false verdict on a page served to a desktop browser" in {
      val resp = route(app, FakeRequest(GET, "/signIn")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("data-mobile-device=\"false\"")
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
