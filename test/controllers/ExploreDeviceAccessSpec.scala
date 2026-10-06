package controllers

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, SidewalkSpec, UserAgents}

/**
 * Explore is served to every device (#5664). Whether a screen is big enough to label on depends on its shape and size,
 * which only the browser knows, so the page carries the small-screen notice and decides client-side. These pin that no
 * user agent is redirected away any more: a tablet that announces itself used to bounce to /mobileLanding.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ExploreDeviceAccessSpec extends SidewalkSpec with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  /** Requests /explore as a fresh anonymous user with the given UA, which Silhouette also fingerprints the session by. */
  private def explorePage(ua: (String, String)) = {
    val cookies = freshAnonSession(ua)
    route(app, FakeRequest(GET, "/explore").withHeaders(ua).withCookies(cookies*)).get
  }

  "GET /explore" should {
    for ((device, ua) <- Seq("tablet" -> UserAgents.tablet, "phone" -> UserAgents.mobile)) {
      s"serve the page, with the small-screen notice in it, to a $device user agent" in {
        val resp = explorePage(ua)
        status(resp) mustBe OK
        redirectLocation(resp) mustBe None
        val body = contentAsString(resp)
        body must include("id=\"page-data\"")
        body must include("id=\"explore-small-screen\"")
      }
    }

    "link Explore in the navbar for a mobile user agent" in {
      contentAsString(explorePage(UserAgents.mobile)) must include("id=\"navbar-start-btn\"")
    }
  }
}
