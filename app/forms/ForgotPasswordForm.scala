package forms

import play.api.data.Form
import play.api.data.Forms.*
import play.api.data.validation.Constraints.nonEmpty

/**
 * The `Forgot Password` form.
 */
object ForgotPasswordForm {
  val form = Form(
    "emailForgotPassword" -> email.verifying(nonEmpty)
  )
}
