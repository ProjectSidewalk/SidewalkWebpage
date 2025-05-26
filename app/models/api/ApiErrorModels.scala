/**
 * Error models for the Project Sidewalk API.
 */
package models.api

import play.api.libs.json.{Json, OFormat}

/**
 * Represents an API error response with standard HTTP status codes and error details.
 *
 * @param status HTTP status code (e.g., 400, 404, 500)
 * @param code Machine-readable error code (e.g., "BAD_REQUEST", "NOT_FOUND")
 * @param message Human-readable error message
 * @param parameter Optional parameter name that caused the error
 */
case class ApiError(status: Int, code: String, message: String, parameter: Option[String] = None)

/**
 * Companion object for ApiError containing JSON formatter and factory methods
 * for common error types.
 */
object ApiError {
  implicit val apiErrorFormat: OFormat[ApiError] = Json.format[ApiError]

  /**
   * Creates a generic Bad Request (400) error.
   *
   * @param message Human-readable error message
   * @param parameter Optional parameter name that caused the error
   * @return An ApiError instance with status 400
   */
  def badRequest(message: String, parameter: Option[String] = None): ApiError =
    ApiError(400, "BAD_REQUEST", message, parameter)

  /**
   * Creates an Invalid Parameter (400) error with a specific parameter name.
   *
   * @param message Human-readable error message
   * @param parameter Name of the parameter that was invalid
   * @return An ApiError instance with status 400 and code INVALID_PARAMETER
   */
  def invalidParameter(message: String, parameter: String): ApiError =
    ApiError(400, "INVALID_PARAMETER", message, Some(parameter))

  /**
   * Creates an Internal Server Error (500) response.
   *
   * @param message Human-readable error message
   * @return An ApiError instance with status 500
   */
  def internalServerError(message: String): ApiError =
    ApiError(500, "INTERNAL_SERVER_ERROR", message, None)

  /**
   * Creates a Not Implemented (501) error response.
   *
   * @param message Human-readable error message
   * @return An ApiError instance with status 501
   */
  def notImplemented(message: String): ApiError =
    ApiError(501, "NOT_IMPLEMENTED", message, None)

  /**
   * Creates a Not Found (404) error response.
   *
   * @param message Human-readable error message
   * @return An ApiError instance with status 404
   */
  def notFound(message: String): ApiError =
    ApiError(404, "NOT_FOUND", message, None)
}
