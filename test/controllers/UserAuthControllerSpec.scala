package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID

/**
 * In-JVM functional tests for the redesigned auth controller (#4375). Boots the real app against Postgres so the
 * whole stack runs: routing, the CSRF filter, form binding, the profanity guard, Silhouette, and the DAO layer.
 *
 * Two kinds of assertions: (1) side-effect-free rejections (bad CSRF, bad credentials, invalid/blocked sign-ups) that
 * never write a row, and (2) one happy-path round-trip that creates a throwaway UUID-tagged user to prove the async
 * JSON contract end to end — including that the authenticator cookie is embedded on the non-redirect 200 (the risk
 * flagged when moving `embed` onto `Ok(json)`), which the read-only route specs can't cover.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class UserAuthControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** A username/email pair that can't collide with existing data, so the happy path is repeatable. */
  private def freshCreds(): (String, String, String) = {
    val tag = UUID.randomUUID().toString.replace("-", "").take(20)
    (s"spec$tag", s"spec.$tag@example.test", "TestPass1")
  }

  private def signUpBody(username: String, email: String, password: String, confirm: String, terms: String = "true") =
    Seq(
      "username"        -> username,
      "email"           -> email,
      "password"        -> password,
      "passwordConfirm" -> confirm,
      "terms"           -> terms,
      "returnUrl"       -> "/explore"
    )

  // CSRF is enforced by Play's global filter (verified live: a real browser session with a CSRF cookie but no body
  // token gets a 403). Reproducing that precondition in-JVM means minting the CSRF cookie the app issues, which is
  // exactly what `.withCSRFToken` does — so every POST below carries it, proving the endpoints sit behind the filter.

  "POST /signUp (async)" should {
    "reject mismatched passwords with a 400 and a JSON summary, without creating a user" in {
      val (u, e, p) = freshCreds()
      val req       = FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(signUpBody(u, e, p, "DifferentPass9"): _*)
        .withCSRFToken
      val resp = route(app, req).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "errors" \ "_summary").asOpt[String] mustBe defined
    }

    "reject a disallowed-character username at the field level (400)" in {
      val (_, e, p) = freshCreds()
      val req       = FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(signUpBody("bad name!", e, p, p): _*)
        .withCSRFToken
      val resp = route(app, req).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "errors" \ "username").asOpt[String] mustBe defined
    }

    "reject an offensive username via the profanity guard (400 on the username field)" in {
      val (_, e, p) = freshCreds()
      // Valid charset + length, so it clears form binding and is caught by the guard, not the regex.
      val req = FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(signUpBody("shithead", e, p, p): _*)
        .withCSRFToken
      val resp = route(app, req).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "errors" \ "username").asOpt[String] mustBe defined
    }

    "fall back to a full-page redirect (303) when the request is not an XHR" in {
      val (u, e, p) = freshCreds()
      val req       = FakeRequest(POST, "/signUp")
        .withFormUrlEncodedBody(signUpBody(u, e, p, "Mismatch9"): _*)
        .withCSRFToken
      status(route(app, req).get) mustBe SEE_OTHER
    }
  }

  "POST /authenticate/credentials (async)" should {
    "return 401 with a JSON summary for unknown credentials, without leaking the field" in {
      val req = FakeRequest(POST, "/authenticate/credentials")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "email"      -> s"nobody.${UUID.randomUUID()}@example.test",
          "password"   -> "WrongPass9A",
          "rememberMe" -> "true"
        )
        .withCSRFToken
      val resp = route(app, req).get
      status(resp) mustBe UNAUTHORIZED
      (contentAsJson(resp) \ "errors" \ "_summary").asOpt[String] mustBe defined
    }

    "fall back to a full-page redirect (303) when the request is not an XHR" in {
      val req = FakeRequest(POST, "/authenticate/credentials")
        .withFormUrlEncodedBody(
          "email"      -> s"nobody.${UUID.randomUUID()}@example.test",
          "password"   -> "WrongPass9A",
          "rememberMe" -> "true"
        )
        .withCSRFToken
      status(route(app, req).get) mustBe SEE_OTHER
    }
  }

  "GET /welcome" should {
    "exist and redirect an unauthenticated visitor to the home page (never 404)" in {
      val resp = route(app, FakeRequest(GET, "/welcome")).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp) mustBe Some("/")
    }
  }

  "GET /signIn and /signUp" should {
    "render the full-page fallback (200)" in {
      status(route(app, FakeRequest(GET, "/signIn")).get) mustBe OK
      status(route(app, FakeRequest(GET, "/signUp")).get) mustBe OK
    }
  }

  "The async happy path" should {
    "create an account, embed the auth cookie on the 200, land on /welcome, block a duplicate, then sign in" in {
      val (username, email, password) = freshCreds()

      // 1. Sign up: 200 JSON with a /welcome redirect, and the authenticator cookie set on the non-redirect result.
      val signUp = route(
        app,
        FakeRequest(POST, "/signUp")
          .withHeaders(XHR)
          .withFormUrlEncodedBody(signUpBody(username, email, password, password): _*)
          .withCSRFToken
      ).get
      status(signUp) mustBe OK
      (contentAsJson(signUp) \ "redirect").as[String] must startWith("/welcome")
      // The authenticator cookie must ride on this non-redirect 200 (the `embed(value, Ok(json))` risk).
      cookies(signUp).exists(_.name.toLowerCase.contains("authenticator")) mustBe true

      // 2. The same username is now taken → 409 on a second attempt (a different email to isolate the username check).
      val (_, otherEmail, _) = freshCreds()
      val dup                = route(
        app,
        FakeRequest(POST, "/signUp")
          .withHeaders(XHR)
          .withFormUrlEncodedBody(signUpBody(username, otherEmail, password, password): _*)
          .withCSRFToken
      ).get
      status(dup) mustBe CONFLICT
      (contentAsJson(dup) \ "errors" \ "username").asOpt[String] mustBe defined

      // 3. The new credentials authenticate → 200 with a redirect and the auth cookie.
      val signIn = route(
        app,
        FakeRequest(POST, "/authenticate/credentials")
          .withHeaders(XHR)
          .withFormUrlEncodedBody("email" -> email, "password" -> password, "rememberMe" -> "true")
          .withCSRFToken
      ).get
      status(signIn) mustBe OK
      (contentAsJson(signIn) \ "redirect").asOpt[String] mustBe defined
      cookies(signIn).exists(_.name.toLowerCase.contains("authenticator")) mustBe true
    }
  }
}
