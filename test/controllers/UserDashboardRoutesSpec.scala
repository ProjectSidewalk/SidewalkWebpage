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
 * Boots the real app and hits each route unauthenticated: the personal pages are SecuredActions, so their contract is
 * a redirect to sign-in (3xx) — never a 404, which would mean the route is missing/misspelled in conf/routes. The
 * leaderboard is public and user-aware since #4643, so it renders (200) instead; SessionlessPagesSpec pins its
 * no-cookie contract. Cheap insurance against a routes regression; the auth'd behavior is covered by the service
 * specs. Also pins the pre-cutover /preview URLs to their permanent redirects (#4474).
 */
class UserDashboardRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private def redirectsToSignIn(sc: Int): Boolean = sc >= 300 && sc < 400

  private val getRoutes = Seq(
    "/dashboard", "/dashboard/settings", "/profile/somebody", "/userapi/public/somebody/streets",
    "/userapi/public/somebody/labels", "/userapi/crossCityStats"
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

    "exist and render the public /leaderboard for an unauthenticated GET (200, not 404/3xx; #4643)" in {
      status(route(app, FakeRequest(GET, "/leaderboard")).get) mustBe OK
    }

    Seq("/dashboard/settings", "/userapi/mistakeVote", "/userapi/mistakeNote").foreach { path =>
      // Only "not 404" here: an unauthenticated write is answered 401 rather than bounced, so the client can mint a
      // session and retry instead of having its submission swallowed by a followed redirect (ControllerUtils
      // .anonSignupRedirect). That contract belongs to those specs; this one is about the route existing.
      s"exist for an unauthenticated POST $path (anything but 404)" in {
        status(route(app, FakeRequest(POST, path).withJsonBody(Json.obj())).get) must not be NOT_FOUND
      }
    }

    "read the cross-city stats subject from the session, never from a parameter (#4496)" in {
      // A mapper's activity in other cities isn't something this deployment's public_profile flag can consent to, so
      // the endpoint must have no way to name someone else. A userId query param must simply be ignored.
      app.injector
        .instanceOf[play.api.routing.Router]
        .documentation
        .find { case (method, path, _) => method == "GET" && path == "/userapi/crossCityStats" }
        .map(_._3) mustBe Some("controllers.UserProfileController.getCrossCityStats")
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
