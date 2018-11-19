package controllers

import java.sql.Timestamp
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.services.AvatarService
import com.mohiva.play.silhouette.api.util.{PasswordHasher, PasswordInfo}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.providers._
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms.SignUpForm
import models.services.UserService
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, RequestHeader}
import play.api.Play
import play.api.Play.current
import models.daos.slickdaos.DBTableDefinitions.UserTable

import scala.concurrent.Future
import scala.util.Random
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

/**
 * The sign up controller.
 *
 * @param env The Silhouette environment.
 * @param userService The user service implementation.
 * @param authInfoService The auth info service implementation.
 * @param avatarService The avatar service implementation.
 * @param passwordHasher The password hasher implementation.
 */
class SignUpController @Inject() (
                                   implicit val env: Environment[User, SessionAuthenticator],
                                   val userService: UserService,
                                   val authInfoService: AuthInfoRepository, //FIXME
                                   val avatarService: AvatarService,
                                   val passwordHasher: PasswordHasher)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {


  /**
   * Registers a new user.
   *
   * @return The result to display.
   */
  def signUp(url: String) = UserAwareAction.async { implicit request =>
    UserTable.find("anonymous").flatMap { anonymousUser =>
      val ipAddress: String = request.remoteAddress
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      val oldUserId: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.get.userId.toString)

      SignUpForm.form.bindFromRequest.fold (
        form => Future.successful(BadRequest(views.html.signUp(form))),

        data => {
          // Check presence of user by username
          UserTable.find(data.username).flatMap {
            case Some(user) =>
              WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Username_Error", timestamp))
              Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("Username already exists")))
            case None =>

              // Check presence of user by email
              UserTable.findEmail(data.email).flatMap {
                case Some(user) =>
                  WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Email_Error", timestamp))
                  Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("Email already exists")))
                case None =>
                  val authInfo = passwordHasher.hash(data.password)
                  val user = User(
                    userId = request.identity.map(_.userId).getOrElse(UUID.randomUUID()),
                    loginInfo = LoginInfo(CredentialsProvider.ID, data.email),
                    username = data.username,
                    email = data.email,
                    role = None
                  )

                  for {
                    user <- userService.save(user)
                    authInfo <- authInfoService.save(user.loginInfo, authInfo)
                    authenticator <- env.authenticatorService.create(user.loginInfo)
                    value <- env.authenticatorService.init(authenticator)
                    result <- env.authenticatorService.embed(value, Redirect(url))
                  } yield {
                    // Set the user role and assign the neighborhood to audit.
                    UserRoleTable.setRole(user.userId, "Registered")
                    UserCurrentRegionTable.assignEasyRegion(user.userId)

                    // Add Timestamp
                    val now = new DateTime(DateTimeZone.UTC)
                    val timestamp: Timestamp = new Timestamp(now.getMillis)
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

                    env.eventBus.publish(SignUpEvent(user, request, request2Messages))
                    env.eventBus.publish(LoginEvent(user, request, request2Messages))
                    result
                  }
              }
          }
        }
      )
    }
  }

  def postSignUp = UserAwareAction.async { implicit request =>
    UserTable.find("anonymous").flatMap { anonymousUser =>
      val ipAddress: String = request.remoteAddress
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      val oldUserId: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.get.userId.toString)

      SignUpForm.form.bindFromRequest.fold (
        form => Future.successful(BadRequest(views.html.signUp(form))),
        data => {
          // Check presence of user by username
          UserTable.find(data.username).flatMap {
            case Some(user) =>
              WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Username_Error", timestamp))
              Future.successful(Status(409)("Username already exists"))
            case None =>

              // Check presence of user by email
              UserTable.findEmail(data.email).flatMap {
                case Some(user) =>
                  WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Email_Error", timestamp))
                  Future.successful(Status(409)("Email already exists"))
                case None =>
                  val loginInfo = LoginInfo(CredentialsProvider.ID, data.email)
                  val authInfo = passwordHasher.hash(data.password)
                  val user = User(
                    userId = request.identity.map(_.userId).getOrElse(UUID.randomUUID()),
                    loginInfo = loginInfo,
                    username = data.username,
                    email = data.email,
                    role = None
                  )

                  for {
                    user <- userService.save(user)
                    authInfo <- authInfoService.save(loginInfo, authInfo)
                    authenticator <- env.authenticatorService.create(user.loginInfo)
                    value <- env.authenticatorService.init(authenticator)
                    result <- env.authenticatorService.embed(value, Ok(Json.toJson(user)))
                  } yield {
                    // Set the user role and assign the neighborhood to audit.
                    UserRoleTable.setRole(user.userId, "Registered")
                    UserCurrentRegionTable.assignEasyRegion(user.userId)

                    // Add Timestamp
                    val now = new DateTime(DateTimeZone.UTC)
                    val timestamp: Timestamp = new Timestamp(now.getMillis)
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

                    env.eventBus.publish(SignUpEvent(user, request, request2Messages))
                    env.eventBus.publish(LoginEvent(user, request, request2Messages))

                    result
                  }
              }
          }
        }
      )
    }
  }

  /**
    * If there is no user signed in, an anon user with randomly generated username/password is created.
    *
    * @param url
    * @return
    */
  def signUpAnon(url: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Redirect(url))
      case None =>
        val ipAddress: String = request.remoteAddress

        // Generate random strings for anonymous username/email/password (keep trying if we make a duplicate).
        var randomUsername: String = Random.alphanumeric take 16 mkString ""
        var randomEmail: String = "anonymous@" + s"${Random.alphanumeric take 16 mkString ""}" + ".com"
        val randomPassword: String = Random.alphanumeric take 16 mkString ""

        (for {
          userFound <- UserTable.find(randomUsername)
          emailFound <- UserTable.findEmail(randomEmail)
        } yield {
          if (userFound.isDefined)
            randomUsername = Random.alphanumeric take 16 mkString ""
          if (emailFound.isDefined)
            randomEmail = s"anonymous@${Random.alphanumeric take 16 mkString ""}.com"

          val loginInfo = LoginInfo(CredentialsProvider.ID, randomEmail)
          val authInfo = passwordHasher.hash(randomPassword)
          val user = User(
            userId = UUID.randomUUID(),
            loginInfo = loginInfo,
            username = randomUsername,
            email = randomEmail,
            role = None
          )

          (user, loginInfo, authInfo)
        }).flatMap { case (user: User, loginInfo: LoginInfo, authInfo: PasswordInfo) =>

          (for {
            user <- userService.save(user)
            authInfo <- authInfoService.save(loginInfo, authInfo)
            authenticator <- env.authenticatorService.create(user.loginInfo)
            value <- env.authenticatorService.init(authenticator)
            _ <- UserRoleTable.setRole(user.userId, "Anonymous")  // Set the user role.
            _ <- WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "AnonAutoSignUp",
              new Timestamp(new DateTime(DateTimeZone.UTC).getMillis))) // Add Timestamp
          } yield value).flatMap { value =>
            val result = env.authenticatorService.embed(value, Redirect(url))

            env.eventBus.publish(SignUpEvent(user, request, request2Messages))
            env.eventBus.publish(LoginEvent(user, request, request2Messages))

            result
          }
        }
    }
  }

  def turkerSignUp (hitId: String, workerId: String, assignmentId: String) = Action.async { implicit request =>
    val ipAddress: String = request.remoteAddress
//    val anonymousUser: DBUser = UserTable.find("anonymous").get
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    var activityLogText: String = "Referrer=mturk"+ "_workerId=" + workerId + "_assignmentId=" + assignmentId + "_hitId=" + hitId

    UserTable.find(workerId).flatMap {
      case Some(user) =>
        // If the turker id already exists in the database then log the user in.
        activityLogText = activityLogText + "_reattempt=true"
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))

        val turker_email: String = workerId + "@sidewalk.mturker.umd.edu"
        val loginInfo = LoginInfo(CredentialsProvider.ID, turker_email)
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            val session: Future[SessionAuthenticator#Value] = turkerSignIn(user, authenticator)

            // Get the Future[Result] (i.e., the page to redirect), then embed the encoded session authenticator
            // into HTTP header as a cookie.
            val result = Redirect("/audit")
            session.flatMap(s => env.authenticatorService.embed(s, result))
          }
          case None => Future.successful(Redirect("/turkerIdExists"))
        }

      case None =>
        // Create a dummy email and password. Keep the username as the workerId.
        val turker_email: String = workerId + "@sidewalk.mturker.umd.edu"
        val turker_password: String = hitId + assignmentId + s"${Random.alphanumeric take 16 mkString("")}"

        val loginInfo = LoginInfo(CredentialsProvider.ID, turker_email)
        val authInfo = passwordHasher.hash(turker_password)
        val user = User(
          userId = UUID.randomUUID(),
          loginInfo = loginInfo,
          username = workerId,
          email = turker_email,
          role = None
        )

        for {
          user <- userService.save(user)
          authInfo <- authInfoService.save(loginInfo, authInfo)
          authenticator <- env.authenticatorService.create(user.loginInfo)
          value <- env.authenticatorService.init(authenticator)
          result <- env.authenticatorService.embed(value, Redirect("/audit"))
        } yield {
          // Set the user role and assign the neighborhood to audit.
          UserRoleTable.setRole(user.userId, "Turker")
          UserCurrentRegionTable.assignEasyRegion(user.userId)

          // Add Timestamp
          val now = new DateTime(DateTimeZone.UTC)
          val timestamp: Timestamp = new Timestamp(now.getMillis)
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

          env.eventBus.publish(SignUpEvent(user, request, request2Messages))
          env.eventBus.publish(LoginEvent(user, request, request2Messages))

          result
        }
    }
  }

  def turkerSignIn(user: User, authenticator: SessionAuthenticator)(implicit request: RequestHeader): Future[SessionAuthenticator#Value] = {
    val ipAddress: String = request.remoteAddress

    // If you want to extend the expiration time for the authenticated session, follow this instruction.
    // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
    val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
    val expirationDate = authenticator.expirationDateTime.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)
    val updatedAuthenticator = authenticator.copy(expirationDateTime=expirationDate, idleTimeout = Some(2592000.millis))

    UserCurrentRegionTable.isAssigned(user.userId).flatMap {
      case true   => Future.successful(None)
      case false  => UserCurrentRegionTable.assignEasyRegion(user.userId)
    }.flatMap { _ =>
      // Log the sign in.
      val now = new DateTime(DateTimeZone.UTC)
      val timestamp: Timestamp = new Timestamp(now.getMillis)
      WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

      // Logger.info(updatedAuthenticator.toString)
      // NOTE: I could move WebpageActivity monitoring stuff to somewhere else and listen to Events...
      // There is currently nothing subscribed to the event bus (at least in the application level)
      env.eventBus.publish(LoginEvent(user, request, request2Messages))
      env.authenticatorService.init(updatedAuthenticator)
    }
  }
}
