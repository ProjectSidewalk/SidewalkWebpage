package controllers

import models.auth.DefaultEnv
import controllers.base._
import forms.ResetPasswordForm
import play.api.Configuration
import play.api.i18n.Messages
import play.api.mvc.AnyContent
import javax.inject.{Inject, Singleton}
import play.silhouette.api._
import play.silhouette.api.actions.UserAwareRequest
import play.silhouette.api.util.PasswordHasher
import scala.concurrent.ExecutionContext
import scala.concurrent.Future

@Singleton
class ResetPasswordController @Inject()(cc: CustomControllerComponents,
                                        val silhouette: Silhouette[DefaultEnv],
                                        val config: Configuration,
                                        configService: service.ConfigService,
                                        passwordHasher: PasswordHasher,
                                        authenticationService: service.AuthenticationService
                                       )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config

  /**
   * Resets the password.
   *
   * @param token The token to identify a user.
   */
  def reset(token: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    authenticationService.validateToken(token).flatMap {
      case Some(authToken) =>
        ResetPasswordForm.form.bindFromRequest.fold(
          form => configService.getCommonPageData(request2Messages.lang).map { commonData =>
            cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_ResetPassword")
            BadRequest(views.html.resetPassword(form, commonData, token))
          },
          passwordData => authenticationService.findByUserId(authToken.userID).flatMap {
            case Some(user) =>
              val passwordInfo = passwordHasher.hash(passwordData.password)
              authenticationService.updatePassword(user.userId, passwordInfo).map { _ =>
                authenticationService.removeToken(token)
                cc.loggingService.insert(user.userId, request.remoteAddress, "PasswordReset")
                Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.pw.successful"))
              }
            case _ => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
          }
        )
      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
    }
  }
}
