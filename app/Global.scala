package app

import com.google.inject.Guice
import com.mohiva.play.silhouette.api.{ Logger, SecuredSettings }
import controllers.routes
import play.api._
import play.api.GlobalSettings
import play.api.i18n.{ Lang, Messages }
import play.api.mvc._
import play.api.mvc.Results._
import play.api.mvc.{ RequestHeader, Result }
import utils.di.SilhouetteModule
import controllers.headers._
import play.api.libs.concurrent.Akka
import play.filters.gzip.GzipFilter

import scala.concurrent.Future
import play.api.Play.current
import utils.actor._

/**
 * The global object.
 */
object Global extends WithFilters(new GzipFilter()) with Global {
  /**
   * Handling errors
   * http://alvinalexander.com/scala/handling-scala-play-framework-2-404-500-errors
   * https://www.playframework.com/documentation/2.3.x/ScalaGlobal
   */
  override def onBadRequest(request: RequestHeader, error: String) = {
    Future.successful(BadRequest("Bad Request: " + error))
  }

  /**
   * 500 - internal server error
   */
  override def onError(request: RequestHeader, throwable: Throwable) = {
    Future.successful(InternalServerError(views.html.errors.onError(throwable)))
  }

  /**
   * 404 - Page not found
   * @param request
   * @return
   */
  override def onHandlerNotFound(request: RequestHeader) = {
    Future.successful(NotFound(
      views.html.errors.onHandlerNotFound(request)
    ))
  }

}

/**
 * The global configuration.
 */
trait Global extends GlobalSettings with SecuredSettings with Logger {

  /**
   * The Guice dependencies injector.
   */
  val injector = Guice.createInjector(new SilhouetteModule)

  /**
   * Loads the controller classes with the Guice injector,
   * in order to be able to inject dependencies directly into the controller.
   *
   * @param controllerClass The controller class to instantiate.
   * @return The instance of the controller class.
   * @throws Exception if the controller couldn't be instantiated.
   */
  override def getControllerInstance[A](controllerClass: Class[A]) = injector.getInstance(controllerClass)

  override def onStart(app: Application) = {
    Akka.system.actorOf(RecalculateStreetPriorityActor.props, RecalculateStreetPriorityActor.Name)
    Akka.system.actorOf(ClusterLabelAttributesActor.props, ClusterLabelAttributesActor.Name)
    Akka.system.actorOf(UserStatActor.props, UserStatActor.Name)
  }

  /**
   * Called when a user is not authenticated.
   *
   * As defined by RFC 2616, the status code of the response should be 401 Unauthorized.
   *
   * @param request The request header.
   * @param lang The currently selected language.
   * @return The result to send to the client.
   */
  override def onNotAuthenticated(request: RequestHeader, lang: Lang): Option[Future[Result]] = {
    Some(Future.successful(Redirect(routes.UserController.signIn())))
  }

  /**
   * Called when a user is authenticated but not authorized.
   *
   * As defined by RFC 2616, the status code of the response should be 403 Forbidden.
   *
   * @param request The request header.
   * @param lang The currently selected language.
   * @return The result to send to the client.
   */
  override def onNotAuthorized(request: RequestHeader, lang: Lang): Option[Future[Result]] = {
    Some(Future.successful(Redirect(routes.UserController.signIn()).flashing("error" -> Messages("access.denied"))))
  }
}
