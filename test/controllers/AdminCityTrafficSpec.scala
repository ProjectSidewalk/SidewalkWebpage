package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/**
 * Smoke tests for the GA traffic endpoints (Planning#8): GET /adminapi/cityTraffic (Owner) and GET /adminapi/traffic
 * (Admin).
 *
 * Verifies each route is wired (not 404) and the auth guard is in place — unauthenticated requests are redirected to
 * sign-in rather than served data — and that a deployment with an unusable service-account key (the dev/CI dummy)
 * reports traffic as unavailable instead of failing. Boots the full application with a real DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminCityTrafficSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Force the unusable-key path so the unavailability assertion holds even where a real key is configured.
      .configure("ga-service-account-key" -> "DUMMY_GA_SERVICE_ACCOUNT_KEY")
      .build()

  given mat: Materializer = app.materializer

  "GET /adminapi/cityTraffic" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/cityTraffic")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "GET /adminapi/traffic" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/traffic")).get
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "TrafficService.getCurrentCityTraffic" should {
    "report traffic as not configured when the service-account key is unusable" in {
      val trafficService = app.injector.instanceOf[service.TrafficService]
      await(trafficService.getCurrentCityTraffic()) mustBe None
    }
  }

  "TrafficService.getCityTraffic" should {
    "report traffic as not configured when the service-account key is unusable" in {
      val trafficService = app.injector.instanceOf[service.TrafficService]
      await(trafficService.getCityTraffic()) mustBe None
    }
  }
}
