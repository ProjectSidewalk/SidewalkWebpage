package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * The AccessScore Spotlight is actually mounted on the two pages it belongs to (#5215).
 *
 * The module builds its own markup, so the only thing the templates owe it is a place to build into, its script and
 * stylesheet, and a translated section title. None of that fails loudly: a container renamed on one page leaves a
 * blank gap where the lists should be, and a missing script leaves the container hidden forever — both of which look
 * exactly like "this city has nothing ranked yet", which is the module's own commonest state. These pin the wiring
 * so that ambiguity can't hide a broken page.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AccessScoreSpotlightPageSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  implicit lazy val mat: Materializer = app.materializer

  /** Renders a page for a cookie-less visitor, the way the landing page is usually first seen. */
  private def render(path: String): String = {
    val resp = route(app, FakeRequest(GET, path)).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  "The landing page" should {
    "mount the Spotlight above the choropleth, hidden until its feed answers" in {
      val body = render("/")

      body must include("""id="access-score-spotlight-container"""")
      body must include("js/AccessScoreSpotlight.js")
      body must include("js/common/scoreRamp.js") // The bars are painted from the shared ramp.
      body must include("css/components/access-score-spotlight.css")
      body must include("new AccessScoreSpotlight(")
      // Hidden on arrival: a section that unhid itself and then found nothing ranked would flash an empty gap.
      body must include regex """id="access-score-spotlight-container"\s+hidden"""
      // Above the choropleth, so a hovered row's neighborhood lights up without scrolling.
      body.indexOf("""id="access-score-spotlight-container"""") must be <
        body.indexOf("""id="landing-choropleth-container"""")
    }

    "print a translated section title rather than a raw message key" in {
      val body = render("/")
      body must include("""id="access-score-spotlight-title"""")
      body must not include "landing.spotlight.title"
    }
  }

  "The cities page" should {
    "mount the Spotlight in its cross-city form, between the hero and the call to action" in {
      val body = render("/cities")

      body must include("""id="access-score-spotlight-container"""")
      body must include("js/AccessScoreSpotlight.js")
      body must include("css/components/access-score-spotlight.css")
      // The cross-city flag is what switches the feed to `scope=cities` and the highlight to the city circles.
      body must include("{ crossCity: true }")
      body.indexOf("""id="access-score-spotlight-container"""") must be < body.indexOf("""class="cta-section"""")
      body must not include "cities.spotlight.title"
    }
  }

  "The API docs" should {
    "carry a page for the Spotlight endpoint, linked from the sidebar" in {
      val body = render("/v3/api-docs/accessScoreSpotlight")

      body must include("/v3/api/accessScoreSpotlight")
      body must include("min_region_completion")
      body must include("""href="/v3/api-docs/accessScoreSpotlight"""")
    }
  }
}
