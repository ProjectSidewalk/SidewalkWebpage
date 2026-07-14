package forms

import play.api.data.Forms._
import play.api.data._
import play.api.data.validation.Constraints._

/**
 * The `Reset Password` form.
 */
object ResetPasswordForm {

  /**
   * A play framework form.
   */
  val form = Form(
    mapping(
      "passwordReset" -> nonEmptyText
        .verifying(minLength(PasswordPolicy.minLength))
        .verifying(pattern(PasswordPolicy.pattern, error = "authenticate.error.password.requirements")),
      "passwordResetConfirm" -> nonEmptyText
    )(PasswordData.apply)(PasswordData.unapply).verifying(
      "authenticate.error.password.mismatch",
      fields => fields.password == fields.passwordConfirm
    )
  )

  /**
   * The password data.
   * @param password The new password of the user.
   * @param passwordConfirm The confirmed new password of the user
   */
  case class PasswordData(password: String, passwordConfirm: String)
}
