package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms._
import models.User
import play.api.libs.json.Json
import play.api.mvc.{BodyParsers, Result, RequestHeader}

import scala.concurrent.Future


/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class UserController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
   * Handles the index action.
   *
   * @return The result to display.
   */
  def index = SecuredAction.async { implicit request =>
    Future.successful(Ok(views.html.home(request.identity)))
  }

  /**
   * Handles the Sign In action.
   *
   * @return The result to display.
   */
  def signIn = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Redirect("/"))
      case None => Future.successful(Ok(views.html.signIn(SignInForm.form)))
    }
  }

  /**
   * Handles the Sign Up action.
   *
   * @return The result to display.
   */
  def signUp = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Redirect("/"))
      case None => Future.successful(Ok(views.html.signUp(SignUpForm.form)))
    }
  }

  /**
   * Handles the Sign Out action.
   *
   * @return The result to display.
   */
  def signOut = SecuredAction.async { implicit request =>
//    val result = Future.successful(Redirect(routes.UserController.index()))
    val result = Future.successful(Redirect("/"))
    env.eventBus.publish(LogoutEvent(request.identity, request, request2lang))
    request.authenticator.discard(result)
  }
}
