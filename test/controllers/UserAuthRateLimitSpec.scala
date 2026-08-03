package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.request.RemoteConnection
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Proves the auth rate limiter is actually wired into the sign-in, anon-signup, and password-reset paths
 * (#4375, #1102). Boots the app with tiny per-window budgets, then exceeds them and asserts the throttle responses —
 * `UserAuthControllerSpec` pins the limiter off, so it can't cover this.
 *
 * One app per suite means one shared limiter, so each test isolates its buckets with its own fake source IPs (via
 * `withConnection`) and its own identifiers. Note that `route()` bypasses the server layer where Play processes
 * X-Forwarded-For, so `withConnection` sets the resolved remote address directly; end-to-end header processing is
 * covered by `ForwardedClientIpSpec`.
 */
class UserAuthRateLimitSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"                         -> true,
        "rate-limit.login.max-attempts"              -> 2,
        "rate-limit.login.window-seconds"            -> 60,
        "rate-limit.login-identifier.max-attempts"   -> 2,
        "rate-limit.login-identifier.window-seconds" -> 300,
        "rate-limit.anon-signup.max-attempts"        -> 2,
        "rate-limit.anon-signup.window-seconds"      -> 3600,
        "rate-limit.reset-password.max-attempts"     -> 2,
        "rate-limit.reset-password.window-seconds"   -> 3600,
        "rate-limit.forgot.max-attempts"             -> 2,
        "rate-limit.forgot.window-seconds"           -> 3600
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private def badLogin(email: String = "throttle@example.test", ip: Option[String] = None) = {
    val base = FakeRequest(POST, "/authenticate/credentials")
    route(
      app,
      ip.fold(base)(addr => base.withConnection(RemoteConnection(addr, secure = false, None)))
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withFormUrlEncodedBody("email" -> email, "password" -> "WrongPass9A", "rememberMe" -> "true")
        .withCSRFToken
    ).get
  }

  "The per-IP login rate limiter" should {
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

    "not consult the X-Forwarded-For header when bucketing by IP" in {
      // Same source address, a different client-supplied XFF each time. The old first-XFF-value resolution would have
      // put each request in its own bucket and never throttled; remoteAddress-based resolution must ignore the header
      // (#1102). Distinct identifiers keep the per-identifier limit out of the picture.
      def spoofed(n: Int) =
        route(
          app,
          FakeRequest(POST, "/authenticate/credentials")
            .withConnection(RemoteConnection("10.2.0.1", secure = false, None))
            .withHeaders("X-Requested-With" -> "XMLHttpRequest", "X-Forwarded-For" -> s"172.16.$n.$n")
            .withFormUrlEncodedBody("email" -> s"xff$n@example.test", "password" -> "WrongPass9A")
            .withCSRFToken
        ).get

      status(spoofed(1)) mustBe UNAUTHORIZED
      status(spoofed(2)) mustBe UNAUTHORIZED
      status(spoofed(3)) mustBe TOO_MANY_REQUESTS
    }
  }

  "The per-identifier login rate limiter" should {
    "throttle a targeted account across distinct IPs, keyed case-insensitively" in {
      // Each attempt comes from a fresh IP, so only the identifier bucket can accumulate.
      status(badLogin("Target@Example.Test", Some("10.1.0.1"))) mustBe UNAUTHORIZED
      status(badLogin("target@example.test", Some("10.1.0.2"))) mustBe UNAUTHORIZED

      val throttled = badLogin("TARGET@EXAMPLE.TEST", Some("10.1.0.3"))
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined

      // A different identifier from yet another fresh IP is unaffected — proves the key, not some global counter.
      status(badLogin("someone.else@example.test", Some("10.1.0.4"))) mustBe UNAUTHORIZED
    }
  }

  "The anon-signup rate limiter" should {
    "return a plain 429 — never a redirect — once the per-IP budget is exceeded" in {
      def anonSignUp() =
        route(
          app,
          FakeRequest(GET, "/anonSignUp?url=%2F").withConnection(RemoteConnection("10.3.0.1", secure = false, None))
        ).get

      status(anonSignUp()) mustBe SEE_OTHER
      status(anonSignUp()) mustBe SEE_OTHER

      val throttled = anonSignUp()
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined
      // Guard against a future refactor responding with a redirect: every SecuredAction bounces cookie-less clients
      // back to /anonSignUp, so a redirect here would loop.
      header("Location", throttled) mustBe empty
    }
  }

  "The reset-password rate limiter" should {
    "throttle repeated reset attempts from one IP" in {
      def resetAttempt() =
        route(
          app,
          FakeRequest(POST, "/resetPassword?token=not-a-real-token")
            .withConnection(RemoteConnection("10.4.0.1", secure = false, None))
            // XHR marker so the throttle branch answers 429 JSON; the within-budget bounce is a 303 either way,
            // which keeps the two outcomes distinguishable by status.
            .withHeaders("X-Requested-With" -> "XMLHttpRequest")
            .withFormUrlEncodedBody("password" -> "NewPass9A", "passwordConfirm" -> "NewPass9A")
            .withCSRFToken
        ).get

      // Bogus tokens bounce to /signIn with a flash; that's the within-budget behavior.
      status(resetAttempt()) mustBe SEE_OTHER
      status(resetAttempt()) mustBe SEE_OTHER

      val throttled = resetAttempt()
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined
    }
  }

  "The forgot-password rate limiter" should {
    "throttle one target email across distinct IPs" in {
      // An unknown address exercises the EmailNotFound path, so no mail delivery is involved.
      def forgot(email: String, ip: String) =
        route(
          app,
          FakeRequest(POST, "/forgotPassword")
            .withConnection(RemoteConnection(ip, secure = false, None))
            // XHR marker so the throttle branch answers 429 JSON instead of a 303 that would mimic the success bounce.
            .withHeaders("X-Requested-With" -> "XMLHttpRequest")
            .withFormUrlEncodedBody("emailForgotPassword" -> email)
            .withCSRFToken
        ).get

      status(forgot("bombed@example.test", "10.5.0.1")) mustBe SEE_OTHER
      status(forgot("bombed@example.test", "10.5.0.2")) mustBe SEE_OTHER

      // Third request for the same address rides a fresh IP, so only the per-email key can be what throttles it.
      val throttled = forgot("bombed@example.test", "10.5.0.3")
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined

      // A different address from another fresh IP is unaffected.
      status(forgot("fine@example.test", "10.5.0.4")) mustBe SEE_OTHER
    }
  }
}
