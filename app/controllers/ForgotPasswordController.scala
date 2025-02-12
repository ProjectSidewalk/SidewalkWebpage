package controllers

import java.sql.Timestamp
import java.time.Instant
import javax.inject.{Inject, Singleton}
import io.github.honeycombcheesecake.play.silhouette.api._
import models.auth.DefaultEnv
import controllers.base._
//import forms.ForgotPasswordForm
//import models.services.{AuthTokenService, UserService}

import models.user._

import play.api.{Logger, Play}

import scala.concurrent.Future
//import play.api.libs.mailer._

/**
 * The `Forgot Password` controller.
 *
 * @param userService      The user service implementation.
 * @param authTokenService  The authentication token service implementation
 */
@Singleton
class ForgotPasswordController @Inject() (
                                           cc: CustomControllerComponents,
                                           val silhouette: Silhouette[DefaultEnv]
//                                           val userService: UserService,
//                                           val authTokenService: AuthTokenService
                                         )(implicit assets: AssetsFinder) extends CustomBaseController(cc) {

  /**
   * Sends an email with password reset instructions.
   *
   * It sends an email to the given address if it exists in the database. Otherwise we do not show the user
   * a notice for not existing email addresses to prevent the leak of existing email addresses.
   */
//  def submit = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val ipAddress: String = request.remoteAddress
//    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//    val userId: String = request.identity.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId)
//
//    ForgotPasswordForm.form.bindFromRequest.fold (
//      form => Future.successful(BadRequest(views.html.forgotPassword(form))),
//      email => {
//        val loginInfo = LoginInfo(CredentialsProvider.ID, email.toLowerCase)
//        val result = Redirect(routes.UserController.forgotPassword()).flashing("info" -> Messages("reset.pw.email.reset.pw.sent"))
//
//        // Log the user's attempt to reset password here
//        cc.loggingService.insert(WebpageActivity(0, userId, ipAddress, s"""PasswordResetAttempt_Email="${email}"""", timestamp))
//
//        userService.retrieve(loginInfo).flatMap {
//          case Some(user) =>
//            authTokenService.create(user.userId).flatMap { authTokenID =>
//              val url = routes.UserController.resetPassword(authTokenID).absoluteURL()
//
//              val resetEmail = Email(
//                Messages("reset.pw.email.reset.title"),
//                s"Project Sidewalk <${config.get[String]("noreply-email-address")}>",
//                Seq(email),
//                bodyHtml = Some(views.html.emails.resetPasswordEmail(user, url).body)
//              )
//
//              try {
//                MailerPlugin.send(resetEmail)
//                cc.loggingService.insert(WebpageActivity(0, userId, ipAddress, s"""PasswordResetSuccess_Email="$email"""", timestamp))
//                Future.successful(result)
//              } catch {
//                case e: Exception => {
//                  cc.loggingService.insert(WebpageActivity(0, userId, ipAddress, s"""PasswordResetFail_Email="${email}"_Reason=${e.getClass.getCanonicalName}""", timestamp))
//                  Logger.error(e.getCause + "")
//                  Future.failed(e)
//                }
//              }
//            }
//
//          // This is the case where the email was not found in the database
//          case None =>
//            cc.loggingService.insert(WebpageActivity(0, userId, ipAddress, s"""PasswordResetFail_Email="${email}"_Reason=EmailNotFound""", timestamp))
//            Future.successful(result)
//        }
//      }
//    )
//  }
}
