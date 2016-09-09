package controllers

import java.sql.Timestamp
import java.util.{Calendar, Date, TimeZone}
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
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import play.api.{Logger, Play}

import scala.concurrent.Future

/**
  * The credentials auth controller that is responsible for user log in.
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
    val ipAddress: String = request.remoteAddress

    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => (env.providers.get(CredentialsProvider.ID) match {
        case Some(p: CredentialsProvider) => p.authenticate(credentials)
        case _ => Future.failed(new ConfigurationException(s"Cannot find credentials provider"))
      }).flatMap { loginInfo =>

        val result = Future.successful(Redirect(url))
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            // Logger.info(authenticator.toString)

            // If you want to extend the expiration time, follow this instruction.
            // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
            //            val updAuth = if (!request.rememberme) authenticator else authenticator.copy(expirationDate =
            val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
            val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
            val expirationDate = authenticator.expirationDate.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)

            val updatedAuthenticator = authenticator.copy(expirationDate=expirationDate, idleTimeout = Some(2592000))

            if (!UserCurrentRegionTable.isAssigned(user.userId)) {
              UserCurrentRegionTable.assignRandomly(user.userId)
            }

            // Add Timestamp
            val now = new DateTime(DateTimeZone.UTC)
            val timestamp: Timestamp = new Timestamp(now.getMillis)
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

            // Logger.info(updatedAuthenticator.toString)
            env.eventBus.publish(LoginEvent(user, request, request2lang))
            env.authenticatorService.init(updatedAuthenticator).flatMap(v => env.authenticatorService.embed(v, result))
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
