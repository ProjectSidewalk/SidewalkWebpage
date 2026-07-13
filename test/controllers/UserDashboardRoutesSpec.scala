package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Route-wiring smoke test for the dashboard/leaderboard/settings/profile pages and the public-profile map endpoints.
 * Boots the real app and hits each route unauthenticated: every page is a SecuredAction, so the contract is a
 * redirect to sign-in (3xx) — never a 404, which would mean the route is missing/misspelled in conf/routes. Cheap
 * insurance against a routes regression; the auth'd behavior is covered by the service specs. Also pins the
 * pre-cutover /preview URLs to their permanent redirects (#4474).
 */
class UserDashboardRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private def redirectsToSignIn(sc: Int): Boolean = sc >= 300 && sc < 400

  private val getRoutes = Seq(
    "/dashboard", "/dashboard/settings", "/profile/somebody", "/leaderboard", "/userapi/public/somebody/streets",
    "/userapi/public/somebody/labels"
  )

  // Pre-cutover URL -> production URL (#4474); each must 301 so old bookmarks and links keep working.
  private val previewRedirects = Seq(
    "/dashboard/preview"            -> "/dashboard",
    "/dashboard/preview/settings"   -> "/dashboard/settings",
    "/dashboard/preview/u/somebody" -> "/profile/somebody",
    "/leaderboard/preview"          -> "/leaderboard"
  )

  "The dashboard routes" should {
    getRoutes.foreach { path =>
      s"exist and redirect an unauthenticated GET $path to sign-in (3xx, not 404)" in {
        redirectsToSignIn(status(route(app, FakeRequest(GET, path)).get)) mustBe true
      }
    }

    Seq("/dashboard/settings", "/userapi/mistakeVote", "/userapi/mistakeNote").foreach { path =>
      s"exist and redirect an unauthenticated POST $path to sign-in (3xx, not 404)" in {
        redirectsToSignIn(status(route(app, FakeRequest(POST, path).withJsonBody(Json.obj())).get)) mustBe true
      }
    }

    previewRedirects.foreach { case (from, to) =>
      s"permanently redirect the pre-cutover $from to $to" in {
        val result = route(app, FakeRequest(GET, from)).get
        status(result) mustBe MOVED_PERMANENTLY
        redirectLocation(result) mustBe Some(to)
      }
    }
  }
}
