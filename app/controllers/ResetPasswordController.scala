package controllers

import models.auth.DefaultEnv
import controllers.base._

import javax.inject.{Inject, Singleton}

import play.silhouette.api._
import play.silhouette.api.util.PasswordHasher

//import forms.ResetPasswordForm
//import models.services.{AuthTokenService, AuthenticationService}
import models.user._

import scala.concurrent.Future


@Singleton
class ResetPasswordController @Inject() (
                                          cc: CustomControllerComponents,
                                          val silhouette: Silhouette[DefaultEnv],
//                                          val authenticationService: AuthenticationService,
//                                          val authInfoService: AuthInfoService,
                                          val passwordHasher: PasswordHasher
//                                          val authTokenService: AuthTokenService
                                        )(implicit assets: AssetsFinder) extends CustomBaseController(cc) {

  /**
   * Resets the password.
   *
   * @param token The token to identify a user.
   */
//  def reset(token: UUID) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val ipAddress: String = request.remoteAddress
//    val timestamp: OffsetDateTime = OffsetDateTime.now
//
//    authTokenService.validate(token).flatMap {
//      case Some(authToken) =>
//        ResetPasswordForm.form.bindFromRequest.fold(
//          form => Future.successful(BadRequest(views.html.resetPassword(form, token))),
//          passwordData => authenticationService.retrieve(authToken.userID).flatMap {
//            case Some(user) if user.loginInfo.providerID == CredentialsProvider.ID =>
//              if (passwordData.password != passwordData.passwordConfirm) {
//                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("authenticate.error.password.mismatch")))
//              } else if (passwordData.password.length < 6) {
//                Future.successful(Redirect(routes.UserController.resetPassword(token)).flashing("error" -> Messages("authenticate.error.password.length")))
//              } else {
//                val passwordInfo = passwordHasher.hash(passwordData.password)
//                authInfoService.save(user.loginInfo, passwordInfo).map { _ =>
//                  authTokenService.remove(token)
//                  cc.loggingService.insert(WebpageActivity(0, user.userId.toString, ipAddress, "PasswordReset", timestamp))
//                  Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.pw.successful"))
//                }
//              }
//            case _ => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
//          }
//        )
//      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
//    }
//  }
}
