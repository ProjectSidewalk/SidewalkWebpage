package modules

import javax.inject._
import play.api.http.DefaultHttpErrorHandler
import play.api.mvc._
import play.api.mvc.Results._

import scala.concurrent._
import play.api.http.Status.NOT_FOUND

@Singleton
class CustomErrorHandler @Inject() extends DefaultHttpErrorHandler {

  override def onClientError(request: RequestHeader, statusCode: Int, message: String): Future[Result] = {
    statusCode match {
      case NOT_FOUND => Future.successful(NotFound(views.html.errors.onHandlerNotFound(request)))
      case _ => Future.successful(Status(statusCode)("A client error occurred: " + message))
    }
  }
}
