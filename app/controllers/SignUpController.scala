package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.services.{AuthInfoService, AvatarService}
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.providers._
import play.api.libs.Crypto
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms.SignUpForm
import models.services.UserService
import models.user._
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.{Action, RequestHeader}
import play.api.{Play, Logger}
import play.api.Play.current
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.daos.UserDAO
import scala.concurrent.Future
import scala.util.Random

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
                                   val userDAO: UserDAO,
                                   val authInfoService: AuthInfoService,
                                   val avatarService: AvatarService,
                                   val passwordHasher: PasswordHasher)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {


  /**
   * Registers a new user.
   */
  def signUp(url: Option[String]) = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val anonymousUser: DBUser = UserTable.find("anonymous").get
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val oldUserId: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.userId.toString)

    SignUpForm.form.bindFromRequest.fold(
      form => Future.successful(BadRequest(views.html.signUp(form))),
      data => {
        println(data.serviceHours)
        // Check presence of user by username.
        UserTable.find(data.username) match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Username_Error", timestamp))
//            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("authenticate.error.username.exists")))
            Future.successful(Status(409)(Messages("authenticate.error.username.exists")))
          case None =>

            // Check presence of user by email.
            UserTable.findEmail(data.email.toLowerCase) match {
              case Some(user) =>
                WebpageActivityTable.save(WebpageActivity(0, oldUserId, ipAddress, "Duplicate_Email_Error", timestamp))
//                Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("authenticate.error.email.exists")))
                Future.successful(Status(409)(Messages("authenticate.error.email.exists")))
              case None =>
                // Check if passwords match and are at least 6 characters.
                if (data.password != data.passwordConfirm) {
                  Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("authenticate.error.password.mismatch")))
                } else if (data.password.length < 6) {
                  Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("authenticate.error.password.length")))
                } else {
                  val authInfo = passwordHasher.hash(data.password)
                  val user = User(
                    userId = request.identity.map(_.userId).getOrElse(UUID.randomUUID()),
                    loginInfo = LoginInfo(CredentialsProvider.ID, data.email.toLowerCase),
                    username = data.username,
                    email = data.email.toLowerCase,
                    role = None
                  )

                  val newAuthenticator: Future[SessionAuthenticator] = for {
                    user <- userService.save(user)
                    authInfo <- authInfoService.save(user.loginInfo, authInfo)
                    authenticator <- env.authenticatorService.create(user.loginInfo)
                  } yield {
                    // Set the user role, assign the neighborhood to audit, and add to the user_stat table.
                    val serviceHoursUser: Boolean = data.serviceHours == Messages("yes.caps")
                    UserRoleTable.setRole(user.userId, "Registered", Some(serviceHoursUser))
                    UserCurrentRegionTable.assignEasyRegion(user.userId)
                    UserStatTable.addUserStatIfNew(user.userId)

                    // Add Timestamp.
                    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
                    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

                    env.eventBus.publish(SignUpEvent(user, request, request2lang))
                    env.eventBus.publish(LoginEvent(user, request, request2lang))
                    authenticator
                  }
                  request.authenticator match {
                    case Some(oldAuthenticator) =>
                      // If someone was already authenticated (i.e., they were signed into an anon user account), Play
                      // doesn't let us sign one account out and the other back in in one response header. So we start
                      // by redirecting to the "/finishSignUp" endpoint, discarding the old authenticator info and
                      // sending the new authenticator info in a temp element in the session cookie. The "/finishSignUp"
                      // endpoint will then move authenticator we put in "temp-authenticator" over to "authenticator"
                      // where it belongs, finally completing the sign up.
                      val redirectURL: String = url match {
                        case Some(u) => "/finishSignUp?url=" + u
                        case None => "/finishSignUp"
                      }
                      val result = newAuthenticator.map { newAuth =>
                        // When we encrypt/serialize, we're doing the work of init, serialize, and embed. Found here:
                        // https://github.com/mohiva/play-silhouette/blob/2.0.x/silhouette/app/com/mohiva/play/silhouette/impl/authenticators/SessionAuthenticator.scala
                        val authSerialized: String = Crypto.encryptAES(Json.toJson(newAuth).toString())
                        Redirect(redirectURL).withSession("temp-authenticator" -> authSerialized)
                      }
                      oldAuthenticator.discard(result)

                    case None =>
                      // If no account was signed in before, we can skip the "/finishSignUp" endpoint step. Instead, we
                      // embed the authenticator into the session cookie in the normal way and either forward to the
                      // new URL or simply send the newly authenticated user object.
                      val result = url match {
                        case Some(u) => Future.successful(Redirect(u))
                        case None => Future.successful(Ok(Json.toJson(user)))
                      }
                      for {
                        newA <- newAuthenticator
                        value <- env.authenticatorService.init(newA)
                        resultWithAuth <- env.authenticatorService.embed(value, result)
                      } yield resultWithAuth
                  }
                }
            }
        }
      }
    )
  }

  /**
   * Finishes the sign up process started by /signUp.
   *
   * If someone tried to sign up but was already authenticated (i.e., they were signed into an anon user account), Play
   * doesn't let us sign one account out and the other back in in one response header; we need a redirect between them.
   * So /signUp handles the validation and database portions, it discards to old authenticator from the session cookie
   * and stores the new one in a temporary element, and then it redirects to /finishSignUp. Here, we remove the temp
   * authenticator and move it's data into the correct element in the cookie, finally completing the sign up.
   */
  def finishSignUp(url: Option[String]) = UserAwareAction.async { implicit request =>
    if (request.session.get("authenticator").isEmpty && request.session.get("temp-authenticator").isDefined) {
      // Read the new authenticator from the session cookie.
      val authenticatorJson: String = Crypto.decryptAES(request.session.get("temp-authenticator").get)
      val authenticator: SessionAuthenticator = Json.parse(authenticatorJson).validate[SessionAuthenticator].get

      // Either forward to the new URL or simply send the newly authenticated user object.
      val result = url match {
        case Some(u) => Future.successful(Redirect(u))
        case None => userDAO.find(authenticator.loginInfo).map(x => Ok(Json.toJson(x)))
      }
      // Move the data from "new-authenticator" into "authenticator" to finish the sign up. We are
      // encrypting/serializing the authenticator ourselves so that we can both add the new one and remove the
      // temporary "temp-authenticator" in a single call to withSession. We are basically doing the work of the init,
      // serialize, and embed functions found here:
      // https://github.com/mohiva/play-silhouette/blob/2.0.x/silhouette/app/com/mohiva/play/silhouette/impl/authenticators/SessionAuthenticator.scala
      val authSerialized: String = Crypto.encryptAES(Json.toJson(authenticator).toString())
      result.map(_.withSession(request.session - "temp-authenticator" + ("authenticator" -> authSerialized)))
    } else {
      // This shouldn't happen. But if it does, we log it and send them over to /anonSignUp to clean up the mess.
      val oldDef: Boolean = request.session.get("authenticator").isDefined
      val newDef: Boolean = request.session.get("temp-authenticator").isDefined
      Logger.debug(s"Hit /finishSignUp endpoint with wrong authenticators. Old defined: $oldDef, new defined: $newDef")
      Future.successful(Redirect("/anonSignUp?url=/"))
    }
  }

  /**
    * If there is no user signed in, an anon user with randomly generated username/password is created.
    */
  def signUpAnon(url: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Redirect(url))
      case None =>
        val ipAddress: String = request.remoteAddress

        // Generate random strings for anonymous username/email/password (keep trying if we make a duplicate).
        var randomUsername: String = Random.alphanumeric.filter(!_.isUpper) take 16 mkString ""
        while (UserTable.find(randomUsername).isDefined) randomUsername = Random.alphanumeric.filter(!_.isUpper) take 16 mkString ""
        var randomEmail: String = "anonymous@" + s"${Random.alphanumeric.filter(!_.isUpper) take 16 mkString ""}" + ".com"
        while (UserTable.findEmail(randomEmail).isDefined)
          randomEmail = "anonymous@" + s"${Random.alphanumeric.filter(!_.isUpper) take 16 mkString ""}" + ".com"
        val randomPassword: String = Random.alphanumeric take 16 mkString ""

        val loginInfo = LoginInfo(CredentialsProvider.ID, randomEmail)
        val authInfo = passwordHasher.hash(randomPassword)
        val user = User(
          userId = UUID.randomUUID(),
          loginInfo = loginInfo,
          username = randomUsername,
          email = randomEmail,
          role = None
        )

        for {
          user <- userService.save(user)
          authInfo <- authInfoService.save(loginInfo, authInfo)
          authenticator <- env.authenticatorService.create(user.loginInfo)
          value <- env.authenticatorService.init(authenticator)
          result <- env.authenticatorService.embed(value, Future.successful(
            Redirect(url)
          ))
        } yield {
          // Set the user role and add to the user_stat table.
          UserRoleTable.setRole(user.userId, "Anonymous", Some(false))
          UserStatTable.addUserStatIfNew(user.userId)

          // Add Timestamp
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "AnonAutoSignUp", timestamp))

          env.eventBus.publish(SignUpEvent(user, request, request2lang))
          env.eventBus.publish(LoginEvent(user, request, request2lang))

          result
        }
    }
  }

  /**
   * Creates a new account and assignment for the given turker.
   */
  def turkerSignUp (hitId: String, workerId: String, assignmentId: String) = Action.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    var activityLogText: String = "Referrer=mturk"+ "_workerId=" + workerId + "_assignmentId=" + assignmentId + "_hitId=" + hitId

    UserTable.find(workerId) match {
      case Some(user) =>
        // If the turker id already exists in the database then log the user in.
        activityLogText = activityLogText + "_reattempt=true"
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))

        val turkerEmail: String = workerId.toLowerCase + "@sidewalk.mturker.umd.edu"
        val loginInfo = LoginInfo(CredentialsProvider.ID, turkerEmail)
        userService.retrieve(loginInfo).flatMap {
          case Some(user) => env.authenticatorService.create(loginInfo).flatMap { authenticator =>
            val session: Future[SessionAuthenticator#Value] = turkerSignIn(user, authenticator)

            // Get the Future[Result] (i.e., the page to redirect), then embed the encoded session authenticator
            // into HTTP header as a cookie.
            val result = Future.successful(Redirect("/audit"))
            session.flatMap(s => env.authenticatorService.embed(s, result))
          }
          case None => Future.successful(Redirect("/turkerIdExists"))
        }

      case None =>
        // Create a dummy email and password. Keep the username as the workerId.
        val turkerEmail: String = workerId.toLowerCase + "@sidewalk.mturker.umd.edu"
        val turkerPassword: String = hitId + assignmentId + s"${Random.alphanumeric take 16 mkString("")}"

        val loginInfo = LoginInfo(CredentialsProvider.ID, turkerEmail)
        val authInfo = passwordHasher.hash(turkerPassword)
        val user = User(
          userId = UUID.randomUUID(),
          loginInfo = loginInfo,
          username = workerId,
          email = turkerEmail,
          role = None
        )

        for {
          user <- userService.save(user)
          authInfo <- authInfoService.save(loginInfo, authInfo)
          authenticator <- env.authenticatorService.create(user.loginInfo)
          value <- env.authenticatorService.init(authenticator)
          result <- env.authenticatorService.embed(value, Future.successful(
            Redirect("/audit")
          ))
        } yield {
          // Set the user role, assign the neighborhood to audit, and add to the user_stat table.
          UserRoleTable.setRole(user.userId, "Turker", Some(false))
          UserCurrentRegionTable.assignEasyRegion(user.userId)
          UserStatTable.addUserStatIfNew(user.userId)

          // Add Timestamp.
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, activityLogText, timestamp))
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignUp", timestamp))
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

          env.eventBus.publish(SignUpEvent(user, request, request2lang))
          env.eventBus.publish(LoginEvent(user, request, request2lang))

          result
        }
    }
  }

  /**
   * Authenticates a turker who is returning to Project Sidewalk.
   */
  def turkerSignIn(user: User, authenticator: SessionAuthenticator)(implicit request: RequestHeader): Future[SessionAuthenticator#Value] = {
    val ipAddress: String = request.remoteAddress

    // If you want to extend the expiration time for the authenticated session, follow this instruction.
    // https://groups.google.com/forum/#!searchin/play-silhouette/session/play-silhouette/t4_-EmTa9Y4/9LVt_y60abcJ
    val defaultExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    val rememberMeExpiry = Play.configuration.getInt("silhouette.rememberme.authenticatorExpiry").get
    val expirationDate = authenticator.expirationDate.minusSeconds(defaultExpiry).plusSeconds(rememberMeExpiry)
    val updatedAuthenticator = authenticator.copy(expirationDate=expirationDate, idleTimeout = Some(2592000))

    if (!UserCurrentRegionTable.isAssigned(user.userId)) {
      UserCurrentRegionTable.assignEasyRegion(user.userId)
    }

    // Log the sign in.
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SignIn", timestamp))

    // Logger.info(updatedAuthenticator.toString)
    // NOTE: I could move WebpageActivity monitoring stuff to somewhere else and listen to Events...
    // There is currently nothing subscribed to the event bus (at least in the application level)
    env.eventBus.publish(LoginEvent(user, request, request2lang))
    env.authenticatorService.init(updatedAuthenticator)
  }
}
