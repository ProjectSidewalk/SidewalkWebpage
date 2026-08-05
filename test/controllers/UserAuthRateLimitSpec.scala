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

import java.util.UUID

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

  /** A sign-in that can't succeed, from a caller-chosen source address so each test owns its own per-IP bucket. */
  private def badLogin(email: String, ip: String) = {
    route(
      app,
      FakeRequest(POST, "/authenticate/credentials")
        .withConnection(RemoteConnection(ip, secure = false, None))
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withFormUrlEncodedBody("email" -> email, "password" -> "WrongPass9A", "rememberMe" -> "true")
        .withCSRFToken
    ).get
  }

  "The per-IP login rate limiter" should {
    "return 429 with a Retry-After header once the per-window attempt budget is exceeded" in {
      // A distinct identifier per attempt, so only the per-IP bucket can accumulate — otherwise the per-identifier
      // limit (also 2 here) would trip on the same attempt and the assertion couldn't tell the two apart.
      def attempt(n: Int) = badLogin(s"burst$n@example.test", "10.0.0.1")

      status(attempt(1)) mustBe UNAUTHORIZED
      status(attempt(2)) mustBe UNAUTHORIZED

      val throttled = attempt(3)
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
      status(badLogin("Target@Example.Test", "10.1.0.1")) mustBe UNAUTHORIZED
      status(badLogin("target@example.test", "10.1.0.2")) mustBe UNAUTHORIZED

      val throttled = badLogin("TARGET@EXAMPLE.TEST", "10.1.0.3")
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined

      // A different identifier from yet another fresh IP is unaffected — proves the key, not some global counter.
      status(badLogin("someone.else@example.test", "10.1.0.4")) mustBe UNAUTHORIZED
    }

    "charge only failed attempts, refunding the budget when a sign-in succeeds" in {
      // Needs a real account so the success path actually runs. Every request rides its own IP: the per-IP budget is
      // 2 here and this test needs six.
      val tag      = UUID.randomUUID().toString.replace("-", "").take(20)
      val email    = s"refund.$tag@example.test"
      val password = "TestPass1"

      val signUp = route(
        app,
        FakeRequest(POST, "/signUp")
          .withConnection(RemoteConnection("10.6.0.1", secure = false, None))
          .withHeaders("X-Requested-With" -> "XMLHttpRequest")
          .withFormUrlEncodedBody(
            "username"        -> s"refund$tag",
            "email"           -> email,
            "password"        -> password,
            "passwordConfirm" -> password,
            "terms"           -> "true",
            "returnUrl"       -> "/explore"
          )
          .withCSRFToken
      ).get
      status(signUp) mustBe OK

      def goodLogin(ip: String) = route(
        app,
        FakeRequest(POST, "/authenticate/credentials")
          .withConnection(RemoteConnection(ip, secure = false, None))
          .withHeaders("X-Requested-With" -> "XMLHttpRequest")
          .withFormUrlEncodedBody("email" -> email, "password" -> password, "rememberMe" -> "false")
          .withCSRFToken
      ).get

      status(badLogin(email, "10.6.0.2")) mustBe UNAUTHORIZED // 1 of 2 spent.
      status(goodLogin("10.6.0.3")) mustBe OK                 // Refunds it.

      // A limiter that charged every attempt would be at three by now and answer 429. Two more failures must fit.
      status(badLogin(email, "10.6.0.4")) mustBe UNAUTHORIZED
      status(badLogin(email, "10.6.0.5")) mustBe UNAUTHORIZED

      status(badLogin(email, "10.6.0.6")) mustBe TOO_MANY_REQUESTS
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

/**
 * Sign-in carries two per-IP bounds — a per-minute burst cap and a per-hour volume cap — and from a single address
 * only the tighter of the two can ever be observed, so this suite exists to make the volume cap the binding one.
 * That cap is what covers credential stuffing: many accounts, one guess each, spread thinly enough that a per-minute
 * cap never notices and a per-account cap never sees the same account twice. `UserAuthRateLimitSpec` has the budgets
 * the other way round and covers the burst cap.
 */
class LoginIpVolumeRateLimitSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"                        -> true,
        "rate-limit.login.max-attempts"             -> 100, // Held out of the way so only the hourly bound can trip.
        "rate-limit.login.window-seconds"           -> 60,
        "rate-limit.login-ip-hourly.max-attempts"   -> 2,
        "rate-limit.login-ip-hourly.window-seconds" -> 3600
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  "The per-IP hourly login volume limiter" should {
    "throttle one address working through a series of different accounts" in {
      // A different account every time, so neither the per-identifier budget nor some global counter can explain it.
      def attempt(n: Int) =
        route(
          app,
          FakeRequest(POST, "/authenticate/credentials")
            .withConnection(RemoteConnection("10.7.0.1", secure = false, None))
            .withHeaders("X-Requested-With" -> "XMLHttpRequest")
            .withFormUrlEncodedBody("email" -> s"stuffing$n@example.test", "password" -> "WrongPass9A")
            .withCSRFToken
        ).get

      status(attempt(1)) mustBe UNAUTHORIZED
      status(attempt(2)) mustBe UNAUTHORIZED

      val throttled = attempt(3)
      status(throttled) mustBe TOO_MANY_REQUESTS
      header("Retry-After", throttled) mustBe defined
    }
  }
}
