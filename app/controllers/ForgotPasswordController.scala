package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api._
import models.auth.DefaultEnv
import controllers.base._
import forms.ForgotPasswordForm
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.mailer._
import play.api.mvc.AnyContent
import play.silhouette.api.actions.UserAwareRequest
import scala.concurrent.{ExecutionContext, Future}
import play.api.Logger

/**
 * The `Forgot Password` controller.
 */
@Singleton
class ForgotPasswordController @Inject() (cc: CustomControllerComponents,
                                          val silhouette: Silhouette[DefaultEnv],
                                          config: Configuration,
                                          configService: service.ConfigService,
                                          mailerClient: MailerClient,
                                          authenticationService: service.AuthenticationService
                                         )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
  private val logger = Logger("application")

  /**
   * Sends an email with password reset instructions.
   *
   * It sends an email to the given address if it exists in the database. Otherwise we do not show the user
   * a notice for not existing email addresses to prevent the leak of existing email addresses.
   */
  def submit = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    val ipAddress: String = request.remoteAddress
    val userId: Option[String] = request.identity.map(_.userId)

    ForgotPasswordForm.form.bindFromRequest.fold (
      form =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          BadRequest(views.html.forgotPassword(form, commonData))
        },
      email => {
        val result = Redirect(routes.UserController.forgotPassword()).flashing("info" -> Messages("reset.pw.email.reset.pw.sent"))
        cc.loggingService.insert(userId, ipAddress, s"""PasswordResetAttempt_Email="$email"""")

        authenticationService.findByEmail(email).flatMap {
          case Some(user) =>
            // User exists, create a new token and send an email with the reset link.
            authenticationService.createToken(user.userId).flatMap { authTokenID =>
              val url = routes.UserController.resetPassword(authTokenID).absoluteURL()

              val resetEmail = Email(
                Messages("reset.pw.email.reset.title"),
                s"Project Sidewalk <${config.get[String]("noreply-email-address")}>",
                Seq(email),
                bodyHtml = Some(views.html.emails.resetPasswordEmail(user, url).body)
              )
              println(resetEmail) // TODO remove after testing.

              try {
                mailerClient.send(resetEmail)
                cc.loggingService.insert(userId, ipAddress, s"""PasswordResetSuccess_Email="$email"""")
                Future.successful(result)
              } catch {
                case e: Exception =>
                  cc.loggingService.insert(userId, ipAddress, s"""PasswordResetFail_Email="$email"_Reason=${e.getClass.getCanonicalName}""")
                  logger.error(e.getCause + "")
                  Future.failed(e)
              }
            }

          // This is the case where the email was not found in the database.
          case None =>
            cc.loggingService.insert(userId, ipAddress, s"""PasswordResetFail_Email="$email"_Reason=EmailNotFound""")
            Future.successful(result)
        }
      }
    )
  }
}
