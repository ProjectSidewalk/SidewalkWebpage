package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.services.{AuthInfoService, AvatarService}
import com.mohiva.play.silhouette.api.util.PasswordHasher
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.mohiva.play.silhouette.impl.providers._
import controllers.headers.ProvidesHeader
import forms.SignUpForm
import models.daos.slick.UserDAOSlick
import models.services.UserService
import models.user.{UserCurrentRegionTable, UserRoleTable, User}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action

import scala.concurrent.Future

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
                                   val authInfoService: AuthInfoService,
                                   val avatarService: AvatarService,
                                   val passwordHasher: PasswordHasher)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
   * Registers a new user.
   *
   * @return The result to display.
   */
  def signUp(url: String) = Action.async { implicit request =>
    SignUpForm.form.bindFromRequest.fold (
      form => Future.successful(BadRequest(views.html.signUp(form))),
      data => {
        // Check presenc of user by username
        import models.daos.slick.DBTableDefinitions.UserTable
        UserTable.find(data.username) match {
          case Some(user) =>
            Future.successful(Redirect(routes.UserController.signUp()).flashing("error" -> Messages("Username already exists")))
          case None =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, data.email)
            val authInfo = passwordHasher.hash(data.password)
            val user = User(
              userId = UUID.randomUUID(),
              loginInfo = loginInfo,
              username = data.username,
              email = data.email,
              roles = None
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
              UserRoleTable.addUserRole(user.userId)
              UserCurrentRegionTable.assign(user.userId)
              env.eventBus.publish(SignUpEvent(user, request, request2lang))
              env.eventBus.publish(LoginEvent(user, request, request2lang))
              result
            }
        }
      }
    )
  }
}
