package controllers

import com.mohiva.play.silhouette.api.{LoginEvent, LoginInfo, SignUpEvent, Silhouette}

import java.util.UUID
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.actions.UserAwareRequest
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.providers._
import forms.SignUpForm
import models.auth.DefaultEnv
import models.user.SidewalkUserWithRole
import play.api.Configuration
import service.user.UserService
import play.api.i18n.{I18nSupport, Messages}
import play.api.mvc.{AbstractController, AnyContent, ControllerComponents}
import service.utils.{ConfigService, WebpageActivityService}
import services.CustomSecurityService

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

/**
 * The sign up controller.
 */
@Singleton
class SignUpController @Inject() (
                                   cc: ControllerComponents,
                                   config: Configuration,
                                   val silhouette: Silhouette[DefaultEnv],
                                   securityService: CustomSecurityService,
                                   userService: UserService,
                                   configService: ConfigService,
                                   passwordHasher: PasswordHasher,
                                   webpageActivityService: WebpageActivityService
                                 )(implicit ec: ExecutionContext) extends AbstractController(cc) with I18nSupport {
  implicit val implicitConfig = config

  /**
   * Registers a new user.
   */
  def signUp(url: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    val ipAddress: String = request.remoteAddress
    val oldUserId: Option[String] = request.identity.map(_.userId)

    SignUpForm.form.bindFromRequest.fold(
      formWithErrors => {
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          BadRequest(views.html.signUp(formWithErrors, commonData, request.identity))
        }
      },
      data => {
        val email: String = data.email.toLowerCase
        (for {
          userFromEmail: Option[SidewalkUserWithRole] <- userService.findByEmail(email)
          userFromUsername: Option[SidewalkUserWithRole] <- userService.findByUsername(data.username)
        } yield {
          // If username or email already exist, log it and send back an error.
          if (userFromEmail.isDefined) {
            webpageActivityService.insert(oldUserId, ipAddress, "Duplicate_Email_Error")
            // "user.exists" is overriding a default, otherwise we'd use a better name.
            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("user.exists")))
          } else if (userFromUsername.isDefined) {
            webpageActivityService.insert(oldUserId, ipAddress, "Duplicate_Username_Error")
            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("authenticate.error.username.exists")))
          } else {
            // If username and email are unique, create the new user.
            val loginInfo = LoginInfo(CredentialsProvider.ID, email)
            val newUserId: String = oldUserId.getOrElse(UUID.randomUUID().toString)
            val serviceHoursUser: Boolean = data.serviceHours == "YES"
            val newUser = SidewalkUserWithRole(newUserId, data.username, email, "Registered", serviceHoursUser)
            val pwInfo = passwordHasher.hash(data.password)
            val nextUrl: String = if (serviceHoursUser) "/serviceHoursInstructions" else url.getOrElse("/")

            for {
              user <- userService.insert(newUser, CredentialsProvider.ID, pwInfo)
              authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
              value <-  silhouette.env.authenticatorService.init(authenticator)
              result <-  silhouette.env.authenticatorService.embed(value, Redirect(nextUrl))
            } yield {
              // Log the sign up/in.
              webpageActivityService.insert(user.userId, ipAddress, "SignUp")
              webpageActivityService.insert(user.userId, ipAddress, "SignIn")

              silhouette.env.eventBus.publish(SignUpEvent(user, request))
              silhouette.env.eventBus.publish(LoginEvent(user, request))
              result
            }
          }
        }).flatMap(identity) // Flatten the Future[Future[T]] to Future[T].
      }
    )
  }

  /**
   * If there is no user signed in, an anon user with randomly generated username/password is created.
   */
  def signUpAnon(url: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    val qString = request.queryString.-("url") // Query string to pass along; remove the url parameter.
    request.identity match {
      case Some(user) =>
        Future.successful(Redirect(url, qString))
      case None =>
        val randomPassword: String = Random.alphanumeric take 16 mkString ""
        val pwInfo = passwordHasher.hash(randomPassword)

        for {
          newAnonUser: SidewalkUserWithRole <- userService.generateUniqueAnonUser()
          loginInfo: LoginInfo = LoginInfo(CredentialsProvider.ID, newAnonUser.email)

          user <- userService.insert(newAnonUser, CredentialsProvider.ID, pwInfo)
          authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
          value <-  silhouette.env.authenticatorService.init(authenticator)
          result <-  silhouette.env.authenticatorService.embed(value, Redirect(url, qString))
        } yield {
          // Log the anon sign-up along with url and query string of the page they came from.
          val activityStr =
            if (qString.isEmpty) s"""AnonAutoSignUp_url="$url""""
            else s"""AnonAutoSignUp_url="$url?${qString.map { case (k, v) => k + "=" + v.mkString }.mkString("&")}""""
          webpageActivityService.insert(user.userId, request.remoteAddress, activityStr)

         silhouette.env.eventBus.publish(SignUpEvent(user, request))
         silhouette.env.eventBus.publish(LoginEvent(user, request))

          result
        }
    }
  }
}