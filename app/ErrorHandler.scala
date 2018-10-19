//import javax.inject._
//
//import play.api.http.DefaultHttpErrorHandler
//import play.api._
//import play.api.mvc._
//import play.api.mvc.Results._
//import play.api.routing.Router
//import scala.concurrent._
//
//class ErrorHandler @Inject() (
//                               env: Environment,
//                               config: Configuration,
//                               sourceMapper: OptionalSourceMapper,
//                               router: Provider[Router]
//                             ) extends DefaultHttpErsrorHandler(env, config, sourceMapper, router) {
//
//  override def onProdServerError(request: RequestHeader, exception: UsefulException) = {
//    Future.successful(
//      InternalServerError("A server error occurred: " + exception.getMessage)
//    )
//  }
//
//  override def onForbidden(request: RequestHeader, message: String) = {
//    Future.successful(
//      Forbidden("You're not allowed to access this resource.")
//    )
//  }
//}