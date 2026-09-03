package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * The `window.assetDigests` stamp must be on the page, ahead of utilities.js (#4893).
 *
 * Losing it costs nothing visible: `util.assetPath` falls back to the plain `/assets/` path, every image still loads,
 * and the only symptom is that a staged build quietly stops serving the fingerprinted, year-cached copies — the exact
 * problem this replaced. Stamping it *after* utilities.js is just as silent, and worse: the tool bundles resolve icon
 * URLs in module-level constants at script-eval time, so they would read an undefined stamp on first load and a
 * populated one on a later navigation.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class AssetManifestWiringSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  "The shared layout" should {
    "stamp the asset-digest manifest on the page" in {
      val resp = route(app, FakeRequest(GET, "/")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("window.assetDigests = ")
    }

    "stamp it before utilities.js, which defines the util.assetPath that reads it" in {
      val resp = route(app, FakeRequest(GET, "/")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)

      val stampAt     = body.indexOf("window.assetDigests")
      val utilitiesAt = body.indexOf("js/common/utilities.js")
      withClue("the manifest stamp is not on the page: ")(stampAt must be >= 0)
      withClue("utilities.js is not loaded at all: ")(utilitiesAt must be >= 0)
      withClue("the stamp comes after utilities.js: ")(stampAt must be < utilitiesAt)
    }
  }
}
