package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Smoke tests for the 8 admin page routes added in the dashboard redesign (#4272).
 *
 * Each test issues an unauthenticated GET and asserts a 3xx redirect (to sign-in), not a 404.
 * A 404 means the route is absent; a 500 means the controller or template is broken.
 * These caught the "Admin is not defined" class of regression (#4276).
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminPageSmokeSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private def assertRedirect(path: String): Unit = {
    val resp = route(app, FakeRequest(GET, path)).get
    val sc   = status(resp)
    withClue(s"$path returned $sc, expected a 3xx redirect") {
      sc must (be >= 300 and be < 400)
    }
  }

  "GET /admin" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin")
    }
  }

  "GET /admin/overview" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/overview")
    }
  }

  "GET /admin/map" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/map")
    }
  }

  "GET /admin/analytics" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/analytics")
    }
  }

  "GET /admin/labels" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/labels")
    }
  }

  "GET /admin/users" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/users")
    }
  }

  "GET /admin/label-search" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/label-search")
    }
  }

  "GET /admin/teams" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/teams")
    }
  }

  "GET /admin/api-analytics" should {
    "redirect unauthenticated users (not 404 or 500)" in {
      assertRedirect("/admin/api-analytics")
    }
  }
}
