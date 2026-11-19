package controllers

import models.utils.HealthTable
import models.utils.MyPostgresProfile.api.*
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

import javax.inject.Inject

/**
 * The health routes, on one booted application with a real DB: the Owner-only dashboard (#4561), GET /admin/health
 * and its JSON pollers /adminapi/dbHealth and /adminapi/fleetHealth, which must be wired (not 404) and send an
 * unauthenticated request to sign-in rather than serve the payload; and the public GET /health (#4548), whose "ok"
 * path here is the one a probe sees.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class HealthDashboardSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  given mat: Materializer = app.materializer

  "GET /admin/health" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/admin/health")).get
      // Must be a redirect (3xx) to sign-in — never a 404, which would indicate a missing route.
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "GET /adminapi/dbHealth" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/dbHealth")).get
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "GET /adminapi/fleetHealth" should {
    "redirect unauthenticated users to the sign-in page (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/fleetHealth")).get
      status(resp) must (be >= 300 and be < 400)
    }
  }

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
      (body \ "db_queued").as[Int] must be >= 0
      // The git fields are absent where git couldn't answer at build time, so only the flag is pinned.
      (body \ "git_dirty").asOpt[Boolean] mustBe defined
    }
  }
}

/** Answers but can't load PostGIS, like test's database after a package update (#6005). */
class BrokenPostgisHealthTable @Inject() (provider: DatabaseConfigProvider) extends HealthTable(provider) {
  override def postgisLibVersion: DBIO[String] = sql"SELECT postgis_function_that_does_not_exist()".as[String].head
}

/** GET /health when PostGIS won't load: a 503 that still names the release. */
class HealthPostgisDownSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .overrides(bind[HealthTable].to[BrokenPostgisHealthTable])
      .build()

  given mat: Materializer = app.materializer

  "GET /health" should {
    "answer 503 naming PostGIS, and keep the version, when PostGIS won't load" in {
      val resp = route(app, FakeRequest(GET, "/health")).get
      status(resp) mustBe SERVICE_UNAVAILABLE

      val body = contentAsJson(resp).as[JsObject]
      (body \ "status").as[String] mustBe "error"
      (body \ "error").as[String] mustBe "PostGIS: PSQLException"
      (body \ "version").as[String] must not be empty
    }
  }
}
