package controllers

import controllers.base._
import controllers.helper.ControllerUtils.parseURL
import forms._
import models.auth.{DefaultEnv, WithAdminOrIsUser}
import models.user.SidewalkUserWithRole
import net.ceedubs.ficus.Ficus._
import play.api.i18n.Messages
import play.api.libs.json.{JsError, Json}
import play.api.libs.mailer.{Email, MailerClient}
import play.api.mvc._
import play.api.{Configuration, Logger}
import play.silhouette.api.Authenticator.Implicits._
import play.silhouette.api.actions.UserAwareRequest
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.util.{Clock, PasswordHasher}
import play.silhouette.api._
import play.silhouette.impl.exceptions.IdentityNotFoundException
import play.silhouette.impl.providers.CredentialsProvider

import java.util.UUID
import javax.inject._
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

@Singleton
class UserController @Inject()(cc: CustomControllerComponents,
                               config: Configuration,
                               val silhouette: Silhouette[DefaultEnv],
                               configService: service.ConfigService,
                               authenticationService: service.AuthenticationService,
                               passwordHasher: PasswordHasher,
                               clock: Clock,
                               mailerClient: MailerClient,
                              )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
  private val logger = Logger("application")

  /**
   * Handles the Sign In action.
   */
  def signIn() = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_SignIn")
        Ok(views.html.signIn(SignInForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Get the mobile sign in page.
   */
  def signInMobile = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_MobileSignIn")
        Ok(views.html.signInMobile(SignInForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Handles the sign-up action.
   */
  def signUp() = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_SignUp")
        Ok(views.html.signUp(SignUpForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Get the mobile sign-up page.
   */
  def signUpMobile = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_MobileSignUp")
        Ok(views.html.signUpMobile(SignUpForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Handles the sign-out action.
   */
  def signOut(url: String) =  cc.securityService.SecuredAction { implicit request =>
    // TODO: Find a better fix for issue #1026
    // TODO test out if this is still a problem after upgrading authentication libraries...
    // See discussion on using Thread.sleep() as a temporary fix here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1026
    Thread.sleep(100)
    val result = Redirect(url)
    silhouette.env.eventBus.publish(LogoutEvent(request.identity, request))
    silhouette.env.authenticatorService.discard(request.authenticator, result)
  }

  /**
   * Handles the 'forgot password' action
   */
  def forgotPassword(url: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_ForgotPassword")
        Ok(views.html.forgotPassword(ForgotPasswordForm.form, commonData))
      }
    } else Future.successful(Redirect(url))
  }

  /**
   * Get the reset password page.
   */
  def resetPasswordPage(token: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    authenticationService.validateToken(token).flatMap {
      case Some(_) =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_ResetPassword")
          Ok(views.html.resetPassword(ResetPasswordForm.form, commonData, token))
        }
      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
    }
  }

  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp.
  def logWebpageActivity = cc.securityService.SecuredAction(parse.json) { implicit request =>
    request.body.validate[String].fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        cc.loggingService.insert(request.identity.userId, request.remoteAddress, submission)
        Future.successful(Ok(Json.obj()))
      }
    )
  }

  // Post function that receives a JSON object with userId and isChecked, and updates the user's volunteer status.
  def updateVolunteerStatus(userId: String, communityService: Boolean) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) { request =>
    authenticationService.findByUserId(userId).flatMap {
      case Some(user) =>
        authenticationService.setCommunityServiceStatus(userId, communityService).map { rowsUpdated =>
          if (rowsUpdated > 0) Ok(Json.obj("message" -> "Volunteer status updated successfully"))
          else                 BadRequest(Json.obj("error" -> "Failed to update volunteer status"))
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

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
        authenticationService.authenticate(email, data.password).flatMap { loginInfo =>
          authenticationService.retrieve(loginInfo).flatMap {
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

  /**
   * Registers a new user.
   */
  def signUpPost(url: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
          userFromEmail: Option[SidewalkUserWithRole] <- authenticationService.findByEmail(email)
          userFromUsername: Option[SidewalkUserWithRole] <- authenticationService.findByUsername(data.username)
        } yield {
          // If username or email already exist, log it and send back an error.
          if (userFromEmail.isDefined) {
            cc.loggingService.insert(oldUserId, ipAddress, "Duplicate_Email_Error")
            // "user.exists" is overriding a default, otherwise we'd use a better name.
            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("user.exists")))
          } else if (userFromUsername.isDefined) {
            cc.loggingService.insert(oldUserId, ipAddress, "Duplicate_Username_Error")
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
              user <- authenticationService.insert(newUser, CredentialsProvider.ID, pwInfo)
              authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
              value <-  silhouette.env.authenticatorService.init(authenticator)
              result <-  silhouette.env.authenticatorService.embed(value, Redirect(nextUrl))
            } yield {
              // Log the sign up/in.
              cc.loggingService.insert(user.userId, ipAddress, "SignUp")
              cc.loggingService.insert(user.userId, ipAddress, "SignIn")

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
          newAnonUser: SidewalkUserWithRole <- authenticationService.generateUniqueAnonUser()
          loginInfo: LoginInfo = LoginInfo(CredentialsProvider.ID, newAnonUser.email)

          user <- authenticationService.insert(newAnonUser, CredentialsProvider.ID, pwInfo)
          authenticator <-  silhouette.env.authenticatorService.create(loginInfo)
          value <-  silhouette.env.authenticatorService.init(authenticator)
          result <-  silhouette.env.authenticatorService.embed(value, Redirect(url, qString))
        } yield {
          // Log the anon sign-up along with url and query string of the page they came from.
          val activityStr =
            if (qString.isEmpty) s"""AnonAutoSignUp_url="$url""""
            else s"""AnonAutoSignUp_url="$url?${qString.map { case (k, v) => k + "=" + v.mkString }.mkString("&")}""""
          cc.loggingService.insert(user.userId, request.remoteAddress, activityStr)

          silhouette.env.eventBus.publish(SignUpEvent(user, request))
          silhouette.env.eventBus.publish(LoginEvent(user, request))

          result
        }
    }
  }

  /**
   * Sends an email with password reset instructions.
   *
   * It sends an email to the given address if it exists in the database. Otherwise we do not show the user
   * a notice for not existing email addresses to prevent the leak of existing email addresses.
   */
  def submitForgottenPassword = silhouette.UserAwareAction.async { implicit request =>
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
              val url = routes.UserController.resetPasswordPage(authTokenID).absoluteURL()

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

  /**
   * Resets the password.
   *
   * @param token The token to identify a user.
   */
  def resetPassword(token: String) = silhouette.UserAwareAction.async { implicit request =>
    authenticationService.validateToken(token).flatMap {
      case Some(authToken) =>
        ResetPasswordForm.form.bindFromRequest.fold(
          form => configService.getCommonPageData(request2Messages.lang).map { commonData =>
            cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_ResetPassword")
            BadRequest(views.html.resetPassword(form, commonData, token))
          },
          passwordData => authenticationService.findByUserId(authToken.userID).flatMap {
            case Some(user) =>
              val passwordInfo = passwordHasher.hash(passwordData.password)
              authenticationService.updatePassword(user.userId, passwordInfo).map { _ =>
                authenticationService.removeToken(token)
                cc.loggingService.insert(user.userId, request.remoteAddress, "PasswordReset")
                Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.pw.successful"))
              }
            case _ => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
          }
        )
      case None => Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link")))
    }
  }
}
