package forms

import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._

/**
 * The sign-up form, shared by the auth dialog and the full-page/mobile sign-up views.
 *
 * Username and password rules come from `UsernamePolicy` / `PasswordPolicy` so the live frontend checklist and the
 * rename flow enforce the same contract. Error messages are i18n keys so the async JSON responses localize. The
 * volunteer service-hours opt-in is not part of sign-up; it lives in the dashboard Settings page (#4375).
 */
object SignUpForm {
  val form = Form(
    mapping(
      "username" -> nonEmptyText
        .verifying(minLength(UsernamePolicy.minLength))
        .verifying(maxLength(UsernamePolicy.maxLength))
        .verifying(pattern(UsernamePolicy.pattern, error = "authenticate.error.username.charset")),
      "email"    -> email.verifying(nonEmpty),
      "password" -> nonEmptyText
        .verifying(minLength(PasswordPolicy.minLength))
        .verifying(pattern(PasswordPolicy.pattern, error = "authenticate.error.password.requirements")),
      "passwordConfirm" -> nonEmptyText,
      "terms"           -> boolean.verifying("authenticate.error.terms.required", value => value)
    )(SignUpData.apply)(SignUpData.unapply).verifying(
      "authenticate.error.password.mismatch",
      fields => fields.password == fields.passwordConfirm
    )
  )

  /**
   * The form data.
   *
   * @param username        Display name shown on leaderboards; must satisfy `UsernamePolicy`.
   * @param email           The email of the user.
   * @param password        The password of the user; must satisfy `PasswordPolicy`.
   * @param passwordConfirm Must equal `password`.
   * @param terms           Whether the user accepted the terms of use; must be true.
   */
  case class SignUpData(
      username: String,
      email: String,
      password: String,
      passwordConfirm: String,
      terms: Boolean
  )
}
