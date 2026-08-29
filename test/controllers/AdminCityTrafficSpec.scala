package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Smoke tests for the cross-city GA traffic endpoint (Planning#8): GET /adminapi/cityTraffic (Owner).
 *
 * Verifies the route is wired (not 404) and the auth guard is in place — unauthenticated requests are redirected to
 * sign-in rather than served data — and that a deployment with an unusable service-account key (the dev/CI dummy)
 * reports traffic as unavailable instead of failing. Boots the full application with a real DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminCityTrafficSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Force the unusable-key path so the unavailability assertion holds even where a real key is configured.
      .configure("ga-service-account-key" -> "DUMMY_GA_SERVICE_ACCOUNT_KEY")
      .build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /adminapi/cityTraffic" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/cityTraffic")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "TrafficService.getCityTraffic" should {
    "report traffic as not configured when the service-account key is unusable" in {
      val trafficService = app.injector.instanceOf[service.TrafficService]
      await(trafficService.getCityTraffic()) mustBe None
    }
  }
}
