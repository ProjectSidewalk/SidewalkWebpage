package forms

import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._

/**
 * The form which handles the submission of the credentials.
 */
object SignInForm {

  /**
   * A play framework form.
   */
  val form = Form(
    mapping(
      "email" -> email.verifying(nonEmpty),
      "password" -> nonEmptyText,
      "rememberMe" -> boolean
    )(SignInData.apply)(SignInData.unapply)
  )

  /**
   * The form data.
   * TODO is rememberMe set up correctly?
   *
   * @param email The email of the user.
   * @param password The password of the user.
   * @param rememberMe Indicates if the user should stay logged in on the next visit.
   */
  case class SignInData(email: String, password: String, rememberMe: Boolean)
}
