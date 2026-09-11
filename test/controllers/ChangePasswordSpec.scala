package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsValue
import play.api.mvc.{Cookie, Result}
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID
import scala.concurrent.Future

/**
 * End-to-end tests for the Settings page's change-password endpoint (#2285). Boots the real app against Postgres and
 * signs up a throwaway UUID-tagged user for each test, so what's proven is the whole path: the CSRF filter, form
 * binding, the current-password check, the database write, and signing in afterward with the new password.
 *
 * Only the change-password limit is switched on, and turned down to three, so the lockout can be reached quickly
 * without the sign-up and sign-in limits (which every request here shares, all from 127.0.0.1) getting in the way.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ChangePasswordSpec extends PlaySpec with GuiceOneAppPerSuite {

  private val MaxWrongGuesses = 3

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"                      -> false,
        "rate-limit.change-password.enabled"      -> true,
        "rate-limit.change-password.max-attempts" -> MaxWrongGuesses
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR          = "X-Requested-With" -> "XMLHttpRequest"
  private val OldPassword  = "TestPass1"
  private val NewPassword  = "NewPass22"
  private val WrongCurrent = "NotMyPass3"

  /** @return A freshly signed-up account's email, and the cookies that keep it signed in. */
  private def signUpFreshUser(): (String, Seq[Cookie]) = {
    val tag    = UUID.randomUUID().toString.replace("-", "").take(20)
    val email  = s"spec.$tag@example.test"
    val signUp = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> email,
          "password"        -> OldPassword,
          "passwordConfirm" -> OldPassword,
          "terms"           -> "true",
          "returnUrl"       -> "/"
        )
        .withCSRFToken
    ).get
    status(signUp) mustBe OK
    (email, cookies(signUp).toSeq)
  }

  private def changePassword(
      session: Seq[Cookie],
      current: String,
      newPassword: String = NewPassword,
      confirm: String = NewPassword
  ): Future[Result] =
    route(
      app,
      FakeRequest(POST, "/dashboard/settings/password")
        .withCookies(session: _*)
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "currentPassword"    -> current,
          "newPassword"        -> newPassword,
          "newPasswordConfirm" -> confirm
        )
        .withCSRFToken
    ).get

  /** @return The HTTP status of signing in with this email and password. */
  private def signInStatus(email: String, password: String): Int =
    status(
      route(
        app,
        FakeRequest(POST, "/authenticate/credentials")
          .withHeaders(XHR)
          .withFormUrlEncodedBody("email" -> email, "password" -> password, "rememberMe" -> "false")
          .withCSRFToken
      ).get
    )

  private def errors(result: Future[Result]): JsValue = (contentAsJson(result) \ "errors").get

  "POST /dashboard/settings/password" should {
    "refuse a wrong current password on its own field, and leave the old password working" in {
      val (email, session) = signUpFreshUser()
      val result           = changePassword(session, WrongCurrent)
      status(result) mustBe BAD_REQUEST
      (errors(result) \ "currentPassword").asOpt[String] mustBe defined
      signInStatus(email, OldPassword) mustBe OK
    }

    "refuse a new password that doesn't match its confirmation, as a banner above the form" in {
      val (_, session) = signUpFreshUser()
      val result       = changePassword(session, OldPassword, confirm = "Different9")
      status(result) mustBe BAD_REQUEST
      (errors(result) \ "_summary").asOpt[String] mustBe defined
    }

    "refuse a new password that breaks the password rules, on the new-password field" in {
      val (_, session) = signUpFreshUser()
      val result       = changePassword(session, OldPassword, newPassword = "short", confirm = "short")
      status(result) mustBe BAD_REQUEST
      (errors(result) \ "newPassword").asOpt[String] mustBe defined
    }

    "change the password, so only the new one signs in, and forgive the wrong guesses that came before" in {
      val (email, session) = signUpFreshUser()
      status(changePassword(session, WrongCurrent)) mustBe BAD_REQUEST

      val result = changePassword(session, OldPassword)
      status(result) mustBe OK
      (contentAsJson(result) \ "success").as[Boolean] mustBe true
      signInStatus(email, OldPassword) mustBe UNAUTHORIZED
      signInStatus(email, NewPassword) mustBe OK

      // The earlier wrong guess was forgiven by the success, so a full allowance of fresh ones is still just refused,
      // never locked out. Without the reset, the last of these would be a 429.
      (1 to MaxWrongGuesses).foreach(_ => status(changePassword(session, WrongCurrent)) mustBe BAD_REQUEST)
    }

    "leave the forgot-password page open to a signed-in user, since the form links there" in {
      val (_, session) = signUpFreshUser()
      status(route(app, FakeRequest(GET, "/forgotPassword").withCookies(session: _*)).get) mustBe OK
    }

    "lock the form after too many wrong current passwords, even when the right one finally arrives" in {
      val (email, session) = signUpFreshUser()
      (1 to MaxWrongGuesses).foreach(_ => status(changePassword(session, WrongCurrent)) mustBe BAD_REQUEST)

      val result = changePassword(session, OldPassword)
      status(result) mustBe TOO_MANY_REQUESTS
      header("Retry-After", result) mustBe defined
      (errors(result) \ "_summary").asOpt[String] mustBe defined
      signInStatus(email, OldPassword) mustBe OK
    }
  }
}
