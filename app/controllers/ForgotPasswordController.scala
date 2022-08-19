package controllers

import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import forms.ForgotPasswordForm
import models.services.{AuthTokenService, UserService}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import models.user._
import play.api.i18n.Messages
import controllers.headers.ProvidesHeader
import models.daos.slick.DBTableDefinitions.UserTable
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.libs.mailer._
import play.api.Play.current

/**
 * The `Forgot Password` controller.
 *
 * @param userService      The user service implementation.
 * @param authTokenService  The authentication token service implementation
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
   */
  def submit = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val userId: String = request.identity.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)

    ForgotPasswordForm.form.bindFromRequest.fold (
      form => Future.successful(BadRequest(views.html.forgotPassword(form))),
      email => {
        val loginInfo = LoginInfo(CredentialsProvider.ID, email.toLowerCase)
        val result = Redirect(routes.UserController.forgotPassword()).flashing("info" -> Messages("reset.pw.email.reset.pw.sent"))
        userService.retrieve(loginInfo).flatMap {
          case Some(user) =>
            authTokenService.create(user.userId).map { authTokenID =>
              val url = routes.UserController.resetPassword(authTokenID).absoluteURL()

              val resetEmail = Email(
                Messages("reset.pw.email.reset.title"),
                "Project Sidewalk <mlprojectsidewalk@gmail.com>",
                Seq(email),
                bodyHtml = Some(views.html.emails.resetPasswordEmail(user, url).body)
              )

              MailerPlugin.send(resetEmail)
              WebpageActivityTable.save(WebpageActivity(0, userId, ipAddress, "PasswordResetRequest=" + email, timestamp))
              result
            }

          case None =>
            Logger.warn("Tried to reset password, but email not found in database: " + email)
            WebpageActivityTable.save(WebpageActivity(0, userId, ipAddress, "PasswordResetRequestFailed=" + email, timestamp))
            Future.successful(result)
        }
      }
    )
  }
}
