package controllers

import play.silhouette.api.actions.UserAwareRequest
import javax.inject._
import play.api.mvc._
import scala.concurrent.{ExecutionContext, Future}
import play.silhouette.api.{LogoutEvent, Silhouette}
import forms._
import models.auth.DefaultEnv
import controllers.base._
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json.{JsError, Json}

@Singleton
class UserController @Inject()(cc: CustomControllerComponents,
                               val config: Configuration,
                               val silhouette: Silhouette[DefaultEnv],
                               configService: service.ConfigService,
                               authenticationService: service.AuthenticationService
                              )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
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
  def resetPassword(token: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
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
  def logWebpageActivity = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    request.body.validate[String].fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
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

