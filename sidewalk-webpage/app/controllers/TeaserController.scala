package controllers

import play.api.data._
import play.api.data.Forms._
import play.api.mvc.{Action, Controller}

import models.teaser._

case class EmailAddress(email: String)


object TeaserController extends Controller {

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