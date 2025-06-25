package controllers.api

import controllers.base.CustomControllerComponents
import models.api.{ApiError, ValidationDataForApi, ValidationFiltersForApi}
import org.apache.pekko.stream.scaladsl.Source
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.ApiService

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for handling API requests related to label validations.
 *
 * This controller provides endpoints for retrieving validation data with various filters. The data can be returned in
 * JSON or CSV formats. Note: Shapefiles are not supported for validation data since validations do not contain
 * geographic coordinates.
 *
 * @constructor Creates a new instance of the ValidationApiController.
 * @param cc Custom controller components for dependency injection.
 * @param silhouette Silhouette authentication environment.
 * @param apiService Service for handling API-related operations.
 * @param ec Execution context for handling asynchronous operations.
 * @param mat Materializer for handling Akka streams.
 */
@Singleton
class ValidationApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService
)(implicit ec: ExecutionContext) extends BaseApiController(cc) {

  /**
   * v3 API: Returns validation data according to specified filters.
   *
   * @param labelId Optional label ID to filter by specific label
   * @param userId Optional user ID to filter by specific validator
   * @param validationResult Optional validation result (1=Agree, 2=Disagree, 3=Unsure)
   * @param labelTypeId Optional label type ID to filter by type of validated label
   * @param validationTimestamp Optional ISO 8601 timestamp to filter validations after this time
   * @param changedTags Optional boolean to filter validations where tags were changed (true) or not changed (false)
   * @param changedSeverityLevels Optional boolean to filter validations where severity was changed (true) or not changed (false)
   * @param filetype Output format: "json" (default), "csv"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getValidations(
      labelId: Option[Int],
      userId: Option[String],
      validationResult: Option[Int],
      labelTypeId: Option[Int],
      validationTimestamp: Option[String],
      changedTags: Option[Boolean],
      changedSeverityLevels: Option[Boolean],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
    try {
      // Parse timestamp if provided.
      val parsedTimestamp: Option[OffsetDateTime] = parseDateTimeString(validationTimestamp)

      // Create filters object.
      val filters = ValidationFiltersForApi(
        labelId = labelId,
        userId = userId,
        validationResult = validationResult,
        labelTypeId = labelTypeId,
        validationTimestamp = parsedTimestamp,
        changedTags = changedTags,
        changedSeverityLevels = changedSeverityLevels
      )

      // Handle error cases for invalid parameters.
      if (validationResult.isDefined && !Seq(1, 2, 3).contains(validationResult.get)) {
        Future.successful(BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid validationResult value. Must be 1 (Agree), 2 (Disagree), or 3 (Unsure).",
          "validationResult"
        ))))
      } else if (filetype.contains("shapefile")) {
        // Return error for shapefile requests since validations don't have coordinates.
        Future.successful(BadRequest(Json.toJson(ApiError.invalidParameter(
          "Shapefile format is not supported for validation data. Validations do not contain geographic coordinates. Use 'json' or 'csv' format instead.",
          "filetype"
        ))))
      } else {
        try {
          // Get the data stream.
          val dbDataStream: Source[ValidationDataForApi, _] = apiService.getValidations(filters, DEFAULT_BATCH_SIZE)
          val baseFileName: String = s"validations_${OffsetDateTime.now()}"

          // Output data in the appropriate file format.
          filetype match {
            case Some("csv") =>
              outputCSV(dbDataStream, ValidationDataForApi.csvHeader, inline, baseFileName + ".csv")
            case _ => // Default to JSON
              outputJSON(dbDataStream, inline, baseFileName + ".json")
          }
        } catch {
          case e: Exception =>
            logger.error(s"Error processing request: ${e.getMessage}", e)
            Future.successful(InternalServerError(Json.toJson(
              ApiError.internalServerError(s"Error processing request: ${e.getMessage}")
            )))
        }
      }
    } catch {
      case e: Exception =>
        logger.error(s"Unexpected error in getValidations: ${e.getMessage}", e)
        Future.successful(InternalServerError(Json.toJson(
          ApiError.internalServerError(s"Unexpected error: ${e.getMessage}")
        )))
    }
  }

  /**
   * Returns information about validation result types (Agree, Disagree, Unsure).
   *
   * This endpoint provides details about each validation result type including:
   * - ID (1, 2, 3)
   * - Name (Agree, Disagree, Unsure)
   * - Count (number of validations of this type)
   *
   * @return JSON response containing validation result type information
   */
  def getValidationResultTypes = silhouette.UserAwareAction.async { implicit request =>
    try {
      apiService.getValidationResultTypes.map { validationTypes =>
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
        Ok(Json.obj("status" -> "OK", "validation_result_types" -> validationTypes))
      }.recover {
        case e: Exception =>
          logger.error(s"Error retrieving validation result types: ${e.getMessage}", e)
          InternalServerError(Json.toJson(
              ApiError.internalServerError(s"Error retrieving validation result types: ${e.getMessage}")
          ))
      }
    } catch {
      case e: Exception =>
        logger.error(s"Unexpected error in getValidationResultTypes: ${e.getMessage}", e)
        Future.successful(InternalServerError(
          Json.toJson(ApiError.internalServerError(s"Unexpected error: ${e.getMessage}"))
        ))
    }
  }
}
