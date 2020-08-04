package forms

import com.mohiva.play.silhouette.api.util.Credentials
import play.api.data.Form
import play.api.data.Forms._

object SignInForm {
  val form = Form(
    mapping(
      "identifier" -> email,
      "passwordSignIn" -> nonEmptyText
    )(Credentials.apply)(Credentials.unapply)
  )
}
