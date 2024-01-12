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
import play.api.mvc.{Action, RequestHeader}
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
    // Logs general signin attempt.
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val anonymousUser: DBUser = UserTable.find("anonymous").get

    SignInForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signIn(form))),
      credentials => {
        WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInAttempt_Email=\"" +
          credentials.identifier.toLowerCase + "\"", timestamp))
        (env.providers.get(CredentialsProvider.ID) match {
          case Some(p: CredentialsProvider) => p.authenticate(Credentials(credentials.identifier.toLowerCase,
            credentials.password))
          case _ => {
            // Logs failed signin attempt.
            val ipAddress: String = request.remoteAddress
            val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
            val anonymousUser: DBUser = UserTable.find("anonymous").get
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInFailed_Email=\"" +
              credentials.identifier.toLowerCase + "\"_Reason=invalid credentials", timestamp))

            Future.failed(new ConfigurationException("Cannot find credentials provider"))
          }

        }).flatMap { loginInfo =>
          userService.retrieve(loginInfo).flatMap {
            case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
              val session: Future[SessionAuthenticator#Value] = signIn(user, authenticator)

              // Get the Future[Result] (i.e., the page to redirect), then embed the encoded session authenticator
              // into HTTP header as a cookie.
              val result = Future.successful(Redirect(url))
              session.flatMap(s => env.authenticatorService.embed(s, result))
            }
            case None => {
              // Logs failed signin attempt.
              val ipAddress: String = request.remoteAddress
              val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
              val anonymousUser: DBUser = UserTable.find("anonymous").get
              WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInFailed_Email=\"" +
                credentials.identifier.toLowerCase + "\"_Reason=user not found", timestamp))

              Future.failed(new IdentityNotFoundException("Couldn't find the user"))
            }
          }
        }.recover {
          case e: ProviderException => {
            val ipAddress: String = request.remoteAddress
            val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
            val anonymousUser: DBUser = UserTable.find("anonymous").get
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInFailed_Email=\"" +
              credentials.identifier.toLowerCase + "\"_Reason=invalid credentials", timestamp))

            Redirect(routes.UserController.signIn(url)).flashing("error" -> Messages("authenticate.error.invalid.credentials"))
          }

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
      credentials => (env.providers.get(CredentialsProvider.ID) match {

        case Some(p: CredentialsProvider) => p.authenticate(Credentials(credentials.identifier.toLowerCase,
          credentials.password))
        case _ => {
          // Logs failed signin attempt.
          val ipAddress: String = request.remoteAddress
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          val anonymousUser: DBUser = UserTable.find("anonymous").get
          WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInFailed_Email=\"" +
            credentials.identifier.toLowerCase + "\"_Reason=invalid credentials", timestamp))

          Future.failed(new ConfigurationException("Cannot find credentials provider"))
        }

      }).flatMap { loginInfo =>
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            val session: Future[SessionAuthenticator#Value] = signIn(user, authenticator)

            // Embed the encoded session authenticator into the JSON response's HTTP header as a cookie.
            val result = Future.successful(Ok(Json.toJson(user)))
            session.flatMap(s => env.authenticatorService.embed(s, result))
          }
          case None => {
            // Logs failed signin attempt.
            val ipAddress: String = request.remoteAddress
            val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
            val anonymousUser: DBUser = UserTable.find("anonymous").get
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId, ipAddress, "SignInFailed_Email=\"" +
              credentials.identifier.toLowerCase + "\"_Reason=user not found", timestamp))

            Future.failed(new IdentityNotFoundException("Couldn't find the user"))
          }
        }
      }.recover {
        case e: ProviderException =>
          Redirect(routes.ApplicationController.index())
      }
    )
  }

  /**
    * Helper function to authenticate the given user.
    */
  def signIn(user: User, authenticator: SessionAuthenticator)(implicit request: RequestHeader): Future[SessionAuthenticator#Value] = {
    val ipAddress: String = request.remoteAddress

    // If you want to extend the expiration time, follow this instruction.
    // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
    val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
    val expirationDate = authenticator.expirationDate.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)
    val updatedAuthenticator = authenticator.copy(expirationDate=expirationDate, idleTimeout = Some(2592000))

    if (!UserCurrentRegionTable.isAssigned(user.userId)) {
      UserCurrentRegionTable.assignRegion(user.userId)
    }

    // Add Timestamp.
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Logs succesful signin attempts.
    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignInSuccess_Email=\"" +
      user.email + "\"", timestamp))

    // Logger.info(updatedAuthenticator.toString)
    // NOTE: I could move WebpageActivity monitoring stuff to somewhere else and listen to Events...
    // There is currently nothing subscribed to the event bus (at least in the application level)
    env.eventBus.publish(LoginEvent(user, request, request2lang))
    env.authenticatorService.init(updatedAuthenticator)
  }
}
