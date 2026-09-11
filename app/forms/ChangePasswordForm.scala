package forms

import play.api.data.Forms._
import play.api.data._

/**
 * The Settings page's change-password form (#2285). The new password follows the same `PasswordPolicy` as sign-up
 * and reset; whether the current password is right is checked afterward, against the database.
 */
object ChangePasswordForm {

  val form = Form(
    mapping(
      "currentPassword"    -> nonEmptyText,
      "newPassword"        -> PasswordPolicy.newPassword,
      "newPasswordConfirm" -> nonEmptyText
    )(Data.apply)(Data.unapply)
      .verifying("authenticate.error.password.mismatch", fields => fields.newPassword == fields.newPasswordConfirm)
      .verifying("dashboard.settings.password.error.same", fields => fields.newPassword != fields.currentPassword)
  )

  /** What the change-password form submits. */
  case class Data(currentPassword: String, newPassword: String, newPasswordConfirm: String)
}
