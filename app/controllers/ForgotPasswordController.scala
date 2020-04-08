package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import forms.ForgotPasswordForm
import models.services.{ UserService, AuthTokenService }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import models.user._
import play.api.i18n.Messages
import controllers.headers.ProvidesHeader
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.libs.mailer._
import play.api.Play.current

/**
 * The `Forgot Password` controller.
 *
 * @param userService      The user service implementation.
 * @param authTokenSerive  The authentication token service implementation
 */
class ForgotPasswordController @Inject() (
                                           implicit val env: Environment[User, SessionAuthenticator],
                                           val userService: UserService,
                                           val authTokenService: AuthTokenService
                                         ) extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Sends an email with password reset instructions.
   *
   * It sends an email to the given address if it exists in the database. Otherwise we do not show the user
   * a notice for not existing email addresses to prevent the leak of existing email addresses.
   *
   * @return The result to display.
   */
  def submit = UserAwareAction.async { implicit request =>
    ForgotPasswordForm.form.bindFromRequest.fold (
      form => Future.successful(BadRequest(views.html.forgotPassword(form))),
      email => {
        val loginInfo = LoginInfo(CredentialsProvider.ID, email)
        val result = Redirect(routes.UserController.signIn()).flashing("info" -> Messages("email.reset.password.sent"))
        userService.retrieve(loginInfo).flatMap {
          case Some(user) =>
            authTokenService.create(user.userId).map { authToken =>
              val url = routes.UserController.resetPassword(authToken.id).absoluteURL()

              val resetEmail = Email(
                Messages("email.reset.title"),
                "Project Sidewalk <mlprojectsidewalk@gmail.com>",
                Seq(email),
                bodyHtml = Some(views.html.emails.resetPasswordEmail(user, url).body)
              )

              MailerPlugin.send(resetEmail)
              result
            }

          case None => Future.successful(result)
        }
      }
    )
  }
}