package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, LabelClusterFiltersForApi, LabelClusterForApi}
import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
import models.utils.{LatLngBBox, SpatialQueryType}
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.nio.file.Path
import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.math._

/**
 * Controller for handling API requests related to label clusters.
 *
 * This controller provides endpoints for retrieving label clusters within specified geographic regions or bounding
 * boxes. The data can be returned in various formats such as GeoJSON, CSV, or Shapefiles.
 *
 * @constructor Creates a new instance of the LabelClustersApiController.
 * @param cc Custom controller components for dependency injection.
 * @param silhouette Silhouette authentication environment.
 * @param apiService Service for handling API-related operations.
 * @param configService Service for retrieving configuration parameters.
 * @param shapefileCreator Helper for creating shapefiles.
 * @param ec Execution context for handling asynchronous operations.
 */
@Singleton
class LabelClustersApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService,
    configService: ConfigService,
    shapefileCreator: ShapefilesCreatorHelper
)(implicit ec: ExecutionContext) extends BaseApiController(cc) {

  /**
   * v3 API: Returns label clusters (aggregated labels) according to specified filters.
   *
   * @param bbox Bounding box in format "minLng,minLat,maxLng,maxLat"
   * @param labelType Comma-separated list of label types to include
   * @param regionId Optional region ID to filter by geographic region
   * @param regionName Optional region name to filter by geographic region
   * @param includeRawLabels Whether to include raw label data within each cluster
   * @param clusterSize Optional filter for minimum cluster size
   * @param avgImageCaptureDate Optional filter for average image capture date (ISO 8601)
   * @param avgLabelDate Optional filter for average label date (ISO 8601)
   * @param minSeverity Optional minimum severity score (1-5 scale)
   * @param maxSeverity Optional maximum severity score (1-5 scale)
   * @param filetype Output format: "geojson" (default), "csv", "shapefile"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getLabelClustersV3(
      bbox: Option[String],
      labelType: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      includeRawLabels: Option[Boolean],
      clusterSize: Option[Int],
      avgImageCaptureDate: Option[String],
      avgLabelDate: Option[String],
      minSeverity: Option[Int],
      maxSeverity: Option[Int],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
    try {
      // Parse bbox parameter.
      val parsedBbox: Option[LatLngBBox] = parseBBoxString(bbox)

      // Parse date strings to OffsetDateTime if provided.
      val parsedAvgImageCaptureDate: Option[OffsetDateTime] = parseDateTimeString(avgImageCaptureDate)
      val parsedAvgLabelDate: Option[OffsetDateTime] = parseDateTimeString(avgLabelDate)

      // Parse comma-separated lists into sequences.
      val parsedLabelTypes = labelType.map(_.split(",").map(_.trim).toSeq)

      // Handle invalid param error cases.
      if (bbox.isDefined && parsedBbox.isEmpty) {
        Future.successful(BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid value for bbox parameter. Expected format: minLng,minLat,maxLng,maxLat.", "bbox"
        ))))
      } else if (regionId.isDefined && regionId.get <= 0) {
        Future.successful(BadRequest(Json.toJson(
          ApiError.invalidParameter("Invalid regionId value. Must be a positive integer.", "regionId")
        )))
      } else if (
        minSeverity.isDefined && (minSeverity.get < 1 || minSeverity.get > 5)
      ) {
        Future.successful(BadRequest(Json.toJson(
          ApiError.invalidParameter("Invalid minSeverity value. Must be between 1-5.", "minSeverity")
        )))
      } else if (
        maxSeverity.isDefined && (maxSeverity.get < 1 || maxSeverity.get > 5)
      ) {
        Future.successful(BadRequest(Json.toJson(
          ApiError.invalidParameter("Invalid maxSeverity value. Must be between 1-5.", "maxSeverity")
        )))
      } else if (clusterSize.isDefined && clusterSize.get <= 0) {
        Future.successful(BadRequest(Json.toJson(
          ApiError.invalidParameter("Invalid clusterSize value. Must be a positive integer.", "clusterSize")
        )))
      } else {
        configService.getCityMapParams.flatMap { cityMapParams =>
          // If bbox isn't provided, use city defaults.
          val apiBox: LatLngBBox = parsedBbox.getOrElse {
            logger.info("Using default city bounding box")
            LatLngBBox(
              minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
              minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
              maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
              maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
            )
          }

          // Apply filter precedence logic.
          // If bbox is defined, it takes precedence over region filters.
          val finalBbox = if (bbox.isDefined && parsedBbox.isDefined) {
            parsedBbox
          } else if (regionId.isDefined || regionName.isDefined) {
            None // If region filters are used, bbox should be None.
          } else {
            Some(apiBox) // Default city bbox.
          }

          // Apply region filter precedence logic.
          // If bbox is defined, ignore region filters. If regionId is defined, it takes precedence over regionName.
          val finalRegionId: Option[Int] = if (bbox.isDefined && parsedBbox.isDefined) {
            None
          } else {
            regionId
          }

          val finalRegionName: Option[String] =
            if (bbox.isDefined && parsedBbox.isDefined || regionId.isDefined) {
              None
            } else {
              regionName
            }

          // Create filters object.
          val filters = LabelClusterFiltersForApi(
            bbox = finalBbox,
            labelTypes = parsedLabelTypes,
            regionId = finalRegionId,
            regionName = finalRegionName,
            includeRawLabels = includeRawLabels.getOrElse(false),
            minClusterSize = clusterSize,
            minAvgImageCaptureDate = parsedAvgImageCaptureDate,
            minAvgLabelDate = parsedAvgLabelDate,
            minSeverity = minSeverity,
            maxSeverity = maxSeverity
          )

          try {
            // Get the data stream.
            val dbDataStream: Source[LabelClusterForApi, _] = apiService.getLabelClusters(filters, DEFAULT_BATCH_SIZE)
            val baseFileName: String = s"labelClusters_${OffsetDateTime.now()}"

            // Output data in the appropriate file format.
            filetype match {
              case Some("csv") =>
                outputCSV(dbDataStream, LabelClusterForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") =>
                outputShapefile(
                  dbDataStream, baseFileName, shapefileCreator.createLabelClusterShapefile, shapefileCreator
                )
               case Some("geopackage") =>
                  outputGeopackage(dbDataStream, baseFileName, shapefileCreator.createLabelClusterGeopackage, inline)
              case _ => // Default to GeoJSON.
                outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
            }
          } catch {
            case e: Exception =>
              logger.error(s"Error processing request: ${e.getMessage}", e)
              Future.successful(InternalServerError(Json.toJson(
                ApiError.internalServerError(s"Error processing request: ${e.getMessage}")
              )))
          }
        }
      }
    } catch {
      case e: Exception =>
        logger.error(s"Unexpected error in getLabelClusters: ${e.getMessage}", e)
        Future.successful(InternalServerError(Json.toJson(
            ApiError.internalServerError(s"Unexpected error: ${e.getMessage}")
        )))
    }
  }

  /**
   * Returns all global attributes within the given bounding box and the labels that make up those attributes.
   *
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param severity Optional severity level to filter by
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getAccessAttributesWithLabelsV2(
      lat1: Option[Double],
      lng1: Option[Double],
      lat2: Option[Double],
      lng2: Option[Double],
      severity: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

    configService.getCityMapParams.flatMap { cityMapParams =>
      val bbox: LatLngBBox = LatLngBBox(
        minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
        maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
      )

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeWithLabelForApi, _] =
        apiService.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, DEFAULT_BATCH_SIZE)
      val timeStr: String = OffsetDateTime.now().toString
      val baseFileName: String = s"attributesWithLabels_$timeStr"

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, GlobalAttributeWithLabelForApi.csvHeader, inline, baseFileName + ".csv")

        case Some("shapefile") =>
          // We aren't using the same shapefile output method as we do for other APIs because we are creating two
          // separate shapefiles and zipping them together.

          // Get a separate attributes data stream as well for Shapefiles.
          val attributesDataStream: Source[GlobalAttributeForApi, _] =
            apiService.getAttributesInBoundingBox(SpatialQueryType.LabelCluster, bbox, severity, DEFAULT_BATCH_SIZE)

          val futureResults: Future[(Path, Path)] = Future
            .sequence(
              Seq(
                shapefileCreator
                  .createAttributeShapefile(attributesDataStream, s"attributes_$timeStr", DEFAULT_BATCH_SIZE)
                  .map(_.get),
                shapefileCreator.createLabelShapefile(dbDataStream, s"labels_$timeStr", DEFAULT_BATCH_SIZE)
                  .map(_.get)
              )
            )
            .recover { case e: Exception =>
              logger.error("Error creating shapefiles", e)
              throw e
            }
            .map { paths => (paths(0), paths(1)) } // Put them into a tuple.

          // Once both sets of files have been created, zip them together and stream the result.
          futureResults
            .map { case (attributePath, labelPath) =>
              val zipSource: Source[ByteString, Future[Boolean]] =
                shapefileCreator.zipShapefile(Seq(attributePath, labelPath), baseFileName)

              Ok.chunked(zipSource)
                .as("application/zip")
                .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
            }
            .recover { case e: Exception =>
              logger.error("Error in shapefile creation process", e)
              InternalServerError("Failed to create shapefiles")
            }

        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }

  /**
   * Returns all the global attributes within the bounding box in given file format.
   *
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param severity Optional severity level to filter by.
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getAccessAttributesV2(
      lat1: Option[Double],
      lng1: Option[Double],
      lat2: Option[Double],
      lng2: Option[Double],
      severity: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

    configService.getCityMapParams.flatMap { cityMapParams =>
      val bbox: LatLngBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val baseFileName: String = s"attributes_${OffsetDateTime.now()}"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeForApi, _] =
        apiService.getAttributesInBoundingBox(SpatialQueryType.LabelCluster, bbox, severity, DEFAULT_BATCH_SIZE)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, GlobalAttributeForApi.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createAttributeShapefile, shapefileCreator)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }
}
