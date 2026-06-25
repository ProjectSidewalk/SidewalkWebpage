package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import formats.json.ApiFormats._
import models.api.{ApiError, RegionDataForApi, RegionFiltersForApi}
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for the Regions API endpoints.
 *
 * Provides access to neighborhood/region data for Project Sidewalk deployments, including
 * label counts, audit coverage, and geographic boundaries. Supports GeoJSON, CSV, shapefile,
 * and GeoPackage output formats.
 *
 * @param cc              Custom controller components for dependency injection.
 * @param silhouette      Silhouette authentication environment.
 * @param apiService      Service for API-related data access.
 * @param configService   Service for retrieving city configuration parameters.
 * @param shapefileCreator Helper for creating shapefile exports.
 * @param ec              Execution context for async operations.
 */
@Singleton
class RegionApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService,
    configService: ConfigService,
    shapefileCreator: ShapefilesCreatorHelper
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * Gets regions (neighborhoods) with filters applied.
   *
   * @param bbox Bounding box in format "minLng,minLat,maxLng,maxLat"
   * @param regionId Optional region ID to filter for a single region
   * @param regionName Optional region name to filter for a single region
   * @param minLabelCount Optional minimum number of labels within the region
   * @param filetype Output format: "geojson" (default), "csv", "shapefile", "geopackage"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getRegions(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      minLabelCount: Option[Int],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    val parsedBbox = parseBBoxString(bbox)

    // Collect the first invalid-parameter error, if any.
    val firstError: Option[ApiError] = Seq(
      validateBBoxParam(bbox, parsedBbox),
      validateRegionId(regionId)
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None =>
        configService.getCityMapParams.flatMap { cityMapParams =>
        val (finalBbox, finalRegionId, finalRegionName) = resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)

        val filters = RegionFiltersForApi(
          bbox = finalBbox, regionId = finalRegionId, regionName = finalRegionName, minLabelCount = minLabelCount
        )

        val dbDataStream: Source[RegionDataForApi, _] = apiService.getRegions(filters, DEFAULT_BATCH_SIZE)
        val baseFileName: String                      = s"regions_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, RegionDataForApi.csvHeader, inline, baseFileName + ".csv")
          case Some("shapefile") =>
            outputShapefile(dbDataStream, baseFileName, shapefileCreator.createRegionDataShapefile, shapefileCreator)
          case Some("geopackage") =>
            outputGeopackage(dbDataStream, baseFileName, shapefileCreator.createRegionDataGeopackage, inline)
          case _ => // Default to GeoJSON.
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
        }
      }
    }
  }

  /**
   * Returns the region with the highest number of labels.
   *
   * @return A JSON response with the region data or a 404 if no region is found
   */
  def getRegionWithMostLabels = silhouette.UserAwareAction.async { implicit request =>
    apiService.getRegionWithMostLabels.map {
      case Some(region) =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        Ok(Json.toJson(region))
      case None =>
        NotFound(Json.toJson(ApiError.notFound("No region found with labels")))
    }
  }
}
