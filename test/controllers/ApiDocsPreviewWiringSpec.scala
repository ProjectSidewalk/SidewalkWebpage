package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Five api-docs preview scripts call `window.createApiTableWrapper` from their render callbacks, and the only thing
 * that defines it is the `apiTableWrapper.js` tag in apiDocs/layout.scala.html, ahead of `@content`. Drop or reorder
 * that tag and every one of those previews renders "Failed to load…" in production while nothing goes red: each
 * preview's `.catch` turns the TypeError into a banner rather than a console error the Playwright smoke suite fails
 * on, and the jsdom suites in test/js hand-load the helper themselves, so they can't see it leave the page.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ApiDocsPreviewWiringSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  /**
   * Each api-docs page with the wrapper-calling preview scripts it embeds, named without the `.js` a staged build
   * would fingerprint away.
   */
  private val pagesWithWrapperPreviews: Seq[(String, Seq[String])] = Seq(
    "/v3/api-docs"                         -> Seq("labelTagsPreview", "labelTypesPreview"),
    "/v3/api-docs/labelTypes"              -> Seq("labelTypesPreview"),
    "/v3/api-docs/labelTags"               -> Seq("labelTagsPreview"),
    "/v3/api-docs/streetTypes"             -> Seq("streetTypesPreview"),
    "/v3/api-docs/aggregate-stats"         -> Seq("aggregateStatsPreview"),
    "/v3/api-docs/validation-result-types" -> Seq("validationResultTypesPreview")
  )

  "Every api-docs page whose previews render a table" should {
    "load apiTableWrapper.js, ahead of the preview scripts that call it" in {
      pagesWithWrapperPreviews.foreach { case (path, previews) =>
        withClue(s"GET $path: ") {
          val resp = route(app, FakeRequest(GET, path)).get
          status(resp) mustBe OK
          val body = contentAsString(resp)

          val wrapperAt = body.indexOf("apiTableWrapper")
          withClue("apiTableWrapper.js is not loaded at all: ")(wrapperAt must be >= 0)

          previews.foreach { preview =>
            val previewAt = body.indexOf(preview)
            withClue(s"$preview.js is not embedded: ")(previewAt must be >= 0)
            withClue(s"$preview.js loads before apiTableWrapper.js: ")(wrapperAt must be < previewAt)
          }
        }
      }
    }
  }
}
