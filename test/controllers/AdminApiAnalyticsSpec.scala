package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Smoke tests for GET /adminapi/apiAnalytics.
 *
 * The endpoint requires admin authentication. These tests verify the route is wired correctly (not 404)
 * and that the auth guard is in place (unauthenticated users are redirected to sign-in rather than served
 * data). Booting the full application with a real DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminApiAnalyticsSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /adminapi/apiAnalytics" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/apiAnalytics")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      val sc = status(resp)
      sc must (be >= 300 and be < 400)
    }

    "also redirect with excludeApiDocs=false&days=90 params (route accepts optional params)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/apiAnalytics?excludeApiDocs=false&days=90")).get
      val sc   = status(resp)
      sc must (be >= 300 and be < 400)
    }
  }
}
