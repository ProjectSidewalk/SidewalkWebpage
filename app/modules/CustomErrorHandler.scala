package modules

import controllers.AssetsFinder
import models.api.ApiError
import play.api.http.DefaultHttpErrorHandler
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.typedmap.TypedMap
import play.api.mvc.Results._
import play.api.mvc._
import play.api.routing.Router
import play.api.{Configuration, Environment, Logger, OptionalSourceMapper, UsefulException}
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
    authenticatorService: AuthenticatorService[CookieAuthenticator],
    messagesApi: MessagesApi
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends DefaultHttpErrorHandler(env, config, sourceMapper, router) {

  private val logger = Logger(this.getClass)

  /**
   * True for requests to the public data API. Framework-level errors on these paths are rendered as RFC 7807
   * `application/problem+json` (matching what the API controllers emit) instead of the HTML/plain-text used for
   * the rest of the site. Note `/v3/api-docs/...` does NOT match (those are HTML doc pages).
   */
  private def isApiRequest(request: RequestHeader): Boolean = request.path.startsWith("/v3/api/")

  override def onClientError(request: RequestHeader, statusCode: Int, message: String): Future[Result] = {
    // Don't log common, harmless 404s
    val shouldSkipLogging =
      statusCode == NOT_FOUND && (
        request.path.endsWith(".map") ||              // Source maps
          request.path.startsWith("/.well-known/") || // Well-known URLs
          request.path == "/favicon.ico" ||           // Common favicon requests
          request.path.endsWith("-india.json")        // We only added the India files for en so far so we expect these.
      )

    if (!shouldSkipLogging) {
      logger.warn(s"Client error occurred: ${request.uri} - $statusCode - $message")
      logUserInfo(request)
    }
    // API requests get the same RFC 7807 problem+json envelope the controllers use, so framework-level errors
    // (unknown route, malformed typed route param, etc.) are consistent with handler-level errors (#3931).
    if (isApiRequest(request)) {
      val detail = statusCode match {
        case NOT_FOUND             => s"No API endpoint matches ${request.method} ${request.path}."
        case _ if message.nonEmpty => message
        case _                     => "The request could not be processed."
      }
      Future.successful(ApiError.toResult(ApiError.forStatus(statusCode, detail)))
    } else {
      statusCode match {
        case NOT_FOUND =>
          implicit val messages: Messages = messagesApi.preferred(request)
          Future.successful(
            NotFound(
              views.html.errors
                .errorPage(Messages("error.404.heading"), Messages("error.404.message", request.path))
            )
          )
        case _ => Future.successful(Status(statusCode)("A client error occurred: " + message))
      }
    }
  }

  override def onServerError(request: RequestHeader, exception: Throwable): Future[Result] = {
    logger.error("Server error occurred: " + exception.getMessage, exception)
    logUserInfo(request)
    // API requests get a problem+json 500 (without leaking exception internals); other routes keep Play's default
    // (dev error page / generic HTML) error handling.
    if (isApiRequest(request)) {
      Future.successful(
        ApiError.toResult(ApiError.internalServerError("An internal error occurred while processing the request."))
      )
    } else {
      super.onServerError(request, exception)
    }
  }

  /**
   * Renders a branded, self-contained 500 page for non-API routes in prod (#3954). Reached via `super.onServerError`
   * above, so the exception is already logged and `exception.id` matches the id in the log — shown to the user so they
   * can quote it when reporting. Dev keeps Play's stack-trace page (`onDevServerError` is left untouched).
   *
   * @param request   The request that triggered the error.
   * @param exception The framework-wrapped exception, carrying the generated error id.
   * @return          A 500 response rendering the shared error page.
   */
  override protected def onProdServerError(request: RequestHeader, exception: UsefulException): Future[Result] = {
    implicit val messages: Messages = messagesApi.preferred(request)
    Future.successful(
      InternalServerError(
        views.html.errors.errorPage(Messages("error.500.heading"), Messages("error.500.message"), Some(exception.id))
      )
    )
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
