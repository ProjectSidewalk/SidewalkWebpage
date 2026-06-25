/**
 * RFC 7807 "Problem Details for HTTP APIs" error model for the Project Sidewalk API.
 *
 * Every error the `/v3/api` surface returns — whether raised by a controller (e.g. an invalid query
 * parameter) or by the framework via `CustomErrorHandler` (an unknown route, an unhandled exception) — is
 * serialized as an RFC 7807 problem detail with the `application/problem+json` content type, so consumers
 * get one consistent, machine-readable error schema across the whole API (#3931).
 */
package models.api

import play.api.libs.json.{JsString, Json, Writes}
import play.api.mvc.{Result, Results}

/**
 * An RFC 7807 problem detail describing a single API error.
 *
 * The first four fields are the standard RFC 7807 members; `code` and `parameter` are Project Sidewalk
 * extension members (allowed by the spec). `code` is a stable machine-readable discriminator that consumers
 * can branch on without dereferencing `problemType`; `parameter` names the offending query/REST parameter
 * for validation errors.
 *
 * @param status      HTTP status code (also echoed in the body per RFC 7807).
 * @param code        Stable machine-readable error code (e.g. "INVALID_PARAMETER", "NOT_FOUND").
 * @param title       Short, human-readable summary of the problem type; stable for a given `code`.
 * @param detail      Human-readable explanation specific to this occurrence.
 * @param parameter   Name of the query/REST parameter that caused the error, if applicable.
 * @param problemType RFC 7807 `type` URI. Defaults to "about:blank" (no type beyond the status code).
 */
case class ApiError(
    status: Int,
    code: String,
    title: String,
    detail: String,
    parameter: Option[String] = None,
    problemType: String = "about:blank"
)

/**
 * Companion object for ApiError: JSON serialization, the `application/problem+json` renderer, and factory
 * methods for the error types the API raises.
 */
object ApiError {

  /** RFC 7807 media type for problem detail responses. */
  val ContentType: String = "application/problem+json"

  /**
   * Serializes an ApiError as an RFC 7807 problem object. Standard members (`type`, `title`, `status`,
   * `detail`) are emitted first, followed by the extension members (`code`, and `parameter` when present).
   */
  implicit val writes: Writes[ApiError] = (e: ApiError) => {
    val base = Json.obj(
      "type"   -> e.problemType,
      "title"  -> e.title,
      "status" -> e.status,
      "detail" -> e.detail,
      "code"   -> e.code
    )
    e.parameter.fold(base)(p => base + ("parameter" -> JsString(p)))
  }

  /**
   * Renders an ApiError as a Play `Result` with its HTTP status and the `application/problem+json` content
   * type. Centralizing rendering here keeps every error site — controllers and the error handler — emitting
   * the identical envelope and media type.
   */
  def toResult(error: ApiError): Result = Results.Status(error.status)(Json.toJson(error)).as(ContentType)

  /**
   * Creates a 400 problem detail for an invalid query/REST parameter.
   *
   * @param detail    Human-readable explanation of why the value was rejected.
   * @param parameter Name of the offending parameter.
   */
  def invalidParameter(detail: String, parameter: String): ApiError =
    ApiError(400, "INVALID_PARAMETER", "Invalid Parameter", detail, Some(parameter))

  /**
   * Creates a 500 problem detail for an unexpected server-side failure.
   *
   * @param detail Human-readable explanation (avoid leaking internal exception details to clients).
   */
  def internalServerError(detail: String): ApiError =
    ApiError(500, "INTERNAL_SERVER_ERROR", "Internal Server Error", detail)

  /**
   * Creates a 404 problem detail for a missing resource.
   *
   * @param detail Human-readable explanation of what was not found.
   */
  def notFound(detail: String): ApiError =
    ApiError(404, "NOT_FOUND", "Not Found", detail)

  /**
   * Builds a problem detail for a framework-level error from a raw HTTP status code, mapping it to a stable
   * `code`/`title`. Used by `CustomErrorHandler` to render Play's automatic client/server errors (unknown
   * route, malformed typed route param, unhandled exception) in the same RFC 7807 envelope.
   *
   * @param status HTTP status code Play produced for the error.
   * @param detail Human-readable explanation for this occurrence.
   */
  def forStatus(status: Int, detail: String): ApiError = {
    val (code, title) = status match {
      case 400               => ("BAD_REQUEST", "Bad Request")
      case 401               => ("UNAUTHORIZED", "Unauthorized")
      case 403               => ("FORBIDDEN", "Forbidden")
      case 404               => ("NOT_FOUND", "Not Found")
      case 405               => ("METHOD_NOT_ALLOWED", "Method Not Allowed")
      case 415               => ("UNSUPPORTED_MEDIA_TYPE", "Unsupported Media Type")
      case s if s >= 500     => ("INTERNAL_SERVER_ERROR", "Internal Server Error")
      case _                 => ("CLIENT_ERROR", "Client Error")
    }
    ApiError(status, code, title, detail)
  }
}
