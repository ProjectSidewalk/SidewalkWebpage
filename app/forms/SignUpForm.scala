package forms

import play.api.data.Form
import play.api.data.Forms._

object SignUpForm {
  val form = Form(
    mapping(
      "username" -> nonEmptyText,
      "email" -> email,
      "password" -> nonEmptyText,
      "passwordConfirm" -> nonEmptyText
   )(Data.apply)(Data.unapply)
  )

  /**
   * The form data.
   *
   * @param username The last name of a user.
   * @param email The email of the user.
   * @param password The password of the user.
   */
  case class Data(
                 username: String,
                 email: String,
                 password: String,
		 passwordConfirm: String
                   )
}
