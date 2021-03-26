package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import controllers.headers.ProvidesHeader
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.mohiva.play.silhouette.api.services.AuthInfoService
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import forms.ResetPasswordForm
import models.services.{ AuthTokenService, UserService }
import models.user._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import scala.concurrent.Future

/**
 * Holds the HTTP requests associated with resetting a user's password.
 *
 * @param env The Silhouette environment.
 */
class ResetPasswordController @Inject() (
                                          implicit val env: Environment[User, SessionAuthenticator],
                                          val userService: UserService,
                                          val authInfoService: AuthInfoService,
                                          val passwordHasher: PasswordHasher,
                                          val authTokenService: AuthTokenService
                                        ) extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Resets the password.
   *
   * @param token The token to identify a user.
   */
  def reset(token: UUID) = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    authTokenService.validate(token).flatMap {
      case Some(authToken) =>
        ResetPasswordForm.form.bindFromRequest.fold(
          form => Future.successful(BadRequest(views.html.resetPassword(form, token))),
          passwordData => userService.retrieve(authToken.userID).flatMap {
            case Some(user) if user.loginInfo.providerID == CredentialsProvider.ID =>
              if (passwordData.password != passwordData.passwordConfirm) {
                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("authenticate.error.password.mismatch")))
              } else if (passwordData.password.length < 6) {
                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("authenticate.error.password.length")))
              } else {
                val passwordInfo = passwordHasher.hash(passwordData.password)
                authInfoService.save(user.loginInfo, passwordInfo).map { _ =>
                  authTokenService.remove(token)
                  WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "PasswordReset", timestamp))
                  Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.pw.successful"))
                }
              }
            case _ => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
          }
        )
      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
    }
  }
}
