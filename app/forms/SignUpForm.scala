package forms

import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._

object SignUpForm {
  val form = Form(
    mapping(
      "username" -> nonEmptyText
        .verifying(minLength(3))
        .verifying(maxLength(30))
        .verifying(pattern("""[a-zA-Z0-9]+""".r, error = "Username can only contain letters and numbers")),
      "email" -> email.verifying(nonEmpty),
      "password" -> nonEmptyText
        .verifying(minLength(8))
        .verifying(pattern(
          """^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*$""".r,
          error = "Password must contain at least one uppercase letter, one lowercase letter, and one number"
        )),
      "passwordConfirm" -> nonEmptyText,
      "serviceHours" -> nonEmptyText
        .verifying("Please select Yes or No", value => value == "YES" || value == "NO"),
      "terms" -> boolean.verifying("You must agree to the terms and conditions", value => value)
    )(SignUpData.apply)(SignUpData.unapply).verifying(
      "authenticate.error.password.mismatch", fields => fields.password == fields.passwordConfirm
    )
  )

  /**
   * The form data.
   * TODO are the password constraints consistent with what we had before? Did we remove redundant checks on back end?
   *
   * @param username The last name of a user.
   * @param email The email of the user.
   * @param password The password of the user.
   */
  case class SignUpData(username: String, email: String, password: String, passwordConfirm: String, serviceHours: String, terms: Boolean)
}
