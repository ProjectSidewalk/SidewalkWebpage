package controllers.api

import controllers.base.CustomControllerComponents
import models.api.{ApiError, ValidationDataForApi, ValidationFiltersForApi}
import org.apache.pekko.stream.Materializer
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.ApiService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import java.time.OffsetDateTime

/**
 * Controller for handling API requests related to label validations
 *
 * This controller provides endpoints for retrieving validation data with
 * various filters. The data can be returned in JSON or CSV formats.
 * Note: Shapefiles are not supported for validation data since validations
 * do not contain geographic coordinates.
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
)(implicit ec: ExecutionContext, mat: Materializer)
    extends BaseApiController(cc) {

  /**
   * v3 API: Returns validation data according to specified filters.
   *
   * @param label_id Optional label ID to filter by specific label
   * @param user_id Optional user ID to filter by specific validator
   * @param validation_result Optional validation result (1=Agree, 2=Disagree, 3=Unsure)
   * @param label_type_id Optional label type ID to filter by type of validated label
   * @param validation_timestamp Optional ISO 8601 timestamp to filter validations after this time
   * @param changed_tags Optional boolean to filter validations where tags were changed (true) or not changed (false)
   * @param changed_severity_levels Optional boolean to filter validations where severity was changed (true) or not changed (false)
   * @param filetype Output format: "json" (default), "csv"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getValidations(
      label_id: Option[Int],
      user_id: Option[String],
      validation_result: Option[Int],
      label_type_id: Option[Int],
      validation_timestamp: Option[String],
      changed_tags: Option[Boolean],
      changed_severity_levels: Option[Boolean],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    try {
      logger.info(
        s"getValidations called with parameters: " +
          s"label_id=$label_id, user_id=$user_id, validation_result=$validation_result, " +
          s"label_type_id=$label_type_id, validation_timestamp=$validation_timestamp, " +
          s"changed_tags=$changed_tags, changed_severity_levels=$changed_severity_levels, " +
          s"filetype=$filetype, inline=$inline"
      )

      // Parse timestamp if provided
      val parsedTimestamp = validation_timestamp.flatMap { s =>
        try {
          Some(OffsetDateTime.parse(s))
        } catch {
          case e: Exception =>
            logger.warn(s"Error parsing validation_timestamp: ${e.getMessage}")
            None
        }
      }

      // Create filters object
      val filters = ValidationFiltersForApi(
        labelId = label_id,
        userId = user_id,
        validationResult = validation_result,
        labelTypeId = label_type_id,
        validationTimestamp = parsedTimestamp,
        changedTags = changed_tags,
        changedSeverityLevels = changed_severity_levels
      )

      logger.info(s"Applying filters: $filters")

      val baseFileName: String = s"validations_${OffsetDateTime.now()}"
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.remoteAddress,
        request.toString
      )

      // Handle error cases
      if (validation_result.isDefined && !Seq(1, 2, 3).contains(validation_result.get)) {
        Future.successful(BadRequest(
          Json.toJson(
            ApiError.invalidParameter(
              "Invalid validation_result value. Must be 1 (Agree), 2 (Disagree), or 3 (Unsure).",
              "validation_result"
            )
          )
        ))
      } else if (filetype.contains("shapefile")) {
        // Return error for shapefile requests since validations don't have coordinates
        Future.successful(BadRequest(
          Json.toJson(
            ApiError.invalidParameter(
              "Shapefile format is not supported for validation data. Validations do not contain geographic coordinates. Use 'json' or 'csv' format instead.",
              "filetype"
            )
          )
        ))
      } else {
        try {
          // Get the data stream
          val dbDataStream =
            apiService.getValidations(filters, DEFAULT_BATCH_SIZE)

          // Log when a stream is created
          logger.info(
            s"Created data stream with filetype: ${filetype.getOrElse("json")}"
          )

          // Output data in the appropriate file format
          val result = filetype match {
            case Some("csv") =>
              outputCSV(
                dbDataStream,
                ValidationDataForApi.csvHeader,
                inline,
                baseFileName + ".csv"
              )
            case _ => // Default to JSON
              outputJSON(dbDataStream, inline, baseFileName + ".json")
          }
          
          Future.successful(result)
        } catch {
          case e: Exception =>
            logger.error(s"Error processing request: ${e.getMessage}", e)
            Future.successful(InternalServerError(
              Json.toJson(
                ApiError.internalServerError(
                  s"Error processing request: ${e.getMessage}"
                )
              )
            ))
        }
      }
    } catch {
      case e: Exception =>
        logger.error(
          s"Unexpected error in getValidations: ${e.getMessage}",
          e
        )
        Future.successful(
          InternalServerError(
            Json.toJson(
              ApiError.internalServerError(s"Unexpected error: ${e.getMessage}")
            )
          )
        )
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
      apiService.getValidationResultTypes().map { validationTypes =>
        cc.loggingService.insert(
          request.identity.map(_.userId),
          request.remoteAddress,
          request.toString
        )
        
        Ok(Json.obj(
          "status" -> "OK",
          "validation_result_types" -> validationTypes
        ))
      }.recover {
        case e: Exception =>
          logger.error(s"Error retrieving validation result types: ${e.getMessage}", e)
          InternalServerError(
            Json.toJson(
              ApiError.internalServerError(
                s"Error retrieving validation result types: ${e.getMessage}"
              )
            )
          )
      }
    } catch {
      case e: Exception =>
        logger.error(
          s"Unexpected error in getValidationResultTypes: ${e.getMessage}",
          e
        )
        Future.successful(
          InternalServerError(
            Json.toJson(
              ApiError.internalServerError(s"Unexpected error: ${e.getMessage}")
            )
          )
        )
    }
  }
}