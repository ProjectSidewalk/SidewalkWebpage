package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.Authenticator.Implicits._
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.util.{Clock, PasswordHasher, PasswordInfo}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import forms.SignInForm
import models.auth.DefaultEnv
import models.user.SidewalkUserWithRole
import service.user.UserService
import net.ceedubs.ficus.Ficus._
import play.api.Configuration
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.{Action, Controller}
import service.utils.ConfigService

import scala.concurrent.Future
import scala.concurrent.duration._
import scala.language.postfixOps

/**
 * The credentials auth controller.
 * TODO should this be a singleton?
 *
 * @param messagesApi The Play messages API.
 * @param env The Silhouette environment.
 * @param userService The user service implementation.
 * @param authInfoRepository The auth info repository implementation.
 * @param credentialsProvider The credentials provider.
 * @param config The Play configuration.
 * @param clock The clock instance.
 */
class CredentialsAuthController @Inject() (
                                            val messagesApi: MessagesApi,
                                            config: Configuration,
                                            val silhouette: Silhouette[DefaultEnv],
                                            userService: UserService,
                                            configService: ConfigService,
//                                            authInfoRepository: AuthInfoRepository,
//                                            credentialsProvider: CredentialsProvider,
                                            passwordHasher: PasswordHasher,
                                            clock: Clock)
  extends Controller with I18nSupport {
  implicit val implicitConfig = config

  /**
   * Authenticates a user.
   */
  def authenticate(url: String) = Action.async { implicit request =>
    println("All Cookies: " + request.cookies.mkString(", "))
    println("Authenticator Cookie: " + request.cookies.get("authenticator"))
    SignInForm.form.bindFromRequest.fold(
      form =>
        for {
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          BadRequest(views.html.signIn(form, commonData))
        },
      data => {
        userService.authenticate(data.email, data.password).flatMap { loginInfo =>
          val result = Redirect(routes.ApplicationController.index())
          userService.retrieve(loginInfo).flatMap {
            case Some(user) =>
              val c = config.underlying
               silhouette.env.authenticatorService.create(loginInfo).map {
                case authenticator if data.rememberMe =>
                  println("3")
                  authenticator.copy(
                    expirationDateTime = clock.now + c.as[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorExpiry"),
                    idleTimeout = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorIdleTimeout"),
                    cookieMaxAge = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.cookieMaxAge")
                  )
                case authenticator => authenticator
              }.flatMap { authenticator =>
                 silhouette.env.eventBus.publish(LoginEvent(user, request))
                 silhouette.env.authenticatorService.init(authenticator).flatMap { v =>
                   silhouette.env.authenticatorService.embed(v, result)
                }
              }
            case None => Future.failed(new IdentityNotFoundException("Couldn't find user"))
          }
        }.recover {
          case e: ProviderException =>
            // Log failed sign-in due to invalid credentials. Should be the only reason for failed sign-in.
//            val activity: String = s"""SignInFailed_Email="$email"_Reason="invalid credentials""""
//            webpageActivityService.insert(WebpageActivity(0, anonymousUser.userId, ipAddress, activity, timestamp))
            Redirect(routes.UserController.signIn(url)).flashing("error" -> Messages("authenticate.error.invalid.credentials"))
        }
      }
    )
  }
}