package models.auth

import play.api.mvc.RequestHeader
import play.api.mvc.Results._
import play.silhouette.api.actions.UnsecuredErrorHandler

import scala.concurrent.Future

/**
 * Custom unsecured error handler.
 */
class CustomUnsecuredErrorHandler extends UnsecuredErrorHandler {

  /**
   * Called when a user is authenticated but not authorized.
   * TODO when does it matter if they're authenticated but not authorized in an unsecured context?
   *
   * As defined by RFC 2616, the status code of the response should be 403 Forbidden.
   *
   * @param request The request header.
   * @return The result to send to the client.
   */
  override def onNotAuthorized(implicit request: RequestHeader) = {
    Future.successful(Redirect(controllers.routes.ApplicationController.index))
  }
}
