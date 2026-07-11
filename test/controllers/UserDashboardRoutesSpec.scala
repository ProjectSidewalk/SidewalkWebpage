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
 * Route-wiring smoke test for the redesigned dashboard/leaderboard/settings/profile and the public-profile map
 * endpoints. Boots the real app and hits each route unauthenticated: every one is a SecuredAction, so the contract is
 * a redirect to sign-in (3xx) — never a 404, which would mean the route is missing/misspelled in conf/routes. Cheap
 * insurance against a routes regression; the auth'd behavior is covered by the service specs.
 */
class UserDashboardRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private def redirectsToSignIn(sc: Int): Boolean = sc >= 300 && sc < 400

  private val getRoutes = Seq(
    "/dashboard/preview", "/dashboard/preview/settings", "/dashboard/preview/u/somebody", "/leaderboard/preview",
    "/userapi/public/somebody/streets", "/userapi/public/somebody/labels"
  )

  "The redesigned dashboard routes" should {
    getRoutes.foreach { path =>
      s"exist and redirect an unauthenticated GET $path to sign-in (3xx, not 404)" in {
        redirectsToSignIn(status(route(app, FakeRequest(GET, path)).get)) mustBe true
      }
    }

    Seq("/dashboard/preview/settings", "/userapi/mistakeVote", "/userapi/mistakeNote").foreach { path =>
      s"exist and redirect an unauthenticated POST $path to sign-in (3xx, not 404)" in {
        redirectsToSignIn(status(route(app, FakeRequest(POST, path).withJsonBody(Json.obj())).get)) mustBe true
      }
    }
  }
}
