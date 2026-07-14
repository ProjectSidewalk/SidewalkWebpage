package forms

import play.api.data.Form
import play.api.data.Forms._

/**
 * The form which handles the submission of the credentials.
 */
object SignInForm {

  /**
   * A play framework form.
   */
  val form = Form(
    mapping(
      // The login identifier accepts an email OR a username (#4375); the controller resolves a username to its email,
      // so this is just a non-empty check rather than an email-format constraint.
      "email"      -> nonEmptyText,
      "password"   -> nonEmptyText,
      "rememberMe" -> boolean
    )(SignInData.apply)(SignInData.unapply)
  )

  /**
   * The form data.
   *
   * @param email      The login identifier: either the user's email or their username.
   * @param password   The password of the user.
   * @param rememberMe Indicates if the user should stay logged in on the next visit.
   */
  case class SignInData(email: String, password: String, rememberMe: Boolean)
}
