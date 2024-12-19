package controllers

import java.util.UUID
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.providers._
import forms.SignUpForm
import models.user.SidewalkUserWithRole
import play.api.Configuration
import service.user.UserService
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import service.utils.{ConfigService, WebpageActivityService}

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.Future
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
                                   val messagesApi: MessagesApi,
                                   config: Configuration,
                                   val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                   userService: UserService,
                                   configService: ConfigService,
//                                   authInfoRepository: AuthInfoRepository,
                                   passwordHasher: PasswordHasher,
                                   webpageActivityService: WebpageActivityService
                                 )
  extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {
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
  def signUp(url: Option[String]) = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
//    val anonymousUser: SidewalkUserWithRole = UserTable.find("anonymous").get
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//    val oldUserId: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.userId.toString)

    SignUpForm.form.bindFromRequest.fold(
      form =>
        for {
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          BadRequest(views.html.signUp(form, commonData))
        },
      data => {
        val serviceHoursUser: Boolean = data.serviceHours == Messages("yes.caps")
        // TODO set up the redirect.
        val nextUrl: Option[String] = if (serviceHoursUser && url.isDefined) Some("/serviceHoursInstructions") else url
        val loginInfo = LoginInfo(CredentialsProvider.ID, data.email.toLowerCase)
        userService.retrieve(loginInfo).flatMap {
          case Some(user) =>
//            webpageActivityService.insert(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Username_Error", timestamp))
            Future.successful(Status(409)(Messages("authenticate.error.username.exists")))
//            Future.successful(Redirect(routes.ApplicationController.signUp()).flashing("error" -> Messages("user.exists")))
          case None =>
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
              user <- userService.save(newUser, CredentialsProvider.ID, pwInfo)
//              authInfo <- authInfoRepository.add(loginInfo, authInfo)
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              result <- env.authenticatorService.embed(value, Redirect(routes.ApplicationController.index()))
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
              env.eventBus.publish(SignUpEvent(user, request, request2Messages))
              env.eventBus.publish(LoginEvent(user, request, request2Messages))
              result
            }
        }
      }
    )
  }

  /**
   * If there is no user signed in, an anon user with randomly generated username/password is created.
   */
  def signUpAnon(url: String) = UserAwareAction.async { implicit request =>
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

          user <- userService.save(newAnonUser, CredentialsProvider.ID, pwInfo)
//          authInfo <- authInfoRepository.add(loginInfo, pwInfo)
          authenticator <- env.authenticatorService.create(loginInfo)
          value <- env.authenticatorService.init(authenticator)
          result <- env.authenticatorService.embed(value, Redirect(url, qString))
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

          env.eventBus.publish(SignUpEvent(user, request, request2Messages))
          env.eventBus.publish(LoginEvent(user, request, request2Messages))

          result
        }
    }
  }
}