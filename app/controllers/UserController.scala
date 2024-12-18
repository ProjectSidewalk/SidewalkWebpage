package controllers

import javax.inject._
import play.api.mvc._
import play.api.i18n.MessagesApi

import scala.concurrent.{Await, Future}

import play.api.libs.concurrent.Execution.Implicits.defaultContext
import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import forms._
import models.user.SidewalkUserWithRole
import play.api.Configuration
import service.utils.ConfigService

@Singleton
class UserController @Inject()(
                                       val messagesApi: MessagesApi,
                                       val config: Configuration,
                                       val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                       configService: ConfigService
                                     ) extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {
  implicit val implicitConfig = config
  /**
   * Handles the Sign In action.
   *
   * @return The result to display.
   */
  def signIn(url: String) = UserAwareAction.async { implicit request =>
    println("sign in")
    println(request.identity)
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
//      logPageVisit(request.identity, request.remoteAddress, "Visit_SignIn")
      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        Ok(views.html.signIn(SignInForm.form, commonData, url))
      }
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Get the mobile sign in page.
   */
//  def signInMobile(url: String) = UserAwareAction.async { implicit request =>
//    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
//      logPageVisit(request.identity, request.remoteAddress, "Visit_MobileSignIn")
//      Future.successful(Ok(views.html.signInMobile(SignInForm.form, url)))
//    } else {
//      Future.successful(Redirect(url))
//    }
//  }

  /**
   * Handles the Sign Up action.
   *
   * @return The result to display.
   */
  def signUp(url: String) = UserAwareAction.async { implicit request =>
//    request.identity match {
//      case Some(user) => Future.successful(Redirect(routes.ApplicationController.index()))
//      case None => Future.successful(Ok(views.html.signUp(SignUpForm.form)))
//    }
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      Ok(views.html.signUp(SignUpForm.form, commonData))
    }
  }

  /**
   * Get the mobile sign up page.
   */
//  def signUpMobile(url: String) = UserAwareAction.async { implicit request =>
//    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
//      logPageVisit(request.identity, request.remoteAddress, "Visit_MobileSignUp")
//      Future.successful(Ok(views.html.signUpMobile(SignUpForm.form)))
//    } else {
//      Future.successful(Redirect(url))
//    }
//  }

  /**
   * Handles the Sign Out action.
   *
   * @return The result to display.
   */
//  def signOut(url: String) = SecuredAction.async { implicit request =>
//    val result = Redirect(routes.ApplicationController.index())
//    env.eventBus.publish(LogoutEvent(request.identity, request, request2Messages))
//
//    env.authenticatorService.discard(request.authenticator, result)
//  }
  def signOut(url: String) = SecuredAction.async { implicit request =>

    // TODO: Find a better fix for issue #1026
    // TODO test out if this is still a problem after upgrading authentication libraries...
    // See discussion on using Thread.sleep() as a temporary fix here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1026
    Thread.sleep(100)
    val result = Redirect(url)
    env.eventBus.publish(LogoutEvent(request.identity, request, request2Messages))
    env.authenticatorService.discard(request.authenticator, result)
  }

  /**
   * Handles the 'forgot password' action
   */
//  def forgotPassword(url: String) = UserAwareAction.async { implicit request =>
//    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
//      logPageVisit(request.identity, request.remoteAddress, "Visit_ForgotPassword")
//      Future.successful(Ok(views.html.forgotPassword(ForgotPasswordForm.form)))
//    } else {
//      Future.successful(Redirect(url))
//    }
//  }

  /**
   * Get the reset password page.
   */
//  def resetPassword(token: UUID) = UserAwareAction.async { implicit request =>
//    authTokenService.validate(token).map {
//      case Some(_) =>
//        logPageVisit(request.identity, request.remoteAddress, "Visit_ResetPassword")
//        Ok(views.html.resetPassword(ResetPasswordForm.form, token))
//      case None => Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link"))
//    }
//  }

//  def logPageVisit(user: Option[User], ipAddress: String, logStr: String): Unit = {
//    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//    val userId: String = user.map(_.userId.toString).getOrElse(UserTable.find("anonymous").get.userId.toString)
//    webpageActivityService.insert(WebpageActivity(0, userId, ipAddress, logStr, timestamp))
//  }

  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp.
//  def logWebpageActivity = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
//    val submission = request.body.validate[String]
//    val anonymousUser: DBUser = UserTable.find("anonymous").get
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
//      },
//      submission => {
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//        val ipAddress: String = request.remoteAddress
//        request.identity match {
//          case Some(user) =>
//            webpageActivityService.insert(WebpageActivity(0, user.userId.toString, ipAddress, submission, timestamp))
//          case None =>
//            webpageActivityService.insert(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, submission, timestamp))
//        }
//        Future.successful(Ok(Json.obj()))
//      }
//    )
//  }

  // Post function that receives a JSON object with userId and isChecked, and updates the user's volunteer status.
//  def updateVolunteerStatus() = Action(parse.json) { request =>
//    val userId = (request.body \ "userId").as[UUID]
//    val isChecked = (request.body \ "isChecked").as[Boolean]
//
//    // Update the user's community service status in the database.
//    val rowsUpdated: Int = UserRoleTable.setCommunityService(userId, isChecked)
//
//    if (rowsUpdated > 0) {
//      Ok(Json.obj("message" -> "Volunteer status updated successfully"))
//    } else {
//      BadRequest(Json.obj("error" -> "Failed to update volunteer status"))
//    }
//  }

}

