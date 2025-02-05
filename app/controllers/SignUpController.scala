package controllers

import java.util.UUID
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.actions.UserAwareRequest
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.providers._
import forms.SignUpForm
import models.auth.DefaultEnv
import models.user.SidewalkUserWithRole
import play.api.Configuration
import service.user.UserService
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.mvc.{AbstractController, AnyContent, Controller, ControllerComponents}
import service.utils.{ConfigService, WebpageActivityService}

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

/**
 * The sign up controller.
 *
 * @param messagesApi The Play messages API.
 * @param env The Silhouette environment.
 * @param userService The user service implementation.
 * @param authInfoRepository The auth info repository implementation.
 * @param avatarService The avatar service implementation.
 * @param passwordHasher The password hasher implementation.
 */
@Singleton
class SignUpController @Inject() (
                                   cc: ControllerComponents,
                                   config: Configuration,
                                   val silhouette: Silhouette[DefaultEnv],
                                   userService: UserService,
                                   configService: ConfigService,
//                                   authInfoRepository: AuthInfoRepository,
                                   passwordHasher: PasswordHasher,
                                   webpageActivityService: WebpageActivityService
                                 )(implicit ec: ExecutionContext) extends AbstractController(cc) with I18nSupport {
  implicit val implicitConfig = config

  /**
   * Helper function to check if username contain invalid characters.
   * // TODO this should happen in the sign-up form validation.
   */
  private def containsInvalidCharacters(username: String): Boolean = {
    username.exists(c => c == '"' || c == '\'' || c == '<' || c == '>' || c == '&')
  }

  /**
   * Registers a new user.
   *
   * @return The result to display.
   */
  def signUp(url: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    val ipAddress: String = request.remoteAddress
//    val anonymousUser: SidewalkUserWithRole = UserTable.find("anonymous").get
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//    val oldUserId: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.userId.toString)

    SignUpForm.form.bindFromRequest.fold(
      formWithErrors => {
        println("Form errors:")
        println("Submitted serviceHours value: " + formWithErrors.data.get("serviceHours"))
        formWithErrors.errors.foreach { error =>
          println(s"Field: ${error.key}, Messages: ${error.messages}, Args: ${error.args}")
        }
        for {
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          BadRequest(views.html.signUp(formWithErrors, commonData, request.identity))
        }
      },
      data => {
        println(data.serviceHours)
        val serviceHoursUser: Boolean = data.serviceHours == "YES"
        // TODO set up the redirect.
        val nextUrl: Option[String] = if (serviceHoursUser && url.isDefined) Some("/serviceHoursInstructions") else url
        val loginInfo = LoginInfo(CredentialsProvider.ID, data.email.toLowerCase)
        userService.retrieve(loginInfo).flatMap {
          case Some(user) =>
            println("User exists")
//            webpageActivityService.insert(oldUserId, ipAddress, "Duplicate_Username_Error")
//            Future.successful(Status(409)(Messages("authenticate.error.username.exists")))
            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("user.exists")))
          case None =>
            println("User does not exist yet, gtg")
            val newUserId: String = request.identity.map(_.userId).getOrElse(UUID.randomUUID().toString)
            val newUser = SidewalkUserWithRole(newUserId, data.username, data.email.toLowerCase, "Registered", serviceHoursUser)
            val pwInfo = passwordHasher.hash(data.password)
//            val user = User(
//              userId = request.identity.map(_.userId).getOrElse(UUID.randomUUID()),
//              loginInfo = loginInfo,
//              username = data.username,
//              email = data.email.toLowerCase,
//              role = None
//            )
            for {
              user <- userService.insert(newUser, CredentialsProvider.ID, pwInfo)
//              authInfo <- authInfoRepository.add(loginInfo, authInfo)
              authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
              value <-  silhouette.env.authenticatorService.init(authenticator)
              result <-  silhouette.env.authenticatorService.embed(value, Redirect(routes.ApplicationController.index()))
            } yield {

              // Set the user role, assign the neighborhood to audit, and add to the user_stat table.
//              UserRoleTable.setRole(user.userId, "Registered", Some(serviceHoursUser))
//              UserStatTable.addUserStatIfNew(user.userId)
//              UserCurrentRegionTable.assignRegion(user.userId)

              // Log the sign up/in.
              val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//              webpageActivityService.insert(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
//              webpageActivityService.insert(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))
//
               silhouette.env.eventBus.publish(SignUpEvent(user, request))
               silhouette.env.eventBus.publish(LoginEvent(user, request))
              result
            }
        }
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
//          user: User = User(UUID.fromString(newAnonUser.userId), loginInfo, newAnonUser.username, newAnonUser.email, None)

          user <- userService.insert(newAnonUser, CredentialsProvider.ID, pwInfo)
//          authInfo <- authInfoRepository.add(loginInfo, pwInfo)
          authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
          value <-  silhouette.env.authenticatorService.init(authenticator)
          result <-  silhouette.env.authenticatorService.embed(value, Redirect(url, qString))
        } yield {
          // Set the user role and add to the user_stat table.
//          UserRoleTable.setRole(user.userId, "Anonymous", Some(false))
//          UserStatTable.addUserStatIfNew(user.userId)
//          UserCurrentRegionTable.assignRegion(user.userId)

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