package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import forms._
import models.user._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.services.AuthTokenService
import play.api.mvc.BodyParsers
import play.api.libs.json._
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

/**
 * Holds the HTTP requests associated with the loading pages for authentication.
 *
 * @param env The Silhouette environment.
 */
class UserController @Inject() (implicit val env: Environment[User, SessionAuthenticator], authTokenService: AuthTokenService)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
   * Handles the Sign In action.
   */
  def signIn(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signIn(SignInForm.form, url)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Get the mobile sign in page.
   */
  def signInMobile(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signInMobile(SignInForm.form, url)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Handles the Sign Up action.
   */
  def signUp(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signUp(SignUpForm.form)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Get the mobile sign up page.
   */
  def signUpMobile(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signUpMobile(SignUpForm.form)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Handles the Sign Out action.
   */
  def signOut(url: String) = SecuredAction.async { implicit request =>

    // TODO: Find a better fix for issue #1026
    // See discussion on using Thread.sleep() as a temporary fix here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1026
    Thread.sleep(100)
    val result = Future.successful(Redirect(url))
    env.eventBus.publish(LogoutEvent(request.identity, request, request2lang))
    request.authenticator.discard(result)
  }

  /**
   * Handles the 'forgot password' action
   */
  def forgotPassword(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.forgotPassword(ForgotPasswordForm.form)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Get the reset password page.
   */
  def resetPassword(token: UUID) = UserAwareAction.async { implicit request =>
    authTokenService.validate(token).map {
      case Some(_) => Ok(views.html.resetPassword(ResetPasswordForm.form, token))
      case None => Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link"))
    }
  }
  
  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp.
  def logWebpageActivity = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    val submission = request.body.validate[String]
    val anonymousUser: DBUser = UserTable.find("anonymous").get

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        request.identity match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, submission, timestamp))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, submission, timestamp))
        }
        Future.successful(Ok(Json.obj()))
      }
    )
  }
}
