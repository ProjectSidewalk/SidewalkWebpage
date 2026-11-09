package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/** `GET /health` (#4548) against the full app and a real database, so the "ok" path is the one a probe sees. */
class HealthEndpointSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application = GuiceApplicationBuilder().disable[modules.ActorModule].build()

  given mat: Materializer = app.materializer

  "GET /health" should {
    "answer 200 with the build and release metadata, uncached, without minting a session" in {
      val resp = route(app, FakeRequest(GET, "/health")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
      header(CACHE_CONTROL, resp) mustBe Some("no-store")
      // No Set-Cookie proves no anonymous account was minted for the probe.
      header(SET_COOKIE, resp) mustBe None

      val body = contentAsJson(resp).as[JsObject]
      (body \ "status").as[String] mustBe "ok"
      (body \ "version").as[String] must not be empty
      (body \ "version_released_at").asOpt[String] mustBe defined
      (body \ "city_id").as[String] mustBe app.configuration.get[String]("city-id")
      (body \ "environment").as[String] mustBe app.configuration.get[String]("environment-type")
      (body \ "app_started_at").asOpt[String] mustBe defined
      // The git fields are absent where git couldn't answer at build time, so only the flag is pinned.
      (body \ "git_dirty").asOpt[Boolean] mustBe defined
    }
  }
}
