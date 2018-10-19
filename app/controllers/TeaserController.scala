package controllers

import javax.inject.Inject
import play.api.data._
import play.api.data.Forms._
import play.api.mvc.{Action, Controller}
import models.teaser._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

case class EmailAddress(email: String)


class TeaserController @Inject() extends Controller {

  val emailForm = Form(
    mapping(
      "email" -> email
    )(EmailAddress.apply)(EmailAddress.unapply)
  )

  def teaser = Action {
    Ok(views.html.teaser("Project Sidewalk", showEmailInput = true, hasError = false))
  }

  def teaserPost = Action { implicit request =>
    emailForm.bindFromRequest.fold(
      errors => Ok(views.html.teaser("Project Sidewalk", showEmailInput = true, hasError = true)),
      email => {
        // Save email address
        TeaserTable.save(email.email)
        Ok(views.html.teaser("Project Sidewalk", showEmailInput = false, hasError = false))
      }
    )
  }
}