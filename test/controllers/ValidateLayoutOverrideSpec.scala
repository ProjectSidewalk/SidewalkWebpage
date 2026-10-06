package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, SidewalkSpec, UserAgents}

/**
 * Functional tests for the `?layout=immersive` QA override on /validate (#5580).
 *
 * A phone's user agent is redirected to /mobile, so the responsive layout that will replace that page can't be
 * reached from a real phone without this override. The override must serve the unified page to a phone and leave
 * every other request as it was: a phone without it still goes to /mobile with its query string, and a desktop is
 * never redirected either way.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class ValidateLayoutOverrideSpec extends SidewalkSpec with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // This suite mints a session per test, and /anonSignUp is capped per IP per hour.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  /** The unified page's own bundle, which the /mobile view never loads. */
  private val UnifiedBundle = "build/js/validate"

  "GET /validate" should {
    "redirect a phone to /mobile with its query string when no layout is asked for" in {
      val resp = route(
        app,
        FakeRequest(GET, "/validate?regions=5").withHeaders(UserAgents.mobile).withCookies(freshAnonSession()*)
      ).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp) mustBe Some("/mobile?regions=5")
    }

    "serve the unified page to a phone that asks for layout=immersive" in {
      val resp = route(
        app,
        FakeRequest(GET, "/validate?layout=immersive").withHeaders(UserAgents.mobile).withCookies(freshAnonSession()*)
      ).get
      status(resp) mustBe OK
      contentAsString(resp) must include(UnifiedBundle)
    }

    "still redirect a phone that asks for some other layout" in {
      val resp = route(
        app,
        FakeRequest(GET, "/validate?layout=mobile").withHeaders(UserAgents.mobile).withCookies(freshAnonSession()*)
      ).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).getOrElse("") must startWith("/mobile")
    }

    "never redirect a desktop, with or without the override" in {
      for (path <- Seq("/validate", "/validate?layout=immersive")) {
        val resp = route(app, FakeRequest(GET, path).withCookies(freshAnonSession()*)).get
        status(resp) mustBe OK
        contentAsString(resp) must include(UnifiedBundle)
      }
    }
  }
}
