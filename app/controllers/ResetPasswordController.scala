package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.mohiva.play.silhouette.api.services.AuthInfoService
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import forms.ResetPasswordForm
import models.services.{ AuthTokenService, UserService }
import models.user._
import play.api.i18n.Messages
import controllers.headers.ProvidesHeader

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

/**
 * The `Reset Password` controller.
 *
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
   * @return The result to display.
   */
  def reset(token: UUID) = UserAwareAction.async { implicit request =>
    authTokenService.validate(token).flatMap {
      case Some(authToken) =>
        ResetPasswordForm.form.bindFromRequest.fold(
          form => Future.successful(BadRequest(views.html.resetPassword(form, token))),
          passwordData => userService.retrieve(authToken.userID).flatMap {
            case Some(user) if user.loginInfo.providerID == CredentialsProvider.ID =>
              if (passwordData.password != passwordData.passwordConfirm) {
                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("sign.up.password.mismatch.error")))
              } else if (passwordData.password.length < 6) {
                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("sign.up.password.length.error")))
              } else {
                val passwordInfo = passwordHasher.hash(passwordData.password)
                authInfoService.save(user.loginInfo, passwordInfo).map { _ =>
                  authTokenService.remove(token)
                  Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.password.successful"))
                }
              }
            case _ => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.password.invalid.reset.link")))
          }
        )
      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.password.invalid.reset.link")))
    }
  }
}
