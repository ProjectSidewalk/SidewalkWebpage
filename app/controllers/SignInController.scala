package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Authenticator.Implicits._
import play.silhouette.api.{LoginEvent, Silhouette}
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.util.Clock
import play.silhouette.impl.exceptions.IdentityNotFoundException
import controllers.helper.ControllerUtils.parseURL
import forms.SignInForm
import models.auth.DefaultEnv
import service.user.UserService
import net.ceedubs.ficus.Ficus._
import play.api.Configuration
import play.api.i18n.Messages
import controllers.base._
import service.utils.ConfigService

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.language.postfixOps

/**
 * The sign in controller.
 */
@Singleton
class SignInController @Inject()(
                                  cc: CustomControllerComponents,
                                  config: Configuration,
                                  val silhouette: Silhouette[DefaultEnv],
                                  userService: UserService,
                                  configService: ConfigService,
                                  clock: Clock
                                )(implicit ec: ExecutionContext, assets: AssetsFinder)
  extends CustomBaseController(cc) {
  implicit val implicitConfig = config // TODO do I need?

  /**
   * Authenticates a user.
   */
  def authenticate() = silhouette.UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val currUserId: Option[String] = request.identity.map(_.userId)

    SignInForm.form.bindFromRequest.fold(
      formWithErrors => {
        configService.getCommonPageData(request2Messages.lang).map(commonData => {
          BadRequest(views.html.signIn(formWithErrors, commonData, request.identity))
        })
      },
      data => {
        // Logs sign-in attempt.
        val email: String = data.email.toLowerCase
        val activity: String = s"""SignInAttempt_Email="$email""""
        cc.loggingService.insert(currUserId, ipAddress, activity)

        // Grab the URL we want to redirect to that was passed as a hidden field in the form.
        val returnUrl = request.body.asFormUrlEncoded
          .flatMap(_.get("returnUrl"))
          .flatMap(_.headOption)
          .getOrElse("/") // Default redirect path if no returnUrl.
        val (returnUrlPath, returnUrlQuery) = parseURL(returnUrl)
        val result = Redirect(returnUrl)

        // Try to authenticate the user.
        userService.authenticate(email, data.password).flatMap { loginInfo =>
          userService.retrieve(loginInfo).flatMap {
            case Some(user) =>
              val c = config.underlying
               silhouette.env.authenticatorService.create(loginInfo).map {
                case authenticator if data.rememberMe =>
                  // Set up the remember me cookie.
                  authenticator.copy(
                    expirationDateTime = clock.now + c.as[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorExpiry"),
                    idleTimeout = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorIdleTimeout"),
                    cookieMaxAge = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.cookieMaxAge")
                  )
                case authenticator => authenticator
              }.flatMap { authenticator =>
                 // Log successful sign in attempt.
                 val activity: String = s"""SignInSuccess_Email="${user.email}""""
                 cc.loggingService.insert(user.userId, ipAddress, activity)

                 // Sign in the user.
                 silhouette.env.eventBus.publish(LoginEvent(user, request))
                 silhouette.env.authenticatorService.init(authenticator).flatMap { v =>
                   silhouette.env.authenticatorService.embed(v, result)
                }
              }
            case None =>
              // Log failed sign-in due to a database issue.
              val activity: String = s"""SignInFailed_Email="$email"_Reason="user not found in db""""
              cc.loggingService.insert(currUserId, ipAddress, activity)
              Future.failed(new IdentityNotFoundException("Couldn't find the user in db"))
          }
        }.recover {
          case e: ProviderException =>
            // Log failed sign-in due to invalid credentials. Should be the only reason for failed sign-in.
            val activity: String = s"""SignInFailed_Email="$email"_Reason="invalid credentials""""
            cc.loggingService.insert(currUserId, ipAddress, activity)

            Redirect("/signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
              .flashing("error" -> Messages("authenticate.error.invalid.credentials"))
          case e: Exception =>
            val activity: String = s"""SignInFailed_Email="$email"_Reason="unexpected""""
            cc.loggingService.insert(currUserId, ipAddress, activity)

            Redirect("/signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
              .flashing("error" -> "Unexpected error")
        }
      }
    )
  }
}