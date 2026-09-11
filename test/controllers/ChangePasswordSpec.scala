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
import service.AuthenticationService
import util.SignedUpAccounts

import scala.concurrent.Future

/**
 * End-to-end tests for Settings' change-password endpoint (#2285) and the reset flow it links to, against the real app
 * and database with throwaway accounts.
 *
 * Only the change-password limit is on, turned down to three so the lockout is quick to reach. The sign-up and sign-in
 * limits would otherwise trip, since every request here comes from 127.0.0.1.
 */
class ChangePasswordSpec extends PlaySpec with SignedUpAccounts with GuiceOneAppPerSuite {

  private val MaxAttempts = 3

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"                      -> false,
        "rate-limit.change-password.enabled"      -> true,
        "rate-limit.change-password.max-attempts" -> MaxAttempts
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR          = "X-Requested-With" -> "XMLHttpRequest"
  private val NewPassword  = "NewPass22"
  private val WrongCurrent = "NotMyPass3"

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

  /** @return Where finishing a password reset for `userId` sends a browser carrying `session`. */
  private def resetRedirect(userId: String, session: Seq[Cookie]): Option[String] = {
    val token = await(app.injector.instanceOf[AuthenticationService].createToken(userId))
    redirectLocation(
      route(
        app,
        FakeRequest(POST, s"/resetPassword?token=$token")
          .withCookies(session: _*)
          .withFormUrlEncodedBody("passwordReset" -> NewPassword, "passwordResetConfirm" -> NewPassword)
          .withCSRFToken
      ).get
    )
  }

  private def errors(result: Future[Result]): JsValue = (contentAsJson(result) \ "errors").get

  "POST /dashboard/settings/password" should {
    "refuse a wrong current password with a 401 on its own field, and leave the old password working" in {
      val (_, email, session) = signUpFreshUser()
      val result              = changePassword(session, WrongCurrent)
      status(result) mustBe UNAUTHORIZED
      (errors(result) \ "currentPassword").asOpt[String] mustBe defined
      signInStatus(email, signUpPassword) mustBe OK
    }

    "refuse a new password that doesn't match its confirmation, as a banner above the form" in {
      val (_, _, session) = signUpFreshUser()
      val result          = changePassword(session, signUpPassword, confirm = "Different9")
      status(result) mustBe BAD_REQUEST
      (errors(result) \ "_summary").asOpt[String] mustBe defined
    }

    "refuse a new password that breaks the password rules, on the new-password field" in {
      val (_, _, session) = signUpFreshUser()
      val result          = changePassword(session, signUpPassword, newPassword = "short", confirm = "short")
      status(result) mustBe BAD_REQUEST
      (errors(result) \ "newPassword").asOpt[String] mustBe defined
    }

    "change the password, so only the new one signs in" in {
      val (_, email, session) = signUpFreshUser()
      val result              = changePassword(session, signUpPassword)
      status(result) mustBe OK
      (contentAsJson(result) \ "success").as[Boolean] mustBe true
      signInStatus(email, signUpPassword) mustBe UNAUTHORIZED
      signInStatus(email, NewPassword) mustBe OK
    }

    "lock the form after too many wrong current passwords, even when the right one finally arrives" in {
      val (_, email, session) = signUpFreshUser()
      (1 to MaxAttempts).foreach(_ => status(changePassword(session, WrongCurrent)) mustBe UNAUTHORIZED)

      val result = changePassword(session, signUpPassword)
      status(result) mustBe TOO_MANY_REQUESTS
      header("Retry-After", result) mustBe defined
      (errors(result) \ "_summary").asOpt[String] mustBe defined
      signInStatus(email, signUpPassword) mustBe OK
    }

    "count successful changes toward the limit too, so a session can't change its password back and forth forever" in {
      val (_, _, session) = signUpFreshUser()
      status(changePassword(session, signUpPassword, "Another33", "Another33")) mustBe OK
      status(changePassword(session, "Another33", NewPassword, NewPassword)) mustBe OK
      status(changePassword(session, NewPassword, "Third444", "Third444")) mustBe OK
      status(changePassword(session, "Third444")) mustBe TOO_MANY_REQUESTS
    }
  }

  "The reset-by-email flow Settings links to" should {
    "open /forgotPassword to a signed-in user" in {
      val (_, _, session) = signUpFreshUser()
      status(route(app, FakeRequest(GET, "/forgotPassword").withCookies(session: _*)).get) mustBe OK
    }

    "send someone who finishes a reset while signed in back to Settings, where the message shows" in {
      val (userId, _, session) = signUpFreshUser()
      resetRedirect(userId, session) mustBe Some("/dashboard/settings#change-password")
    }

    "send someone who isn't signed in to sign in with the new password" in {
      val (userId, _, _) = signUpFreshUser()
      resetRedirect(userId, Seq.empty) mustBe Some("/signIn")
    }
  }
}
