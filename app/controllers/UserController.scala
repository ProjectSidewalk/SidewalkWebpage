package controllers

import com.mohiva.play.silhouette.api.actions.UserAwareRequest

import javax.inject._
import play.api.mvc._
import scala.concurrent.{ExecutionContext, Future}
import com.mohiva.play.silhouette.api.{LogoutEvent, Silhouette}
import forms._
import models.auth.DefaultEnv
import controllers.base._
import play.api.Configuration
import play.api.libs.json.{JsError, Json}
import service.utils.ConfigService


@Singleton
class UserController @Inject()(
                                cc: CustomControllerComponents,
                                val config: Configuration,
                                val silhouette: Silhouette[DefaultEnv],
                                configService: ConfigService
                              )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
  /**
   * Handles the Sign In action.
   *
   * @return The result to display.
   */
  def signIn() = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      for {
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_SignIn")
        Ok(views.html.signIn(SignInForm.form, commonData, request.identity))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
   * Get the mobile sign in page.
   */
//  def signInMobile(url: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
  def signUp() = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, "Visit_SignUp")
        Ok(views.html.signUp(SignUpForm.form, commonData, request.identity))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
   * Get the mobile sign up page.
   */
//  def signUpMobile(url: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
//  def signOut(url: String) =  cc.securityService.SecuredAction { implicit request =>
//    val result = Redirect(routes.ApplicationController.index())
//     silhouette.env.eventBus.publish(LogoutEvent(request.identity, request))
//
//     silhouette.env.authenticatorService.discard(request.authenticator, result)
//  }
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
//  def forgotPassword(url: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
//  def resetPassword(token: UUID) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
//    cc.loggingService.insert(WebpageActivity(0, userId, ipAddress, logStr, timestamp))
//  }

  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp.
  def logWebpageActivity = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    request.body.validate[String].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        println(s"Logging webpage activity: $submission")
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, submission)
        Future.successful(Ok(Json.obj()))
      }
    )
  }

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

