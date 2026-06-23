package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, LabelClusterFiltersForApi, LabelClusterForApi, RawLabelInClusterDataForApi}
import models.utils.LatLngBBox
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.nio.file.Files
import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

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
)(implicit ec: ExecutionContext, mat: Materializer)
    extends BaseApiController(cc) {

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
   * @param minSeverity Optional minimum severity score (1-3 scale)
   * @param maxSeverity Optional maximum severity score (1-3 scale)
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
  ): Action[AnyContent] = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
    try {
      // Parse bbox parameter.
      val parsedBbox: Option[LatLngBBox] = parseBBoxString(bbox)

      // Parse and validate date filters (malformed values are reported rather than silently dropped).
      val parsedAvgImageCaptureDate = parseDateTimeParam(avgImageCaptureDate, "avgImageCaptureDate")
      val parsedAvgLabelDate        = parseDateTimeParam(avgLabelDate, "avgLabelDate")

      // Parse comma-separated lists into sequences.
      val parsedLabelTypes = labelType.map(_.split(",").map(_.trim).toSeq)

      // Collect the first invalid-parameter error, if any.
      val firstError: Option[ApiError] = Seq(
        if (bbox.isDefined && parsedBbox.isEmpty)
          Some(ApiError.invalidParameter(
            "Invalid value for bbox parameter. Expected format: minLng,minLat,maxLng,maxLat.", "bbox"))
        else None,
        if (regionId.exists(_ <= 0))
          Some(ApiError.invalidParameter("Invalid regionId value. Must be a positive integer.", "regionId"))
        else None,
        if (minSeverity.exists(s => s < 1 || s > 3))
          Some(ApiError.invalidParameter("Invalid minSeverity value. Must be between 1-3.", "minSeverity"))
        else None,
        if (maxSeverity.exists(s => s < 1 || s > 3))
          Some(ApiError.invalidParameter("Invalid maxSeverity value. Must be between 1-3.", "maxSeverity"))
        else None,
        if (clusterSize.exists(_ <= 0))
          Some(ApiError.invalidParameter("Invalid clusterSize value. Must be a positive integer.", "clusterSize"))
        else None,
        parsedAvgImageCaptureDate.left.toOption,
        parsedAvgLabelDate.left.toOption
      ).flatten.headOption

      firstError match {
        case Some(error) => Future.successful(badRequest(error))
        case None =>
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
          val finalRegionId: Option[Int] = if (bbox.isDefined && parsedBbox.isDefined) None else regionId

          val finalRegionName: Option[String] =
            if (bbox.isDefined && parsedBbox.isDefined || regionId.isDefined) None else regionName

          // Create filters object.
          val filters = LabelClusterFiltersForApi(
            bbox = finalBbox, labelTypes = parsedLabelTypes, regionId = finalRegionId, regionName = finalRegionName,
            includeRawLabels = includeRawLabels.getOrElse(false), minClusterSize = clusterSize,
            minAvgImageCaptureDate = parsedAvgImageCaptureDate.toOption.flatten,
            minAvgLabelDate = parsedAvgLabelDate.toOption.flatten,
            minSeverity = minSeverity, maxSeverity = maxSeverity
          )

          try {
            // Get the data stream.
            val dbDataStream: Source[LabelClusterForApi, _] = apiService.getLabelClusters(filters, DEFAULT_BATCH_SIZE)
            val baseFileName: String                        = s"labelClusters_${OffsetDateTime.now()}"

            // Output data in the appropriate file format.
            filetype match {
              case Some("csv") if filters.includeRawLabels =>
                // When raw labels are included, create two CSVs (clusters + labels) zipped together.
                val clusterCsvPath = Files.createTempFile(baseFileName + "_clusters", ".csv")
                val labelCsvPath   = Files.createTempFile(baseFileName + "_labels", ".csv")
                val clusterWriter  = Files.newBufferedWriter(clusterCsvPath)
                val labelWriter    = Files.newBufferedWriter(labelCsvPath)

                clusterWriter.write(LabelClusterForApi.csvHeader)
                labelWriter.write(RawLabelInClusterDataForApi.csvHeader)

                dbDataStream
                  .grouped(DEFAULT_BATCH_SIZE)
                  .runForeach { batch =>
                    batch.foreach { cluster =>
                      clusterWriter.write(cluster.toCsvRow)
                      clusterWriter.write("\n")
                      cluster.labels.foreach { labelsList =>
                        labelsList.foreach { label =>
                          labelWriter.write(RawLabelInClusterDataForApi.toCsvRow(cluster.labelClusterId, label))
                          labelWriter.write("\n")
                        }
                      }
                    }
                  }
                  .flatMap { _ =>
                    clusterWriter.close()
                    labelWriter.close()
                    zipAndStreamCsvFiles(
                      Seq(
                        (clusterCsvPath, baseFileName + "_clusters.csv"),
                        (labelCsvPath, baseFileName + "_labels.csv")
                      ),
                      baseFileName
                    )
                  }
                  .recoverWith { case NonFatal(e) =>
                    // Ensure writers are closed and temp files removed if streaming or zipping failed.
                    scala.util.Try(clusterWriter.close())
                    scala.util.Try(labelWriter.close())
                    Files.deleteIfExists(clusterCsvPath)
                    Files.deleteIfExists(labelCsvPath)
                    logger.error(s"Error generating label clusters CSV: ${e.getMessage}", e)
                    Future.successful(
                      InternalServerError(
                        Json.toJson(ApiError.internalServerError(s"Error processing request: ${e.getMessage}"))
                      )
                    )
                  }
              case Some("csv") =>
                outputCSV(dbDataStream, LabelClusterForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") if filters.includeRawLabels =>
                // When raw labels are included, create both clusters and labels shapefiles in the ZIP.
                shapefileCreator
                  .createLabelClusterShapefileWithLabels(dbDataStream, baseFileName, DEFAULT_BATCH_SIZE)
                  .map {
                    case Some(p) =>
                      val zipSrc: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefile(p, baseFileName)
                      Ok.chunked(zipSrc)
                        .as("application/zip")
                        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
                    case None =>
                      InternalServerError("Failed to create shapefile")
                  }
              case Some("shapefile") =>
                outputShapefile(
                  dbDataStream,
                  baseFileName,
                  shapefileCreator.createLabelClusterShapefile,
                  shapefileCreator
                )
              case Some("geopackage") =>
                outputGeopackage(dbDataStream, baseFileName, shapefileCreator.createLabelClusterGeopackage, inline)
              case _ => // Default to GeoJSON.
                outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
            }
          } catch {
            case e: Exception =>
              logger.error(s"Error processing request: ${e.getMessage}", e)
              Future.successful(
                InternalServerError(
                  Json.toJson(
                    ApiError.internalServerError(s"Error processing request: ${e.getMessage}")
                  )
                )
              )
          }
        }
      }
    } catch {
      case e: Exception =>
        logger.error(s"Unexpected error in getLabelClusters: ${e.getMessage}", e)
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
