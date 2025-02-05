package models.auth

import javax.inject.Inject
import com.mohiva.play.silhouette.api.actions.SecuredErrorHandler
import controllers.helper.ControllerUtils.anonSignupRedirect
import play.api.i18n.{I18nSupport, MessagesApi}
import play.api.mvc.RequestHeader
import play.api.mvc.Results._

import scala.concurrent.Future

/**
 * Custom secured error handler.
 *
 * @param messagesApi The Play messages API.
 */
class CustomSecuredErrorHandler @Inject() (val messagesApi: MessagesApi) extends SecuredErrorHandler with I18nSupport {

  /**
   * Called when a user is not authenticated.
   *
   * As defined by RFC 2616, the status code of the response should be 401 Unauthorized.
   *
   * @param request The request header.
   * @return The result to send to the client.
   */
  override def onNotAuthenticated(implicit request: RequestHeader) = {
    // TODO When we use mturk again, reference old index page for turker signup.
    Future.successful(anonSignupRedirect(request))
  }

  /**
   * Called when a user is authenticated but not authorized. Sends them to sign in page so they can sign in as an admin.
   *
   * As defined by RFC 2616, the status code of the response should be 403 Forbidden.
   *
   * @param request The request header.
   * @return The result to send to the client.
   */
  override def onNotAuthorized(implicit request: RequestHeader) = {
    // TODO what if user is signed in (not anon) but not an admin? Do they get an infinite loop? The answer is yes lol.
    Future.successful(Redirect("/signIn", request.queryString + ("url" -> Seq(request.path)))
      .flashing("error" -> "User is not an administrator"))
  }
}
