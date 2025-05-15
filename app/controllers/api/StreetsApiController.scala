package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, StreetDataForApi, StreetFiltersForApi}
import models.utils.{LatLngBBox, MapParams}
import models.utils.SpatialQueryType
import models.computation.StreamingApiType

import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Source, FileIO}
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import java.time.OffsetDateTime
import play.api.mvc.Result

/**
 * Controller for the Streets API endpoints
 */
@Singleton
class StreetsApiController @Inject()(
  cc: CustomControllerComponents,
  val silhouette: Silhouette[models.auth.DefaultEnv],
  apiService: ApiService,
  configService: ConfigService,
  shapefileCreator: ShapefilesCreatorHelper
)(implicit ec: ExecutionContext, mat: Materializer) extends BaseApiController(cc) {

  /**
   * Gets streets data with filters applied.
   *
   * @param bbox Bounding box in format "minLon,minLat,maxLon,maxLat"
   * @param region_id Optional region ID to filter streets by geographic region
   * @param region_name Optional region name to filter streets by geographic region
   * @param min_label_count Optional minimum number of labels on the street
   * @param min_audit_count Optional minimum number of audits for the street
   * @param min_user_count Optional minimum number of users who audited the street
   * @param way_type Comma-separated list of way types to include (e.g., "residential,primary")
   * @param filetype Output format: "geojson" (default), "csv", "shapefile"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getStreets(
    bbox: Option[String],
    region_id: Option[Int],
    region_name: Option[String],
    min_label_count: Option[Int],
    min_audit_count: Option[Int],
    min_user_count: Option[Int],
    way_type: Option[String],
    filetype: Option[String],
    inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Parse bbox parameter
      val parsedBbox: Option[LatLngBBox] = bbox.flatMap { b =>
        try {
          val parts = b.split(",").map(_.trim.toDouble)
          if (parts.length == 4) {
            Some(LatLngBBox(
              minLng = parts(0),
              minLat = parts(1),
              maxLng = parts(2),
              maxLat = parts(3)
            ))
          } else {
            None
          }
        } catch {
          case _: Exception => None
        }
      }
      
      // If bbox isn't provided, use city defaults
      val apiBox = parsedBbox.getOrElse(
        LatLngBBox(
          minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
          minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
          maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
          maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
        )
      )
      
      // Parse way types (comma-separated)
      val parsedWayTypes = way_type.map(_.split(",").map(_.trim).toSeq)
      
      // Apply filter precedence logic
      // If bbox is defined, it takes precedence over region filters
      val finalBbox = if (bbox.isDefined && parsedBbox.isDefined) {
        parsedBbox
      } else if (region_id.isDefined || region_name.isDefined) {
        // If region filters are used, bbox should be None
        None
      } else {
        // Default city bbox
        Some(apiBox)
      }
      
      // Apply region filter precedence logic
      // If bbox is defined, ignore region filters
      // If region_id is defined, it takes precedence over region_name
      val finalRegionId = if (bbox.isDefined && parsedBbox.isDefined) {
        None
      } else {
        region_id
      }
      
      val finalRegionName = if (bbox.isDefined && parsedBbox.isDefined || region_id.isDefined) {
        None
      } else {
        region_name
      }
      
      // Create filters object
      val filters = StreetFiltersForApi(
        bbox = finalBbox,
        regionId = finalRegionId,
        regionName = finalRegionName,
        minLabelCount = min_label_count,
        minAuditCount = min_audit_count,
        minUserCount = min_user_count,
        wayTypes = parsedWayTypes
      )
      
      // Get the data stream
      val dbDataStream: Source[StreetDataForApi, _] = apiService.getStreets(filters, DEFAULT_BATCH_SIZE)
      val baseFileName: String = s"streets_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Handle error cases
      if (bbox.isDefined && parsedBbox.isEmpty) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid value for bbox parameter. Expected format: minLon,minLat,maxLon,maxLat.", "bbox")))
      } else if (region_id.isDefined && region_id.get <= 0) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid region_id value. Must be a positive integer.", "region_id")))
      } else {
        // Output data in the appropriate file format
        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, StreetDataForApi.csvHeader, inline, baseFileName + ".csv")
          case Some("shapefile") =>
            outputShapefile(dbDataStream, baseFileName, shapefileCreator.createStreetDataShapeFile, shapefileCreator)
          case Some("geopackage") =>
            outputStreetGeopackage(dbDataStream, baseFileName, shapefileCreator)
          case _ => // Default to GeoJSON
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
        }
      }
    }
  }

  /**
   * Outputs a GeoPackage file from a stream of database data and serves it as a downloadable file.
   *
   * @param dbDataStream A source stream of data of type `A` that extends `StreamingApiType`.
   * @param baseFileName The base name of the file to be created (without extension).
   * @param shapefileCreator An instance of `ShapefilesCreatorHelper` used to create the GeoPackage file.
   * @tparam A The type of data in the stream, which must extend `StreamingApiType`.
   * @return A `Result` containing the GeoPackage file as a downloadable response, or an error response if the file creation fails.
   */
  protected def outputStreetGeopackage[A <: StreamingApiType](
    dbDataStream: Source[A, _],
    baseFileName: String,
    shapefileCreator: ShapefilesCreatorHelper
  ): Result = {
  // Cast to the correct type when creating the GeoPackage
  shapefileCreator
    .createStreetDataGeopackage(
      dbDataStream.asInstanceOf[Source[StreetDataForApi, _]],
      baseFileName,
      DEFAULT_BATCH_SIZE
    )
    .map { path =>
      val fileSource = FileIO.fromPath(path)
      Ok.chunked(fileSource)
        .as("application/geopackage+sqlite3")
        .withHeaders(
          CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.gpkg"
        )
    }
    .getOrElse {
      InternalServerError("Failed to create GeoPackage file")
    }
  }
}