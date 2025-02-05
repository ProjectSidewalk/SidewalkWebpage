package controllers

import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.Authenticator.Implicits._
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.util.{Clock, PasswordHasher, PasswordInfo}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import controllers.helper.ControllerUtils.parseURL
import forms.SignInForm
import models.auth.DefaultEnv
import service.user.UserService
import net.ceedubs.ficus.Ficus._
import play.api.Configuration
import play.api.i18n.{I18nSupport, Messages}
import play.api.mvc.{AbstractController, ControllerComponents}
import service.utils.{ConfigService, WebpageActivityService}

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.language.postfixOps

/**
 * The credentials auth controller.
 * TODO should this be a singleton?
 *
 * @param messagesApi The Play messages API.
 * @param env The Silhouette environment.
 * @param userService The user service implementation.
 * @param config The Play configuration.
 * @param clock The clock instance.
 */
@Singleton
class CredentialsAuthController @Inject()(
                                           cc: ControllerComponents,
                                           config: Configuration,
                                           val silhouette: Silhouette[DefaultEnv],
                                           userService: UserService,
                                           configService: ConfigService,
                                           webpageActivityService: WebpageActivityService,
//                                           authInfoRepository: AuthInfoRepository,
                                           credentialsProvider: CredentialsProvider,
//                                           passwordHasher: PasswordHasher,
//                                           credentialsProvider: CredentialsProvider,
                                           clock: Clock)(implicit ec: ExecutionContext)
  extends AbstractController(cc) with I18nSupport {
  implicit val implicitConfig = config // TODO do I need?

  /**
   * Authenticates a user.
   */
  def authenticate(url: String) = silhouette.UserAwareAction.async { implicit request =>
    println("All Cookies: " + request.cookies.mkString(", "))
    println("Authenticator Cookie: " + request.cookies.get("authenticator"))
    SignInForm.form.bindFromRequest.fold(
      form => {
        configService.getCommonPageData(request2Messages.lang).map(commonData => {
          BadRequest(views.html.signIn(form, commonData, request.identity))
        })
      },
      data => {
        // Grab the URL we want to redirect to that was passed as a hidden field in the form.
        val returnUrl = request.body.asFormUrlEncoded
          .flatMap(_.get("returnUrl"))
          .flatMap(_.headOption)
          .getOrElse("/") // Default redirect path if no returnUrl.
        val (returnUrlPath, returnUrlQuery) = parseURL(returnUrl)
        userService.authenticate(data.email, data.password).flatMap { loginInfo =>
          val result = Redirect(returnUrl)
          userService.retrieve(loginInfo).flatMap {
            case Some(user) =>
              val c = config.underlying
               silhouette.env.authenticatorService.create(loginInfo).map {
                case authenticator if data.rememberMe =>
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
//            webpageActivityService.insert(request.identity, request.remoteAddress, activity)
            Redirect("signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
              .flashing("error" -> Messages("authenticate.error.invalid.credentials"))
          case e: Exception =>
            Redirect("signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
              .flashing("error" -> Messages("authenticate.error.unexpected"))
        }
      }
    )
  }
}