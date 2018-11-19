package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.{ConfigurationException, ProviderException}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import com.mohiva.play.silhouette.impl.providers._
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms.SignInForm
import models.services.UserService
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.{Action, RequestHeader}
import play.api.Play

import scala.concurrent.Future
import scala.concurrent.duration._



/**
  * The credentials auth controller that is responsible for user log in.
  *
  * @param env The Silhouette environment.
  */
class CredentialsAuthController @Inject() (
                                            implicit val env: Environment[User, SessionAuthenticator],
                                            val userService: UserService)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
    * Authenticates a user against the credentials provider.
    *
    * @return The result to display.
    */
  def authenticate(url: String) = Action.async { implicit request =>
    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => (env.requestProviders.find(_.id == CredentialsProvider.ID) match {
        case Some(p: CredentialsProvider) => p.authenticate(credentials)
        case _ => Future.failed(new ConfigurationException("Cannot find credentials provider"))
      }).flatMap { loginInfo =>
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            signIn(user, authenticator).flatMap { session =>
              // Get the Future[Result] (i.e., the page to redirect), then embed the encoded session authenticator
              // into HTTP header as a cookie.
              val result = Redirect(url)
              env.authenticatorService.embed(session, result)
            }
          }
          case None => Future.failed(new IdentityNotFoundException("Couldn't find the user"))
        }
      }.recover {
        case e: ProviderException =>
          Redirect(routes.UserController.signIn(url)).flashing("error" -> Messages("invalid.credentials"))
      }
    )
  }

  /**
    * REST endpoint for sign in.
    * @return
    */
  def postAuthenticate = Action.async { implicit request =>
    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => (env.requestProviders.find(_.id == CredentialsProvider.ID) match {
        case Some(p: CredentialsProvider) => p.authenticate(credentials)
        case _ => Future.failed(new ConfigurationException("Cannot find credentials provider"))
      }).flatMap { loginInfo =>
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            signIn(user, authenticator).flatMap { session =>
              // Embed the encoded session authenticator into the JSON response's HTTP header as a cookie.
              val result = Ok(Json.toJson(user))
              env.authenticatorService.embed(session, result)
            }
          }
          case None => Future.failed(new IdentityNotFoundException("Couldn't find the user"))
        }
      }.recover {
        case e: ProviderException =>
          Redirect(routes.ApplicationController.index())
      }
    )
  }

  def signIn(user: User, authenticator: SessionAuthenticator)(implicit request: RequestHeader): Future[SessionAuthenticator#Value] = {
    val ipAddress: String = request.remoteAddress

    // If you want to extend the expiration time, follow this instruction.
    // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
    val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
    val expirationDate = authenticator.expirationDateTime.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)
    val updatedAuthenticator = authenticator.copy(expirationDateTime = expirationDate, idleTimeout = Some(2592000.millis))

    UserCurrentRegionTable.isAssigned(user.userId).flatMap {
      case true  => Future.successful(None)
      case false => UserCurrentRegionTable.assignRegion(user.userId)
    }.flatMap { _ =>
      // Add Timestamp
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))
    }.flatMap { _ =>
      // Logger.info(updatedAuthenticator.toString)
      // NOTE: I could move WebpageActivity monitoring stuff to somewhere else and listen to Events...
      // There is currently nothing subscribed to the event bus (at least in the application level)
      env.eventBus.publish(LoginEvent(user, request, request2Messages))
      env.authenticatorService.init(updatedAuthenticator)
    }
  }
}
