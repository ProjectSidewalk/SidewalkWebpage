package forms

import play.api.data.Form
import play.api.data.Forms._

/**
 * The `Forgot Password` form.
 */
object ForgotPasswordForm {

  /**
   * A play framework form.
   */
  val form = Form(
    "emailForgotPassword" -> email
  )
}
