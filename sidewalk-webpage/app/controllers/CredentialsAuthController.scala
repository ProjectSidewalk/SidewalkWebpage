package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.{ConfigurationException, ProviderException}
import com.mohiva.play.silhouette.api.services.AuthInfoService
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import com.mohiva.play.silhouette.impl.providers._
import controllers.headers.ProvidesHeader
import forms.SignInForm
import models.services.UserService
import models.user.{User, UserCurrentRegion, UserCurrentRegionTable}
import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import play.api.{Logger, Play}

import scala.concurrent.Future

/**
 * The credentials auth controller.
 *
 * @param env The Silhouette environment.
 */
class CredentialsAuthController @Inject() (
                                            implicit val env: Environment[User, SessionAuthenticator],
                                            val userService: UserService,
                                            val authInfoService: AuthInfoService)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
   * Authenticates a user against the credentials provider.
   *
   * @return The result to display.
   */
  def authenticate(url: String) = Action.async { implicit request =>
    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => (env.providers.get(CredentialsProvider.ID) match {
        case Some(p: CredentialsProvider) => p.authenticate(credentials)
        case _ => Future.failed(new ConfigurationException(s"Cannot find credentials provider"))
      }).flatMap { loginInfo =>
//        val result = Future.successful(Redirect(routes.UserController.index()))
        // Todo. [Issue #1]
        val result = Future.successful(Redirect(url))
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            // If you want to extend the expiration time, follow this instruction.
            // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
//            val updAuth = if (!request.rememberme) authenticator else authenticator.copy(expirationDate =
            val updAuth = authenticator.copy(expirationDate =
              authenticator.expirationDate.minusSeconds(Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get)
                .plusSeconds(Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get),
              idleTimeout = None
            )

            if (!UserCurrentRegionTable.isAssigned(user.userId)) { UserCurrentRegionTable.assign(user.userId) }

            Logger.debug(authenticator.expirationDate.toDate.toString)
            env.eventBus.publish(LoginEvent(user, request, request2lang))
            env.authenticatorService.init(authenticator).flatMap(v => env.authenticatorService.embed(v, result))
          }
          case None => Future.failed(new IdentityNotFoundException("Couldn't find user"))
        }
      }.recover {
        case e: ProviderException =>
          Redirect(routes.UserController.signIn(url)).flashing("error" -> Messages("invalid.credentials"))
      }
    )
  }
}
