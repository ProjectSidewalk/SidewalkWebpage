package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms._
import models.user._
import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import play.api.mvc.BodyParsers
import play.api.libs.json._
import org.joda.time.{DateTime, DateTimeZone}
import scala.concurrent.Future
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{I18nSupport, MessagesApi}

/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class UserController @Inject() (implicit val env: Environment[User, SessionAuthenticator], val messagesApi: MessagesApi)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader with I18nSupport{

  /**
   * Handles the Sign In action.
   *
   * @return The result to display.
   */
  def signIn(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signIn(SignInForm.form, url)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Handles the Sign Up action.
   *
   * @return The result to display.
   */
  def signUp(url: String) = UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
      Future.successful(Ok(views.html.signUp(SignUpForm.form)))
    } else {
      Future.successful(Redirect(url))
    }
  }

  /**
   * Handles the Sign Out action.
   *
   * @return The result to display.
   */
  def signOut(url: String) = SecuredAction.async { implicit request =>
//    val result = Future.successful(Redirect(routes.UserController.index()))

    val result = Future.successful(Redirect(url))
    env.eventBus.publish(LogoutEvent(request.identity, request, request2Messages))
    env.authenticatorService.discard(request.authenticator, result)
  }

  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => Future.successful(Ok(s"Hello $username!"))
      case None => Future.successful(Redirect("/"))
    }
  }


  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp
  def logWebpageActivity = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    val submission = request.body.validate[String]
    val anonymousUser: DBUser = UserTable.find("anonymous").get

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        val ipAddress: String = request.remoteAddress
        request.identity match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, submission, timestamp))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, submission, timestamp))
        }

        Future.successful(Ok(Json.obj()))
      }
    )
  }
}
