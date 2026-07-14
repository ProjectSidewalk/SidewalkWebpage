package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Proves the auth rate limiter is actually wired into the sign-in path (#4375). Boots the app with
 * `rate-limit.enabled = true` and a tiny per-window budget, then exceeds it and asserts the throttle response — the
 * default-off `UserAuthControllerSpec` can't cover this since the limiter is inert there.
 */
class UserAuthRateLimitSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"              -> true,
        "rate-limit.login.max-attempts"   -> 2,
        "rate-limit.login.window-seconds" -> 60
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private def badLogin() =
    route(
      app,
      FakeRequest(POST, "/authenticate/credentials")
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withFormUrlEncodedBody("email" -> "throttle@example.test", "password" -> "WrongPass9A", "rememberMe" -> "true")
        .withCSRFToken
    ).get

  "The login rate limiter" should {
    "return 429 with a Retry-After header once the per-window attempt budget is exceeded" in {
      // First two attempts are within budget (unauthorized, not throttled).
      status(badLogin()) mustBe UNAUTHORIZED
      status(badLogin()) mustBe UNAUTHORIZED

      // The third crosses the limit.
      val throttled = badLogin()
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined
      (contentAsJson(throttled) \ "errors" \ "_summary").asOpt[String] mustBe defined
    }
  }
}
