package modules

import play.api.http.DefaultHttpErrorHandler
import play.api.http.Status.{FORBIDDEN, NOT_FOUND}
import play.api.libs.typedmap.TypedMap
import play.api.mvc.Results._
import play.api.mvc._
import play.api.routing.Router
import play.api.{Configuration, Environment, Logger, OptionalSourceMapper}
import play.silhouette.api.services.AuthenticatorService
import play.silhouette.api.util.ExtractableRequest
import play.silhouette.impl.authenticators.CookieAuthenticator

import javax.inject._
import scala.concurrent._

@Singleton
class CustomErrorHandler @Inject() (
    env: Environment,
    config: Configuration,
    sourceMapper: OptionalSourceMapper,
    router: Provider[Router],
    authenticatorService: AuthenticatorService[CookieAuthenticator]
)(implicit ec: ExecutionContext)
    extends DefaultHttpErrorHandler(env, config, sourceMapper, router) {

  private val logger = Logger(this.getClass)

  override def onClientError(request: RequestHeader, statusCode: Int, message: String): Future[Result] = {
    // Don't log common, harmless 404s
    val shouldSkipLogging = (
      statusCode == NOT_FOUND && (
        request.path.endsWith(".map") ||              // Source maps
          request.path.startsWith("/.well-known/") || // Well-known URLs
          request.path == "/favicon.ico" ||           // Common favicon requests
          request.path.endsWith("-india.json") // We only added the India files for en so far so we expect these.
      )
    ) || // Beacon requests that we need to fix, but they happen constantly so we don't need this extra logging.
      (statusCode == FORBIDDEN && request.path.contains("Beacon"))

    if (!shouldSkipLogging) {
      logger.warn(s"Client error occurred: ${request.uri} - $statusCode - $message")
      logUserInfo(request)
    }
    statusCode match {
      case NOT_FOUND => Future.successful(NotFound(views.html.errors.onHandlerNotFound(request)))
      case _         => Future.successful(Status(statusCode)("A client error occurred: " + message))
    }
  }

  override def onServerError(request: RequestHeader, exception: Throwable): Future[Result] = {
    logger.info("Server error occurred: " + exception.getMessage, exception)
    logUserInfo(request)
    super.onServerError(request, exception) // Continue with default error handling.
  }

  /**
   * Extracts user information from Silhouette authenticator cookie and logs it.
   */
  private def logUserInfo(request: RequestHeader): Future[Unit] = {
    // Create a minimal Request from RequestHeader for Silhouette
    val dummyRequest: Request[AnyContent] = new Request[AnyContent] {
      override def body: AnyContent                                  = AnyContent()
      override def connection: play.api.mvc.request.RemoteConnection = request.connection
      override def method: String                                    = request.method
      override def target: play.api.mvc.request.RequestTarget        = request.target
      override def version: String                                   = request.version
      override def headers: play.api.mvc.Headers                     = request.headers
      override def attrs: TypedMap                                   = request.attrs
    }

    val extractableRequest = new ExtractableRequest(dummyRequest)

    val userInfo = authenticatorService
      .retrieve(extractableRequest)
      .flatMap {
        case Some(authenticator) if authenticator.isValid =>
          Future.successful(s"Email: ${authenticator.loginInfo.providerKey}, IP: ${request.remoteAddress}")
        case Some(_) =>
          Future.successful(s"Invalid authenticator, IP: ${request.remoteAddress}")
        case None =>
          Future.successful(s"No authenticator found, IP: ${request.remoteAddress}")
      }
      .recover { case ex =>
        logger.debug(s"Error retrieving user info: ${ex.getMessage}")
        s"Error retrieving user info, IP: ${request.remoteAddress}"
      }
    userInfo.map(info => logger.info(info))
  }
}
