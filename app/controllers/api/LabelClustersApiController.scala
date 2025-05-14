package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
import models.utils.SpatialQueryType
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.LatLngBBox
import models.utils.MapParams
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import play.api.i18n.Lang.logger
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

  // TODO: 
  // For v3
  // Change attribute_id to label_cluster_id
  // Change neighborhood to region
  // Add region_id

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
