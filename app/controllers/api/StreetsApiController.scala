package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, StreetDataForApi, StreetFiltersForApi}
import models.street.StreetEdgeStatus
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for the Streets API endpoints.
 */
@Singleton
class StreetsApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService,
    configService: ConfigService,
    shapefileCreator: ShapefilesCreatorHelper
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * Gets streets data with filters applied.
   *
   * @param bbox Bounding box in format "minLng,minLat,maxLng,maxLat"
   * @param regionId Optional region ID to filter streets by geographic region
   * @param regionName Optional region name to filter streets by geographic region
   * @param minLabelCount Optional minimum number of labels on the street
   * @param minAuditCount Optional minimum number of audits for the street
   * @param minUserCount Optional minimum number of users who audited the street
   * @param wayType Comma-separated list of way types to include (e.g., "residential,primary")
   * @param status Comma-separated list of street statuses to include (e.g., "open,no_imagery,disabled")
   * @param filetype Output format: "geojson" (default), "csv", "shapefile"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getStreets(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      minLabelCount: Option[Int],
      minAuditCount: Option[Int],
      minUserCount: Option[Int],
      wayType: Option[String],
      status: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    // Parse bbox, way types, and statuses. Statuses are lowercased to match the enum's string values.
    val parsedBbox     = parseBBoxString(bbox)
    val parsedWayTypes = parseCommaSeparated(wayType)
    val parsedStatuses = parseCommaSeparated(status).map(_.map(_.toLowerCase))

    // Collect the first invalid-parameter error, if any.
    val firstError: Option[ApiError] = Seq(
      validateBBoxParam(bbox, parsedBbox),
      validateRegionId(regionId),
      validateStreetStatuses(parsedStatuses)
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None =>
        configService.getCityMapParams.flatMap { cityMapParams =>
        val (finalBbox, finalRegionId, finalRegionName) = resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)

        // Create filters object.
        val filters = StreetFiltersForApi(
          bbox = finalBbox, regionId = finalRegionId, regionName = finalRegionName, minLabelCount = minLabelCount,
          minAuditCount = minAuditCount, minUserCount = minUserCount, wayTypes = parsedWayTypes,
          statuses = parsedStatuses
        )

        // Get the data stream.
        val dbDataStream: Source[StreetDataForApi, _] = apiService.getStreets(filters, DEFAULT_BATCH_SIZE)
        val baseFileName: String                      = s"streets_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format.
        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, StreetDataForApi.csvHeader, inline, baseFileName + ".csv")
          case Some("shapefile") =>
            outputShapefile(dbDataStream, baseFileName, shapefileCreator.createStreetDataShapefile, shapefileCreator)
          case Some("geopackage") =>
            outputGeopackage(dbDataStream, baseFileName, shapefileCreator.createStreetDataGeopackage, inline)
          case _ => // Default to GeoJSON.
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
        }
      }
    }
  }

  /**
   * Returns an ApiError if any supplied status value is not a recognized `street_edge_status` (open, no_imagery,
   * closed, disabled). Returns None when the parameter was absent or every value is valid.
   *
   * @param parsedStatuses The parsed, lowercased status tokens, or None if the parameter was absent.
   * @return `Some(ApiError)` naming the invalid value(s), else `None`.
   */
  private def validateStreetStatuses(parsedStatuses: Option[Seq[String]]): Option[ApiError] =
    parsedStatuses.flatMap { statuses =>
      val invalid = statuses.filter(StreetEdgeStatus.fromString(_).isEmpty)
      if (invalid.nonEmpty) {
        val valid = StreetEdgeStatus.values.map(_.toString).mkString(", ")
        Some(ApiError.invalidParameter(s"Invalid status value(s): ${invalid.mkString(", ")}. Valid values: $valid.",
          "status"))
      } else None
    }

  /**
   * Returns a list of all street types with counts.
   *
   * This endpoint provides information about available street types (way types) in the database, including their names,
   * descriptions, and the count of streets for each type.
   *
   * @return JSON response containing street type information
   */
  def getStreetTypes = silhouette.UserAwareAction.async { implicit request =>
    apiService
      .getStreetTypes(request.lang)
      .map { types =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        Ok(Json.obj("status" -> "OK", "street_types" -> types))
      }
      .recover { case e: Exception =>
        ApiError.toResult(ApiError.internalServerError(s"Failed to retrieve street types: ${e.getMessage}"))
      }
  }
}
