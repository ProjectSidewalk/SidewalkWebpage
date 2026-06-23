package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import formats.json.ApiFormats._
import models.api.{ApiError, RegionDataForApi, RegionFiltersForApi}
import models.utils.LatLngBBox
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

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
    // Parse the bbox parameter.
    val parsedBbox: Option[LatLngBBox] = parseBBoxString(bbox)

    // Handle input parameter error cases.
    if (bbox.isDefined && parsedBbox.isEmpty) {
      Future.successful(
        BadRequest(
          Json.toJson(
            ApiError.invalidParameter(
              "Invalid value for bbox parameter. Expected format: minLng,minLat,maxLng,maxLat.",
              "bbox"
            )
          )
        )
      )
    } else if (regionId.isDefined && regionId.get <= 0) {
      Future.successful(
        BadRequest(
          Json.toJson(
            ApiError.invalidParameter("Invalid regionId value. Must be a positive integer.", "regionId")
          )
        )
      )
    } else {
      configService.getCityMapParams.flatMap { cityMapParams =>
        // If bbox isn't provided, use city defaults.
        val apiBox: LatLngBBox = parsedBbox.getOrElse(
          LatLngBBox(
            minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
            minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
            maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
            maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
          )
        )

        // Apply filter precedence logic. If bbox is defined, it takes precedence over region filters.
        val finalBbox: Option[LatLngBBox] = if (bbox.isDefined && parsedBbox.isDefined) {
          parsedBbox
        } else if (regionId.isDefined || regionName.isDefined) {
          None // If region filters are used, bbox should be None.
        } else {
          Some(apiBox) // Default city bbox.
        }

        // If bbox is defined, ignore region filters; regionId takes precedence over regionName.
        val finalRegionId = if (bbox.isDefined && parsedBbox.isDefined) None else regionId
        val finalRegionName =
          if (bbox.isDefined && parsedBbox.isDefined || regionId.isDefined) None else regionName

        // Create filters object.
        val filters = RegionFiltersForApi(
          bbox = finalBbox, regionId = finalRegionId, regionName = finalRegionName, minLabelCount = minLabelCount
        )

        // Get the data stream.
        val dbDataStream: Source[RegionDataForApi, _] = apiService.getRegions(filters, DEFAULT_BATCH_SIZE)
        val baseFileName: String                      = s"regions_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format.
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
        NotFound(Json.obj("status" -> "NOT_FOUND", "message" -> "No region found with labels"))
    }
  }
}
