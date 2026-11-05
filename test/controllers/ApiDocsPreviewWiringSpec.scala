package controllers

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/**
 * Every api-docs page loads its own page entry (frontend/js/pages/api-docs/<page>.js), which is what builds its
 * previews. A view that drops the tag, or names another page's entry, renders its static text fine and its preview
 * boxes empty while nothing goes red: the Playwright smoke suite only fails on console errors, and a missing module
 * tag raises none.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ApiDocsPreviewWiringSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  /** Each api-docs page with the entry it must load, named without the `.js` a staged build would fingerprint away. */
  private val pagesWithEntries: Seq[(String, String)] = Seq(
    "/v3/api-docs"                         -> "index",
    "/v3/api-docs/labelTypes"              -> "labelTypes",
    "/v3/api-docs/labelTags"               -> "labelTags",
    "/v3/api-docs/streetTypes"             -> "streetTypes",
    "/v3/api-docs/aggregate-stats"         -> "aggregateStats",
    "/v3/api-docs/validation-result-types" -> "validationResultTypes"
  )

  "Every api-docs page" should {
    "load the shared layout entry and its own page entry" in {
      pagesWithEntries.foreach { case (path, entry) =>
        withClue(s"GET $path: ") {
          val resp = route(app, FakeRequest(GET, path)).get
          status(resp) mustBe OK
          val body = contentAsString(resp)

          withClue("the layout entry is not loaded: ")(body must include("build/js/api-docs/layout.js"))
          withClue(s"the $entry entry is not loaded: ")(body must include(s"build/js/api-docs/$entry.js"))
        }
      }
    }
  }
}
