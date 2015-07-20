package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import formats.json.UserFormats._
import forms._
import models.User
import controllers.headers.ProvidesHeader
import play.api.libs.json.Json
import play.api.mvc.{BodyParsers, Result, RequestHeader}

import scala.concurrent.Future


/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class ApplicationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] {

  def index = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>Future.successful(Ok(views.html.indexSignedIn("Project Sidewalk", request.identity.get)))
      case None => Future.successful(Ok(views.html.index("Project Sidewalk", SignInForm.form, SignUpForm.form)))
    }
  }

  def test = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(Json.obj("user" -> user.username)))
      case None => Future.successful(Ok(Json.obj("message" -> "you are not logged! Login man!")))
    }
  }

}
