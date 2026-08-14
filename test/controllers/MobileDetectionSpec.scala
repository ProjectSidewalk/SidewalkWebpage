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
}
