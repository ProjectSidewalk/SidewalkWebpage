package controllers.api

import controllers.base.CustomControllerComponents
import models.api.{ApiError, ValidationDataForApi, ValidationFiltersForApi}
import models.utils.CommonUtils.UiSource
import models.validation.ValidationOption
import org.apache.pekko.stream.scaladsl.Source
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
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * v3 API: Returns validation data according to specified filters.
   *
   * @param labelId Optional label ID to filter by specific label
   * @param userId Optional user ID to filter by specific validator
   * @param validationResult Optional validation result (Agree, Disagree, or Unsure)
   * @param labelTypeId Optional label type ID to filter by type of validated label
   * @param validationTimestamp Optional ISO 8601 timestamp to filter validations after this time
   * @param changedTags Optional boolean to filter validations where tags were changed (true) or not changed (false)
   * @param changedSeverityLevels Optional boolean to filter validations where severity was changed (true) or not changed (false)
   * @param source Optional validation interface to filter by (e.g. "Validate", "ValidateMobile", "ExpertValidate")
   * @param filetype Output format: "json" (default), "csv"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getValidations(
      labelId: Option[Int],
      userId: Option[String],
      validationResult: Option[String],
      labelTypeId: Option[Int],
      validationTimestamp: Option[String],
      changedTags: Option[Boolean],
      changedSeverityLevels: Option[Boolean],
      source: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

    // Parse and validate the timestamp (malformed values are reported rather than silently dropped).
    val parsedTimestamp = parseDateTimeParam(validationTimestamp, "validationTimestamp")

    // Parse the validation result string into the enum (None if absent or invalid; invalid is rejected below).
    val parsedValidationResult: Option[ValidationOption.Value] = validationResult.flatMap(ValidationOption.fromString)

    // Parse the source (validation interface) into the UiSource enum; an unknown value is rejected below.
    val parsedSource: Either[ApiError, Option[UiSource.Value]] = source match {
      case None    => Right(None)
      case Some(s) =>
        UiSource.values.find(_.toString == s) match {
          case Some(uiSource) => Right(Some(uiSource))
          case None           =>
            Left(
              ApiError.invalidParameter(
                s"Invalid source value '$s'. Must be one of the validation interface names, e.g. Validate, " +
                  "ValidateMobile, ExpertValidate.",
                "source"
              )
            )
        }
    }

    // Collect the first invalid-parameter error, if any.
    val firstError: Option[ApiError] = Seq(
      parsedTimestamp.left.toOption,
      parsedSource.left.toOption,
      if (validationResult.isDefined && parsedValidationResult.isEmpty)
        Some(
          ApiError
            .invalidParameter("Invalid validationResult value. Must be Agree, Disagree, or Unsure.", "validationResult")
        )
      else None,
      // Shapefiles are unsupported because validations have no geographic coordinates.
      if (filetype.contains("shapefile"))
        Some(
          ApiError.invalidParameter(
            "Shapefile format is not supported for validation data. Validations do not contain geographic " +
              "coordinates. Use 'json' or 'csv' format instead.",
            "filetype"
          )
        )
      else None
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None        =>
        // Create filters object and get the data stream.
        val filters = ValidationFiltersForApi(
          labelId = labelId, userId = userId, validationResult = parsedValidationResult, labelTypeId = labelTypeId,
          validationTimestamp = parsedTimestamp.toOption.flatten, changedTags = changedTags,
          changedSeverityLevels = changedSeverityLevels, source = parsedSource.toOption.flatten
        )
        val dbDataStream: Source[ValidationDataForApi, _] = apiService.getValidations(filters, DEFAULT_BATCH_SIZE)
        val baseFileName: String                          = s"validations_${OffsetDateTime.now()}"

        // Output data in the appropriate file format.
        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, ValidationDataForApi.csvHeader, inline, baseFileName + ".csv")
          case _ => // Default to JSON
            outputJSON(dbDataStream, inline, baseFileName + ".json")
        }
    }
  }

  /**
   * Returns information about validation result types (Agree, Disagree, Unsure).
   *
   * This endpoint provides details about each validation result type including:
   * - Name (Agree, Disagree, Unsure)
   * - Count (number of validations of this type)
   *
   * @return JSON response containing validation result type information
   */
  def getValidationResultTypes = silhouette.UserAwareAction.async { implicit request =>
    apiService.getValidationResultTypes
      .map { validationTypes =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        Ok(Json.obj("status" -> "OK", "validation_result_types" -> validationTypes))
      }
      .recover { case e: Exception =>
        ApiError.toResult(ApiError.internalServerError(s"Error retrieving validation result types: ${e.getMessage}"))
      }
  }
}
