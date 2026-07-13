package forms

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for the auth form bindings (#4375).
 *
 * Exercises the full validation contract of `SignUpForm`, `SignInForm`, and `ResetPasswordForm` by binding maps of
 * raw input and asserting which error keys come back. This is where the field-level rules (username charset/length,
 * password requirements, confirm-match, terms) are pinned; the controller/service specs assume these hold.
 */
class AuthFormsSpec extends AnyFunSuite with Matchers {

  private def signUp(
      username: String = "MapperOne",
      email: String = "mapper@example.com",
      password: String = "TestPass1",
      passwordConfirm: String = "TestPass1",
      terms: String = "true"
  ): Map[String, String] = Map(
    "username"        -> username,
    "email"           -> email,
    "password"        -> password,
    "passwordConfirm" -> passwordConfirm,
    "terms"           -> terms
  )

  private def errorKeys(data: Map[String, String]): Seq[String] =
    SignUpForm.form.bind(data).errors.map(e => if (e.key.isEmpty) "_global" else e.key)

  private def errorMessages(data: Map[String, String]): Seq[String] =
    SignUpForm.form.bind(data).errors.map(_.message)

  test("a well-formed sign-up binds with no errors") {
    SignUpForm.form.bind(signUp()).errors shouldBe empty
  }

  test("sign-up accepts hyphen/underscore usernames (shared rule with rename)") {
    SignUpForm.form.bind(signUp(username = "map-per_1")).errors shouldBe empty
  }

  test("sign-up rejects a too-short username") {
    errorKeys(signUp(username = "ab")) should contain("username")
  }

  test("sign-up rejects a too-long username") {
    errorKeys(signUp(username = "a" * 31)) should contain("username")
  }

  test("sign-up rejects disallowed username characters with the localized key") {
    errorMessages(signUp(username = "bad name!")) should contain("authenticate.error.username.charset")
  }

  test("sign-up rejects a password that is too short") {
    errorKeys(signUp(password = "Ab1", passwordConfirm = "Ab1")) should contain("password")
  }

  test("sign-up rejects a password missing a character class with the localized key") {
    errorMessages(signUp(password = "alllowercase1", passwordConfirm = "alllowercase1")) should
      contain("authenticate.error.password.requirements")
  }

  test("sign-up rejects mismatched passwords with a global error") {
    val errs = SignUpForm.form.bind(signUp(passwordConfirm = "DifferentPass1")).errors
    errs.map(_.message) should contain("authenticate.error.password.mismatch")
  }

  test("sign-up requires agreeing to the terms") {
    errorMessages(signUp(terms = "false")) should contain("authenticate.error.terms.required")
  }

  test("sign-up rejects an invalid email") {
    errorKeys(signUp(email = "not-an-email")) should contain("email")
  }

  test("sign-up has no serviceHours field (moved to Settings)") {
    // Binding succeeds even though no serviceHours key is supplied — the field is gone from the form.
    SignUpForm.form.bind(signUp()).value.isDefined shouldBe true
    SignUpForm.form.mapping.mappings.map(_.key) should not contain "serviceHours"
  }

  test("sign-in binds email + password + rememberMe and needs no password complexity") {
    val data  = Map("email" -> "a@b.com", "password" -> "whatever", "rememberMe" -> "true")
    val bound = SignInForm.form.bind(data)
    bound.errors shouldBe empty
    bound.value.map(_.rememberMe) shouldBe Some(true)
  }

  test("sign-in still requires a non-empty password and a valid email") {
    SignInForm.form
      .bind(Map("email" -> "a@b.com", "password" -> "", "rememberMe" -> "false"))
      .errors should not be empty
    SignInForm.form.bind(Map("email" -> "nope", "password" -> "x", "rememberMe" -> "false")).errors should not be empty
  }

  test("reset-password enforces the shared password policy and confirm-match") {
    val ok = ResetPasswordForm.form.bind(Map("passwordReset" -> "TestPass1", "passwordResetConfirm" -> "TestPass1"))
    ok.errors shouldBe empty

    val weak = ResetPasswordForm.form.bind(Map("passwordReset" -> "weak", "passwordResetConfirm" -> "weak"))
    weak.errors should not be empty

    val mismatch =
      ResetPasswordForm.form.bind(Map("passwordReset" -> "TestPass1", "passwordResetConfirm" -> "TestPass2"))
    mismatch.errors.map(_.message) should contain("authenticate.error.password.mismatch")
  }
}
