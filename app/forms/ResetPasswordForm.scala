package forms

import play.api.data.Forms.*
import play.api.data.*

/**
 * The `Reset Password` form.
 */
object ResetPasswordForm {

  /**
   * A play framework form.
   */
  val form = Form(
    mapping(
      "passwordReset"        -> PasswordPolicy.newPassword,
      "passwordResetConfirm" -> nonEmptyText
    )(PasswordData.apply)((d: PasswordData) => Some(Tuple.fromProductTyped(d))).verifying(
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
