package controllers.api

import controllers.base.{CustomBaseController, CustomControllerComponents}
import controllers.helper.ShapefilesCreatorHelper
import models.api.ApiError
import models.computation.StreamingApiType
import models.utils.{LatLngBBox, MapParams}
import org.apache.pekko.stream.scaladsl.{Source, StreamConverters}
import org.apache.pekko.util.ByteString
import play.api.Logger
import play.api.http.ContentTypes
import play.api.libs.json.Json
import play.api.mvc.Result

import java.io.BufferedInputStream
import java.nio.file.{Files, Path}
import java.time.OffsetDateTime
import scala.concurrent.{ExecutionContext, Future}
import scala.math._

/**
 * Base controller for API endpoints with common utility methods.
 */
abstract class BaseApiController(cc: CustomControllerComponents)(implicit ec: ExecutionContext)
  extends CustomBaseController(cc) {

  private val logger = Logger("application")
  protected val DEFAULT_BATCH_SIZE: Int = 20000

  /**
   * Creates a bounding box (BBox) using the provided latitude and longitude values.
   * If any of the values are not provided, it uses the default values from the MapParams.
   *
   * @param lat1 An optional value representing the first latitude coordinate.
   * @param lng1 An optional value representing the first longitude coordinate.
   * @param lat2 An optional value representing the second latitude coordinate.
   * @param lng2 An optional value representing the second longitude coordinate.
   * @param defaultMapParams Default map parameters containing default values for latitude and longitude.
   * @return A bounding box object or representation based on the provided coordinates.
   */
  protected def createBBox(
      lat1: Option[Double],
      lng1: Option[Double],
      lat2: Option[Double],
      lng2: Option[Double],
      defaultMapParams: MapParams
  ): LatLngBBox = {
    LatLngBBox(
      minLat = min(
        lat1.getOrElse(defaultMapParams.lat1),
        lat2.getOrElse(defaultMapParams.lat2)
      ),
      minLng = min(
        lng1.getOrElse(defaultMapParams.lng1),
        lng2.getOrElse(defaultMapParams.lng2)
      ),
      maxLat = max(
        lat1.getOrElse(defaultMapParams.lat1),
        lat2.getOrElse(defaultMapParams.lat2)
      ),
      maxLng = max(
        lng1.getOrElse(defaultMapParams.lng1),
        lng2.getOrElse(defaultMapParams.lng2)
      )
    )
  }

  /**
   * Creates a bounding box (BBox) using the provided latitude and longitude values.
   *
   * @param bbox Bounding box in format "minLng,minLat,maxLng,maxLat".
   * @return A bounding box object or representation based on the provided coordinates.
   */
  protected def parseBBoxString(bbox: Option[String]): Option[LatLngBBox] = {
    bbox.flatMap { b =>
      try {
        val parts = b.split(",").map(_.trim.toDouble)
        if (parts.length == 4) {
          Some(LatLngBBox(minLng = parts(0), minLat = parts(1), maxLng = parts(2), maxLat = parts(3)))
        } else {
          logger.warn(s"Invalid bbox format: $b. Expected: minLng,minLat,maxLng,maxLat")
          None
        }
      } catch {
        case _: Exception => None
      }
    }
  }

  /**
   * Parses a date-time string into an `OffsetDateTime` object.
   *
   * @param dateTime The date-time string to parse.
   * @return An `Option` containing the parsed `OffsetDateTime`, or `None` if parsing fails or None was provided.
   */
  protected def parseDateTimeString(dateTime: Option[String]): Option[OffsetDateTime] = {
    dateTime.flatMap { s =>
      try {
        Some(OffsetDateTime.parse(s))
      } catch {
        case _: Exception => None
      }
    }
  }

  /**
   * Outputs a CSV stream from the provided database data stream.
   *
   * @tparam A The type of data in the stream, which must extend `StreamingApiType`.
   * @param dbDataStream The source stream of data to be converted into CSV format.
   * @param csvHeader The header for the CSV file.
   * @param inline Optional flag indicating whether to display the file inline or as an attachment.
   * @param filename The name of the output CSV file.
   */
  protected def outputCSV[A <: StreamingApiType](
      dbDataStream: Source[A, _],
      csvHeader: String,
      inline: Option[Boolean],
      filename: String
  ): Result = {
    val csvSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toCsvRow)
      .intersperse(csvHeader, "\n", "\n")

    Ok.chunked(csvSource, inline.getOrElse(false), Some(filename))
      .as("text/csv")
      .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$filename")
  }

  /**
   * Outputs a GeoJSON response from a stream of database data.
   *
   * @tparam A The type of data in the stream, which must extend `StreamingApiType`.
   * @param dbDataStream The source stream of data to be converted into CSV format.
   * @param inline Optional flag indicating whether to display the file inline or as an attachment.
   * @param filename The name of the output CSV file.
   */
  protected def outputGeoJSON[A <: StreamingApiType](
      dbDataStream: Source[A, _],
      inline: Option[Boolean],
      filename: String
  ): Result = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toJson.toString)
      .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

    Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename))
      .as(ContentTypes.JSON)
  }

  /**
   * Outputs a JSON response from a stream of database data.
   *
   * @tparam A The type of data in the stream, which must extend `StreamingApiType`.
   * @param dbDataStream The source stream of data to be converted into CSV format.
   * @param inline Optional flag indicating whether to display the file inline or as an attachment.
   * @param filename The name of the output CSV file.
   */
  protected def outputJSON[A <: StreamingApiType](
      dbDataStream: Source[A, _],
      inline: Option[Boolean],
      filename: String
  ): Result = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toJson.toString)
      .intersperse("[", ",", "]")

    Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename))
      .as(ContentTypes.JSON)
  }

  /**
   * Outputs a shapefile as a downloadable ZIP file response.
   *
   * @param dbDataStream A source stream of data of type `A` that extends `StreamingApiType`.
   * @param baseFileName The base name for the output shapefile and ZIP file.
   * @param createShapefile A function that takes a source stream of data, a base file name, and a batch size, and
   *                        returns an optional path to the created shapefile.
   * @param shapefileCreator A helper object for creating and zipping shapefiles.
   * @return A `Result` containing the zipped shapefile as a downloadable response, or an
   *         error response if the shapefile creation fails.
   */
  protected def outputShapefile[A <: StreamingApiType](
      dbDataStream: Source[A, _],
      baseFileName: String,
      createShapefile: (Source[A, _], String, Int) => Option[Path],
      shapefileCreator: ShapefilesCreatorHelper
  ): Result = {
    // Write data to the shapefile in batches.
    createShapefile(dbDataStream, baseFileName, DEFAULT_BATCH_SIZE)
      .map { zipPath =>
        // Zip the files and set up the buffered stream.
        val zipSource: Source[ByteString, Future[Boolean]] =
          shapefileCreator.zipShapefiles(Seq(zipPath), baseFileName)
        Ok.chunked(zipSource)
          .as("application/zip")
          .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
      }
      .getOrElse {
        InternalServerError("Failed to create shapefile")
      }
  }

  /**
   * Outputs data as a GeoPackage file.
   *
   * @param source The data stream to process.
   * @param baseFileName Base filename without extension.
   * @param createGeopackageMethod Method to create the GeoPackage file.
   * @param inline Whether to display inline or as attachment.
   * @tparam T The type of data in the stream.
   * @return Play Framework Result with the GeoPackage file.
   */
  protected def outputGeopackage[T](
      source: Source[T, _],
      baseFileName: String,
      createGeopackageMethod: (Source[T, _], String, Int) => Option[Path],
      inline: Option[Boolean]
  ): Result = {
    try {
      // Create the GeoPackage file.
      createGeopackageMethod(source, baseFileName, DEFAULT_BATCH_SIZE) match {
        case Some(geopackagePath) =>
          val fileName = s"$baseFileName.gpkg"
          val contentDisposition = if (inline.getOrElse(false)) {
            s"inline; filename=$fileName"
          } else {
            s"attachment; filename=$fileName"
          }

          // Stream the file and delete it after streaming.
          val fileSource = StreamConverters.fromInputStream(() =>
            new BufferedInputStream(Files.newInputStream(geopackagePath))
          ).mapMaterializedValue(_.map { _ =>
            Files.deleteIfExists(geopackagePath)
          })

          Ok.chunked(fileSource)
            .as("application/geopackage+sqlite3")
            .withHeaders(CONTENT_DISPOSITION -> contentDisposition)

        case None =>
          logger.error("Failed to create GeoPackage file")
          InternalServerError(Json.toJson(
            ApiError.internalServerError("Failed to create GeoPackage file")
          ))
      }
    } catch {
      case e: Exception =>
        logger.error(s"Error creating GeoPackage output: ${e.getMessage}", e)
        InternalServerError(Json.toJson(
          ApiError.internalServerError(s"Error creating GeoPackage: ${e.getMessage}")
        ))
    }
  }
}
