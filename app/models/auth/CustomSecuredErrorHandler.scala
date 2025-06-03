package models.auth

import controllers.helper.ControllerUtils.anonSignupRedirect
import play.api.Logger
import play.api.i18n.{I18nSupport, MessagesApi}
import play.api.mvc.Results._
import play.api.mvc.{RequestHeader, Result}
import play.silhouette.api.actions.SecuredErrorHandler

import javax.inject.Inject
import scala.concurrent.Future

/**
 * Custom secured error handler.
 * @param messagesApi The Play messages API.
 */
class CustomSecuredErrorHandler @Inject() (val messagesApi: MessagesApi) extends SecuredErrorHandler with I18nSupport {
  private val logger = Logger(this.getClass)

  /**
   * Called when a user is not authenticated. As defined by RFC 2616, the status code should be 401 Unauthorized.
   * @param request The request header.
   * @return The result to send to the client.
   */
  override def onNotAuthenticated(implicit request: RequestHeader): Future[Result] = {
    Future.successful(anonSignupRedirect(request))
  }

  /**
   * Called when a user is authenticated but not authorized. Sends them to sign in page so they can sign in as an admin.
   *
   * NOTE: This method should not be used. Instead, CustomSecurityService handles authorization with more flexibility.
   * As defined by RFC 2616, the status code of the response should be 403 Forbidden.
   *
   * @param request The request header.
   * @return The result to send to the client.
   */
  override def onNotAuthorized(implicit request: RequestHeader): Future[Result] = {
    logger.error("Using the onNotAuthorized method in CustomSecuredErrorHandler. Should only be using CustomSecurityService. Route: " + request.path)
    Future.successful(Forbidden("Not authorized. This message should not be seen. Contact sidewalk@cs.uw.edu if you see this message."))
  }
}
