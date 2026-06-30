package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Smoke tests for the cross-city engagement-funnel endpoints (#288): GET /adminapi/cityFunnels (Owner) and
 * GET /adminapi/updateFunnelStats (Admin).
 *
 * Verifies the routes are wired (not 404) and the auth guards are in place — unauthenticated requests are redirected to
 * sign-in rather than served data — across the optional window param. Boots the full application with a real DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminCityFunnelsSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /adminapi/cityFunnels" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/cityFunnels")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      status(resp) must (be >= 300 and be < 400)
    }

    "also redirect for each supported window (route accepts the optional window param)" in {
      Seq("30d", "90d", "all").foreach { w =>
        val resp = route(app, FakeRequest(GET, s"/adminapi/cityFunnels?window=$w")).get
        status(resp) must (be >= 300 and be < 400)
      }
    }
  }

  "GET /adminapi/updateFunnelStats" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/updateFunnelStats")).get
      status(resp) must (be >= 300 and be < 400)
    }
  }
}
