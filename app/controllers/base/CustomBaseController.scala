package controllers.base

import org.apache.pekko.Done
import org.apache.pekko.stream.scaladsl.Source
import play.api.Logger
import play.api.http.ContentTypes
import play.api.i18n.I18nSupport
import play.api.libs.json.JsObject
import play.api.mvc._

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

abstract class CustomBaseController(cc: CustomControllerComponents)
    extends ControllerHelpers
    with BaseController
    with I18nSupport {

  private val logger = Logger(this.getClass)

  // Batch size (JDBC fetchSize) for cursor-based streaming of large query results from the db.
  protected val DEFAULT_BATCH_SIZE: Int = 50000

  // Standard components
  override protected def controllerComponents: ControllerComponents = cc

  // Could make custom components easily accessible. Choosing not to for clarity.
  //  protected def loggingService: LoggingService = cc.loggingService
  //  protected def securityService: CustomControllerComponents = cc.securityService

  // Adds a ipAddress method to RequestHeader for easy access to the client's IP address.
  // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/465
  implicit class RequestHeaderExtensions(request: RequestHeader) {

    /**
     * The client IP as resolved by Play's forwarded-header processing (`play.http.forwarded.*` in application.conf):
     * `remoteAddress` walks X-Forwarded-For right-to-left past trusted proxies (the prod Apache reverse proxy connects
     * from 127.0.0.1 and appends the true client IP) and yields the first untrusted hop. Unlike taking the header's
     * first value, a client-supplied X-Forwarded-For cannot spoof this, so it is safe to key rate limits on (#1102).
     * With no proxy in front (dev/Docker), it is simply the TCP peer address.
     */
    def ipAddress: String = request.remoteAddress
  }

  /**
   * Attaches failure logging to a streaming response body.
   *
   * Chunked API responses (`Ok.chunked`) commit a 200 status and headers *before* the underlying database stream
   * runs. So if the stream fails mid-flight — e.g. a query timeout or dropped connection while serializing a very
   * large city's labels — the body simply ends, and Play cannot retract the status it already sent. Without this hook
   * such failures are completely silent: exactly the #4161 symptom, where large-city `/v3/api/rawLabels` returns a
   * 200 with an empty/truncated body and no server-side trace. This logs the failure so it is at least diagnosable;
   * it does not (and cannot) change the status already sent to the client.
   *
   * @param source The streaming body to monitor.
   * @param label  A short identifier (e.g. the download filename) included in the log line to locate the failure.
   * @return       The same source, with termination-failure logging attached (success behavior is unchanged).
   */
  protected def logStreamFailures(source: Source[String, _], label: String)(implicit
      ec: ExecutionContext
  ): Source[String, _] =
    source.watchTermination() { (mat, done) =>
      done.onComplete {
        case Failure(e) =>
          logger.error(
            s"API streaming response failed mid-flight for '$label'; the client received a truncated/empty body " +
              s"after a 200 status was already sent (see #4161).",
            e
          )
        case Success(_: Done) => // Stream completed normally; nothing to log.
      }
      mat
    }

  /**
   * Builds an inline chunked JSON response that streams the given GeoJSON Features as a FeatureCollection.
   *
   * Rows are serialized and sent as they arrive from the db instead of materializing the whole result in memory
   * (#3932). An empty source still yields a valid, empty FeatureCollection. For API downloads with a filename and
   * multiple output formats, use `BaseApiController.outputGeoJSON` instead.
   *
   * @param features A source of GeoJSON Feature objects, e.g. a streamed db query mapped through a serializer.
   * @param label    A short identifier (e.g. the endpoint path) included in the log line if the stream fails.
   */
  protected def streamGeoJson(features: Source[JsObject, _], label: String)(implicit ec: ExecutionContext): Result = {
    val jsonSource: Source[String, _] = features
      .map(_.toString)
      .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")
    Ok.chunked(logStreamFailures(jsonSource, label)).as(ContentTypes.JSON)
  }

  // Could add other common controller utilities here. Not sure if they should be here or in ControllerUtils.scala.
}
