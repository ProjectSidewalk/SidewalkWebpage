package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/**
 * The AccessScore Spotlight is actually mounted on the two pages it belongs to (#5215).
 *
 * The module builds its own markup, so a template owes it only a container, the page entry that constructs it, its
 * stylesheet, and a translated title. None of that fails loudly: a renamed container or a missing entry just leaves
 * the section hidden, which is also what "this city has nothing ranked yet" looks like. These pin the wiring. The
 * stylesheet arrives through the module's own import (#5651), so what the page links is the chunk Vite names after
 * the module.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AccessScoreSpotlightPageSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  private val SpotlightStylesheet = """build/css/AccessScoreSpotlight-[^"]+\.css"""

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  given mat: Materializer = app.materializer

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
      body must include("build/js/home.js")
      body must include regex SpotlightStylesheet
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
      body must include("build/js/deploymentSites.js")
      body must include regex SpotlightStylesheet
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
