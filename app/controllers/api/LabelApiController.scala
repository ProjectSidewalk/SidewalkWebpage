package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import formats.json.ApiFormats._
import models.api._
import models.label.LabelTypeEnum
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService, LabelService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * LabelApiController provides API endpoints for accessing and exporting label data.
 *
 * This controller includes methods for retrieving raw label data, metadata for computer vision projects, label types,
 * label tags, and panorama IDs with labels. It supports various output formats such as CSV, GeoJSON, Shapefile, and
 * GeoPackage, and allows filtering by bounding box, label types, tags, severity, validation status, date range, and
 * geographic regions.
 *
 * @constructor Creates a new LabelApiController instance.
 * @param cc Custom controller components for dependency injection.
 * @param silhouette Silhouette authentication environment.
 * @param apiService Service for accessing API-related data.
 * @param configService Service for accessing configuration parameters.
 * @param panoDataService Service for accessing panorama data.
 * @param labelService Service for accessing label-related data.
 * @param shapefileCreator Helper for creating shapefiles.
 * @param ec Execution context for handling asynchronous operations.
 */
@Singleton
class LabelApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService,
    configService: ConfigService,
    panoDataService: service.PanoDataService,
    labelService: LabelService,
    shapefileCreator: ShapefilesCreatorHelper
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * Get metadata used for 2022 CV project for all labels, and output as JSON.
   *
   * @param filetype One of "csv" or "json".
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getAllLabelMetadataForCV(
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    // Set up streaming data from the database.
    val dbDataStream: Source[LabelCVMetadata, _] = apiService.getLabelCVMetadata(DEFAULT_BATCH_SIZE)
    val baseFileName: String                     = timestampedFilename("labelsWithCVMetadata")
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

    // Output data in the appropriate file format: CSV or JSON (default).
    filetype match {
      case Some("csv") =>
        outputCSV(dbDataStream, LabelCVMetadata.csvHeader, inline, baseFileName + ".csv")
      case _ =>
        outputJSON(dbDataStream, inline, baseFileName + ".json")
    }
  }

  /**
   * Returns a list of all label types with metadata including icons and colors.
   *
   * @return JSON response containing label type information
   */
  def getLabelTypes = silhouette.UserAwareAction.async { request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
    val labelTypeDetailsList: Seq[LabelTypeForApi] = apiService.getLabelTypes(request.lang).toList.sortBy(_.id)
    Future.successful(Ok(Json.obj("status" -> "OK", "label_types" -> labelTypeDetailsList)))
  }

  /**
   * Returns a list of all label tags with their metadata for the current city.
   *
   * This endpoint provides information about available label tags for the current city, including their IDs, associated
   * label types, tag names, and mutual exclusivity rules.
   *
   * @return JSON response containing label tag information.
   */
  def getLabelTags = silhouette.UserAwareAction.async { request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
    labelService.getTagsForCurrentCity
      .map { tags =>
        val formattedTags = tags.map { tag =>
          // Convert the mutuallyExclusiveWith Option[String] to Seq[String].
          val mutuallyExclusiveList = tag.mutuallyExclusiveWith
            .map(_.split(",").map(_.trim).filter(_.nonEmpty).toSeq)
            .getOrElse(Seq.empty[String])

          LabelTagForApi(
            id = tag.tagId,
            labelType = LabelTypeEnum.labelTypeIdToLabelType(tag.labelTypeId),
            tag = tag.tag,
            description = messagesApi(s"tag.description.${tag.tagId}")(request.lang),
            mutuallyExclusiveWith = mutuallyExclusiveList
          )
        }

        Ok(Json.obj("status" -> "OK", "label_tags" -> formattedTags))
      }
      .recover { case e: Exception =>
        ApiError.toResult(ApiError.internalServerError(s"Failed to retrieve label tags: ${e.getMessage}"))
      }
  }

  /**
   * v3 API: Returns all sidewalk labels within the specified parameters.
   *
   * Note that if a bbox is provided, it takes precedence over region filters.
   * If a region ID is provided, it takes precedence over region name.
   *
   * @param bbox Bounding box in format "minLng,minLat,maxLng,maxLat"
   * @param labelType Comma-separated list of label types to include
   * @param tags Comma-separated list of tags to filter by; a "LabelType:tag" entry only matches that label type
   * @param severity Comma-separated set of severities to include ("1", "2", "3", "none" for unrated); mutually
   *                 exclusive with minSeverity/maxSeverity
   * @param minSeverity Minimum severity score (1-3 scale)
   * @param maxSeverity Maximum severity score (1-3 scale)
   * @param validationStatus Comma-separated validation statuses to include: "validated_correct",
   *                         "validated_incorrect", "unsure" (validated without consensus), "unvalidated" (no
   *                         validations)
   * @param highQualityUserOnly Optional filter to include only labels from high quality users if true
   * @param startDate Start date for filtering (ISO 8601 format)
   * @param endDate End date for filtering (ISO 8601 format)
   * @param regionId Optional region ID to filter by geographic region
   * @param regionName Optional region name to filter by geographic region
   * @param filetype Output format: "geojson" (default), "csv", "shapefile", "geopackage"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getRawLabelsV3(
      bbox: Option[String],
      labelType: Option[String],
      tags: Option[String],
      severity: Option[String],
      minSeverity: Option[Int],
      maxSeverity: Option[Int],
      validationStatus: Option[String],
      highQualityUserOnly: Option[Boolean],
      startDate: Option[String],
      endDate: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

    // Parse and validate the structured params.
    val parsedBbox               = parseBBoxString(bbox)
    val parsedStartDate          = parseDateTimeParam(startDate, "startDate")
    val parsedEndDate            = parseDateTimeParam(endDate, "endDate")
    val parsedValidationStatuses = parseValidationStatuses(validationStatus)
    val parsedLabelTypes         = parseAllowlistedList(labelType, LabelTypeEnum.validLabelTypes, "labelType")
    val parsedTags               = parseTagsParam(tags)
    val parsedSeverity           = parseSeverityParam(severity, minSeverity, maxSeverity)

    // Collect the first invalid-parameter error, if any.
    val firstError: Option[ApiError] = Seq(
      validateBBoxParam(bbox, parsedBbox),
      parsedLabelTypes.left.toOption,
      parsedTags.left.toOption,
      parsedSeverity.left.toOption,
      parsedValidationStatuses.left.toOption,
      parsedStartDate.left.toOption,
      parsedEndDate.left.toOption,
      validateRegionId(regionId)
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None        =>
        configService.getCityMapParams.flatMap { cityMapParams =>
          val (finalBbox, finalRegionId, finalRegionName) =
            resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)

          // Create filters object.
          val filters = RawLabelFiltersForApi(
            bbox = finalBbox, labelTypes = parsedLabelTypes.toOption.flatten, tags = parsedTags.toOption.flatten,
            severity = parsedSeverity.toOption.flatten, minSeverity = minSeverity, maxSeverity = maxSeverity,
            validationStatuses = parsedValidationStatuses.toOption.flatten,
            highQualityUserOnly = highQualityUserOnly.getOrElse(false), startDate = parsedStartDate.toOption.flatten,
            endDate = parsedEndDate.toOption.flatten, regionId = finalRegionId, regionName = finalRegionName
          )

          // Get the data stream.
          val dbDataStream: Source[LabelDataForApi, _] = apiService.getRawLabels(filters, DEFAULT_BATCH_SIZE)
          val baseFileName: String                     = timestampedFilename("labels")

          // Output data in the appropriate file format.
          filetype match {
            case Some("csv") =>
              outputCSV(dbDataStream, LabelDataForApi.csvHeader, inline, baseFileName + ".csv")
            case Some("shapefile") =>
              outputShapefile(dbDataStream, baseFileName, shapefileCreator.createRawLabelShapefile, shapefileCreator)
            case Some("geopackage") =>
              outputGeopackage(dbDataStream, baseFileName, shapefileCreator.createRawLabelDataGeopackage, inline)
            case _ => // Default to GeoJSON.
              outputGeoJSON(dbDataStream, inline, baseFileName + ".geojson")
          }
        }
    }
  }

  /**
   * Parses the multi-valued validationStatus parameter into the corresponding enum values.
   *
   * @param raw The optional validationStatus query parameter (comma-separated public tokens).
   * @return `Right(None)` if absent, `Right(Some(statuses))` if every token is valid, or `Left(ApiError)` otherwise.
   */
  private def parseValidationStatuses(
      raw: Option[String]
  ): Either[ApiError, Option[Set[RawLabelValidationStatus.Value]]] =
    parseAllowlistedList(raw, RawLabelValidationStatus.values.map(_.toString), "validationStatus")
      .map(_.map(_.map(RawLabelValidationStatus.withName).toSet))

  /**
   * Parses and validates the severity set parameter (comma-separated over "1", "2", "3", "none").
   *
   * @param raw         The optional severity query parameter.
   * @param minSeverity The minSeverity query parameter, checked for the mutual-exclusion rule.
   * @param maxSeverity The maxSeverity query parameter, checked for the mutual-exclusion rule.
   * @return `Right(None)` if absent, `Right(Some(filter))` if valid, or `Left(ApiError)` if a token is invalid or the
   *         parameter is combined with minSeverity/maxSeverity.
   */
  private def parseSeverityParam(
      raw: Option[String],
      minSeverity: Option[Int],
      maxSeverity: Option[Int]
  ): Either[ApiError, Option[SeverityFilterForApi]] =
    if (raw.isDefined && (minSeverity.isDefined || maxSeverity.isDefined))
      Left(
        ApiError
          .invalidParameter("The severity parameter cannot be combined with minSeverity or maxSeverity.", "severity")
      )
    else
      parseAllowlistedList(raw, Set("1", "2", "3", "none"), "severity").map(_.map { tokens =>
        SeverityFilterForApi(tokens.filter(_ != "none").map(_.toInt).toSet, tokens.contains("none"))
      })

  /**
   * Parses the tags parameter, supporting optional label-type scoping (e.g. "CurbRamp:narrow").
   *
   * For each comma-separated entry, if the substring before the first colon exactly matches a label type name, the
   * entry only matches that tag on that label type; otherwise the whole entry is a tag matching any label type (tag
   * names may themselves contain colons, so an unrecognized prefix cannot be treated as an error).
   *
   * @param raw The optional tags query parameter.
   * @return `Right(None)` if absent, `Right(Some(filters))` if valid, or `Left(ApiError)` if an entry is empty or a
   *         scoped entry is missing its tag.
   */
  private def parseTagsParam(raw: Option[String]): Either[ApiError, Option[Seq[TagFilterForApi]]] =
    parseCommaSeparated(raw) match {
      case None         => Right(None)
      case Some(tokens) =>
        if (tokens.exists(_.isEmpty)) {
          Left(ApiError.invalidParameter("The tags parameter contains an empty value.", "tags"))
        } else {
          val parsed = tokens.map { token =>
            val prefix = token.takeWhile(_ != ':')
            if (token.contains(':') && LabelTypeEnum.validLabelTypes.contains(prefix))
              TagFilterForApi(Some(prefix), token.drop(prefix.length + 1).trim)
            else TagFilterForApi(None, token)
          }
          parsed.find(tagFilter => tagFilter.labelType.isDefined && tagFilter.tag.isEmpty) match {
            case Some(bad) =>
              Left(
                ApiError.invalidParameter(
                  s"Missing tag after label type '${bad.labelType.get}:' in the tags parameter.",
                  "tags"
                )
              )
            case None => Right(Some(parsed))
          }
        }
    }

  /**
   * Retrieves all panorama IDs that have labels.
   *
   * This method is an asynchronous action that fetches all panoramas with labels from the `panoDataService`. The result
   * is a JSON response containing a list of panorama IDs, where each panorama is serialized into JSON format.
   *
   * @return Asynchronous result containing an HTTP response with a JSON array of pano IDs and their associated labels.
   */
  def getAllPanoIdsWithLabels = Action.async {
    panoDataService.getAllPanos.map { panos => Ok(Json.toJson(panos.map(p => Json.toJson(p)))) }
  }
}
