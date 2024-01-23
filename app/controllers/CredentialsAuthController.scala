package controllers

import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.{ConfigurationException, ProviderException}
import com.mohiva.play.silhouette.api.util.Credentials
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import com.mohiva.play.silhouette.impl.providers._
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms.SignInForm
import models.services.UserService
import models.user._
import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.{Action, RequestHeader, Result}
import play.api.Play
import scala.concurrent.Future
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}

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
    */
  def authenticate(url: String) = Action.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val anonymousUser: DBUser = UserTable.find("anonymous").get

    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => {
        // Logs sign in attempt.
        val email: String = credentials.identifier.toLowerCase
        val activity: String = s"""SignInAttempt_Email="$email""""
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, activity, timestamp))
        (env.providers.get(CredentialsProvider.ID) match {
          case Some(p: CredentialsProvider) => p.authenticate(Credentials(email, credentials.password))
          case _ =>
            // Log failed sign in.
            val activity: String = s"""SignInFailed_Email="$email"_Reason="invalid credentials""""
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, activity, timestamp))
            Future.failed(new ConfigurationException("Cannot find credentials provider"))
        }).flatMap { loginInfo =>
          userService.retrieve(loginInfo).flatMap {
            case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
              val session: Future[SessionAuthenticator#Value] = signIn(user, authenticator)

              // Get the Future[Result] (i.e., the page to redirect), then embed the encoded session authenticator
              // into HTTP header as a cookie.
              val result: Future[Result] = Future.successful(Redirect(url))
              session.flatMap(s => env.authenticatorService.embed(s, result))
            }
            case None =>
              // Log failed sign in.
              val activity: String = s"""SignInFailed_Email="$email"_Reason="user not found""""
              WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, activity, timestamp))
              Future.failed(new IdentityNotFoundException("Couldn't find the user"))
          }
        }.recover {
          case e: ProviderException =>
            // Log failed sign in.
            val activity: String = s"""SignInFailed_Email="$email"_Reason="invalid credentials""""
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, activity, timestamp))
            Redirect(routes.UserController.signIn(url)).flashing("error" -> Messages("authenticate.error.invalid.credentials"))
        }
      }
    )
  }

  /**
    * REST endpoint for sign in.
    */
  def postAuthenticate = Action.async { implicit request =>
    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => {
        val email: String = credentials.identifier.toLowerCase
        (env.providers.get(CredentialsProvider.ID) match {

        case Some(p: CredentialsProvider) => p.authenticate(Credentials(email, credentials.password))
        case _ => Future.failed(new ConfigurationException("Cannot find credentials provider"))
      }).flatMap { loginInfo =>
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            val session: Future[SessionAuthenticator#Value] = signIn(user, authenticator)

            // Embed the encoded session authenticator into the JSON response's HTTP header as a cookie.
            val result = Future.successful(Ok(Json.toJson(user)))
            session.flatMap(s => env.authenticatorService.embed(s, result))
          }
          case None => Future.failed(new IdentityNotFoundException("Couldn't find the user"))
        }
      }.recover {
        case e: ProviderException =>
          Redirect(routes.ApplicationController.index())
        }
      }
    )
  }

  /**
    * Helper function to authenticate the given user.
    */
  def signIn(user: User, authenticator: SessionAuthenticator)(implicit request: RequestHeader): Future[SessionAuthenticator#Value] = {

    // If you want to extend the expiration time, follow this instruction.
    // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
    val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
    val expirationDate = authenticator.expirationDate.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)
    val updatedAuthenticator = authenticator.copy(expirationDate=expirationDate, idleTimeout = Some(2592000))

    if (!UserCurrentRegionTable.isAssigned(user.userId)) {
      UserCurrentRegionTable.assignRegion(user.userId)
    }


    // Log successful sign in.
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val activity: String = s"""SignInSuccess_Email="${user.email}""""
    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activity, timestamp))

    // Logger.info(updatedAuthenticator.toString)
    // NOTE: I could move WebpageActivity monitoring stuff to somewhere else and listen to Events...
    // There is currently nothing subscribed to the event bus (at least in the application level)
    env.eventBus.publish(LoginEvent(user, request, request2lang))
    env.authenticatorService.init(updatedAuthenticator)
  }
}
