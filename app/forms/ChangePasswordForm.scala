package forms

import play.api.data.Forms._
import play.api.data._

/** Settings' change-password form (#2285). Whether the current password is right is checked later, in the service. */
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
