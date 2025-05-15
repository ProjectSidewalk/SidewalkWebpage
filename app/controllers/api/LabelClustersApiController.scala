package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, LabelClusterForApi, LabelClusterFilters}
import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
import models.utils.SpatialQueryType
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.LatLngBBox
import models.utils.MapParams
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import java.time.OffsetDateTime

import java.nio.file.Path
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.math._

import org.apache.pekko.util.ByteString

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
   * @param label_type Comma-separated list of label types to include
   * @param region_id Optional region ID to filter by geographic region
   * @param region_name Optional region name to filter by geographic region
   * @param include_raw_labels Whether to include raw label data within each cluster
   * @param cluster_size Optional filter for minimum cluster size
   * @param avg_image_capture_date Optional filter for average image capture date (ISO 8601)
   * @param avg_label_date Optional filter for average label date (ISO 8601)
   * @param min_severity Optional minimum severity score (1-5 scale)
   * @param max_severity Optional maximum severity score (1-5 scale)
   * @param filetype Output format: "geojson" (default), "csv", "shapefile"
   * @param inline Whether to display the file inline or as an attachment
   */
  def getLabelClustersV3(
      bbox: Option[String],
      label_type: Option[String],
      region_id: Option[Int],
      region_name: Option[String],
      include_raw_labels: Option[Boolean],
      cluster_size: Option[Int],
      avg_image_capture_date: Option[String],
      avg_label_date: Option[String],
      min_severity: Option[Int],
      max_severity: Option[Int],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    try {
      logger.info(s"getLabelClustersV3 called with parameters: " +
        s"bbox=$bbox, label_type=$label_type, region_id=$region_id, region_name=$region_name, " +
        s"include_raw_labels=$include_raw_labels, cluster_size=$cluster_size, " +
        s"avg_image_capture_date=$avg_image_capture_date, avg_label_date=$avg_label_date, " +
        s"min_severity=$min_severity, max_severity=$max_severity, filetype=$filetype, inline=$inline")
        
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
              logger.warn(s"Invalid bbox format: $b. Expected: minLng,minLat,maxLng,maxLat")
              None
            }
          } catch {
            case e: Exception => 
              logger.warn(s"Error parsing bbox: ${e.getMessage}")
              None
          }
        }
        
        // If bbox isn't provided, use city defaults
        val apiBox = parsedBbox.getOrElse {
          logger.info("Using default city bounding box")
          LatLngBBox(
            minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
            minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
            maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
            maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
          )
        }
        
        // Parse date strings to OffsetDateTime if provided
        val parsedAvgImageCaptureDate = avg_image_capture_date.flatMap { s =>
          try {
            Some(OffsetDateTime.parse(s))
          } catch {
            case e: Exception => 
              logger.warn(s"Error parsing avg_image_capture_date: ${e.getMessage}")
              None
          }
        }
        
        val parsedAvgLabelDate = avg_label_date.flatMap { e =>
          try {
            Some(OffsetDateTime.parse(e))
          } catch {
            case e: Exception => 
              logger.warn(s"Error parsing avg_label_date: ${e.getMessage}")
              None
          }
        }
        
        // Parse comma-separated lists into sequences
        val parsedLabelTypes = label_type.map(_.split(",").map(_.trim).toSeq)
        
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
        val filters = LabelClusterFilters(
          bbox = finalBbox,
          labelTypes = parsedLabelTypes,
          regionId = finalRegionId,
          regionName = finalRegionName,
          includeRawLabels = include_raw_labels.getOrElse(false),
          minClusterSize = cluster_size,
          minAvgImageCaptureDate = parsedAvgImageCaptureDate,
          minAvgLabelDate = parsedAvgLabelDate,
          minSeverity = min_severity,
          maxSeverity = max_severity
        )
        
        logger.info(s"Applying filters: $filters")
        
        val baseFileName: String = s"labelClusters_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
        
        // Handle error cases
        if (bbox.isDefined && parsedBbox.isEmpty) {
          BadRequest(Json.toJson(ApiError.invalidParameter(
            "Invalid value for bbox parameter. Expected format: minLng,minLat,maxLng,maxLat.", "bbox")))
        } else if (region_id.isDefined && region_id.get <= 0) {
          BadRequest(Json.toJson(ApiError.invalidParameter(
            "Invalid region_id value. Must be a positive integer.", "region_id")))
        } else if (min_severity.isDefined && (min_severity.get < 1 || min_severity.get > 5)) {
          BadRequest(Json.toJson(ApiError.invalidParameter(
            "Invalid min_severity value. Must be between 1-5.", "min_severity")))
        } else if (max_severity.isDefined && (max_severity.get < 1 || max_severity.get > 5)) {
          BadRequest(Json.toJson(ApiError.invalidParameter(
            "Invalid max_severity value. Must be between 1-5.", "max_severity")))
        } else if (cluster_size.isDefined && cluster_size.get <= 0) {
          BadRequest(Json.toJson(ApiError.invalidParameter(
            "Invalid cluster_size value. Must be a positive integer.", "cluster_size")))
        } else {
          try {
            // Get the data stream
            val dbDataStream = apiService.getLabelClustersV3(filters, DEFAULT_BATCH_SIZE)
            
            // Log when a stream is created
            logger.info(s"Created data stream with filetype: ${filetype.getOrElse("geojson")}")
            
            // Output data in the appropriate file format
            filetype match {
              case Some("csv") =>
                outputCSV(dbDataStream, LabelClusterForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") =>
                outputShapefile(dbDataStream, baseFileName, shapefileCreator.createLabelClusterShapeFile, shapefileCreator)
              case _ => // Default to GeoJSON
                outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
            }
          } catch {
            case e: Exception =>
              logger.error(s"Error processing request: ${e.getMessage}", e)
              InternalServerError(Json.toJson(ApiError.internalServerError(
                s"Error processing request: ${e.getMessage}")))
          }
        }
      }
    } catch {
      case e: Exception =>
        logger.error(s"Unexpected error in getLabelClustersV3: ${e.getMessage}", e)
        Future.successful(
          InternalServerError(Json.toJson(ApiError.internalServerError(
            s"Unexpected error: ${e.getMessage}")))
        )
    }
  }

  /**
   * Returns all global attributes within the given bounding box and the labels that make up those attributes.
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
    configService.getCityMapParams.flatMap { cityMapParams =>
      val bbox: LatLngBBox = LatLngBBox(
        minLat = min(
          lat1.getOrElse(cityMapParams.lat1),
          lat2.getOrElse(cityMapParams.lat2)
        ),
        minLng = min(
          lng1.getOrElse(cityMapParams.lng1),
          lng2.getOrElse(cityMapParams.lng2)
        ),
        maxLat = max(
          lat1.getOrElse(cityMapParams.lat1),
          lat2.getOrElse(cityMapParams.lat2)
        ),
        maxLng = max(
          lng1.getOrElse(cityMapParams.lng1),
          lng2.getOrElse(cityMapParams.lng2)
        )
      )
      val timeStr: String = OffsetDateTime.now().toString
      val baseFileName: String = s"attributesWithLabels_$timeStr"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeWithLabelForApi, _] =
        apiService.getGlobalAttributesWithLabelsInBoundingBox(
          bbox,
          severity,
          DEFAULT_BATCH_SIZE
        )
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.remoteAddress,
        request.toString
      )

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          Future.successful(
            outputCSV(
              dbDataStream,
              GlobalAttributeWithLabelForApi.csvHeader,
              inline,
              baseFileName + ".csv"
            )
          )

        case Some("shapefile") =>
          // We aren't using the same shapefile output method as we do for other APIs because we are creating two
          // separate shapefiles and zipping them together.

          // Get a separate attributes data stream as well for Shapefiles.
          val attributesDataStream: Source[GlobalAttributeForApi, _] =
            apiService.getAttributesInBoundingBox(
              SpatialQueryType.LabelCluster,
              bbox,
              severity,
              DEFAULT_BATCH_SIZE
            )

          val futureResults: Future[(Path, Path)] = Future
            .sequence(
              Seq(
                Future {
                  shapefileCreator
                    .createAttributeShapeFile(
                      attributesDataStream,
                      s"attributes_$timeStr",
                      DEFAULT_BATCH_SIZE
                    )
                    .get
                },
                Future {
                  shapefileCreator
                    .createLabelShapeFile(
                      dbDataStream,
                      s"labels_$timeStr",
                      DEFAULT_BATCH_SIZE
                    )
                    .get
                }
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
                shapefileCreator.zipShapefiles(
                  Seq(attributePath, labelPath),
                  baseFileName
                )

              Ok.chunked(zipSource)
                .as("application/zip")
                .withHeaders(
                  CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip"
                )
            }
            .recover { case e: Exception =>
              logger.error("Error in shapefile creation process", e)
              InternalServerError("Failed to create shapefiles")
            }

        case _ =>
          Future.successful(
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
          )
      }
    }
  }

  /**
   * Returns all the global attributes within the bounding box in given file format.
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
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      val bbox: LatLngBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val baseFileName: String = s"attributes_${OffsetDateTime.now()}"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeForApi, _] =
        apiService.getAttributesInBoundingBox(
          SpatialQueryType.LabelCluster,
          bbox,
          severity,
          DEFAULT_BATCH_SIZE
        )
      cc.loggingService.insert(
        request.identity.map(_.userId),
        request.remoteAddress,
        request.toString
      )

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(
            dbDataStream,
            GlobalAttributeForApi.csvHeader,
            inline,
            baseFileName + ".csv"
          )
        case Some("shapefile") =>
          outputShapefile(
            dbDataStream,
            baseFileName,
            shapefileCreator.createAttributeShapeFile,
            shapefileCreator
          )
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }
}
