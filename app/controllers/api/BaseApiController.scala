package controllers.api

import controllers.base.{CustomBaseController, CustomControllerComponents}
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, StreamingApiType}
import models.utils.{LatLngBBox, MapParams}
import org.apache.pekko.Done
import org.apache.pekko.stream.scaladsl.{Source, StreamConverters}
import org.apache.pekko.util.ByteString
import play.api.Logger
import play.api.http.ContentTypes
import play.api.mvc.Result

import java.io.{BufferedInputStream, File}
import java.nio.file.{Files, Path}
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import java.util.zip.{ZipEntry, ZipOutputStream}
import scala.concurrent.{ExecutionContext, Future}
import scala.math._
import scala.util.control.NonFatal
import scala.util.{Failure, Success}

/**
 * Base controller for API endpoints with common utility methods.
 */
abstract class BaseApiController(cc: CustomControllerComponents)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  private val logger                    = Logger(this.getClass)
  protected val DEFAULT_BATCH_SIZE: Int = 50000

  /**
   * Attaches failure logging to a streaming response body.
   *
   * Chunked API responses (`Ok.chunked`) commit a 200 status and headers *before* the underlying database stream
   * runs. So if the stream fails mid-flight — e.g. a query timeout or dropped connection while serializing a very
   * large city's labels — the body simply ends, and Play cannot retract the status it already sent. Without this hook
   * such failures are completely silent: exactly the #4161 symptom, where large-city `/v3/api/rawLabels` returns a
   * 200 with an empty/truncated body and no server-side trace. This logs the failure so it is at least diagnosable;
   * it does not (and cannot) change the status already sent to the client.
   *
   * @param source The streaming body to monitor.
   * @param label  A short identifier (e.g. the download filename) included in the log line to locate the failure.
   * @return       The same source, with termination-failure logging attached (success behavior is unchanged).
   */
  private def logStreamFailures(source: Source[String, _], label: String): Source[String, _] =
    source.watchTermination() { (mat, done) =>
      done.onComplete {
        case Failure(e) =>
          logger.error(
            s"API streaming response failed mid-flight for '$label'; the client received a truncated/empty body " +
              s"after a 200 status was already sent (see #4161).",
            e
          )
        case Success(_: Done) => // Stream completed normally; nothing to log.
      }
      mat
    }

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
      minLat = min(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      minLng = min(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2)),
      maxLat = max(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      maxLng = max(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2))
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
        case _: NumberFormatException => None
      }
    }
  }

  /**
   * Parses an optional ISO 8601 date-time string, distinguishing an absent value from a malformed one.
   *
   * Unlike a plain `Option` parse, a malformed value is reported as an error rather than silently dropped, so the
   * caller can return a 400 instead of quietly ignoring the filter.
   *
   * @param dateTime The optional date-time string to parse.
   * @param paramName The query-parameter name, used in the error message when parsing fails.
   * @return `Right(None)` if absent, `Right(Some(parsed))` if valid, or `Left(ApiError)` if malformed.
   */
  protected def parseDateTimeParam(
      dateTime: Option[String],
      paramName: String
  ): Either[ApiError, Option[OffsetDateTime]] = dateTime match {
    case None    => Right(None)
    case Some(s) =>
      try {
        Right(Some(OffsetDateTime.parse(s)))
      } catch {
        case _: DateTimeParseException =>
          Left(
            ApiError.invalidParameter(
              s"Invalid value for $paramName parameter. Expected an ISO 8601 date-time, e.g. 2021-03-01T00:00:00Z.",
              paramName
            )
          )
      }
  }

  /** Renders an `ApiError` as an RFC 7807 `application/problem+json` response with the error's HTTP status. */
  protected def badRequest(error: ApiError): Result = ApiError.toResult(error)

  // Instance method wrappers — delegate to the companion object so the pure logic is unit-testable without DI.
  protected def validateBBoxParam(bbox: Option[String], parsed: Option[LatLngBBox]): Option[ApiError] =
    BaseApiController.validateBBoxParam(bbox, parsed)
  protected def validateRegionId(regionId: Option[Int]): Option[ApiError] =
    BaseApiController.validateRegionId(regionId)
  protected def resolveGeoFilters(
      bbox: Option[String],
      parsedBbox: Option[LatLngBBox],
      regionId: Option[Int],
      regionName: Option[String],
      cityMapParams: MapParams
  ): (Option[LatLngBBox], Option[Int], Option[String]) =
    BaseApiController.resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)
  protected def parseCommaSeparated(raw: Option[String]): Option[Seq[String]] =
    BaseApiController.parseCommaSeparated(raw)

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
  ): Future[Result] = {
    val csvSource: Source[String, _] = dbDataStream
      .map(row => row.toCsvRow)
      .intersperse(csvHeader, "\n", "\n")

    Future.successful(
      Ok.chunked(logStreamFailures(csvSource, filename), inline.getOrElse(false), Some(filename))
        .as("text/csv")
        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$filename")
    )
  }

  /**
   * Zips multiple CSV files together and streams the resulting ZIP archive as a response.
   *
   * @param files A sequence of (file path, entry name) pairs for each CSV file to include in the ZIP.
   * @param baseFileName The base name for the ZIP file (without extension).
   * @return A Result containing the zipped CSV files as a downloadable response.
   */
  protected def zipAndStreamCsvFiles(files: Seq[(Path, String)], baseFileName: String): Future[Result] = {
    val zipPath = new File(s"$baseFileName.zip").toPath

    // Build the zip, always closing the output stream and cleaning up partial output if anything fails.
    try {
      val zipOut = new ZipOutputStream(Files.newOutputStream(zipPath))
      try {
        files.foreach { case (filePath, entryName) =>
          zipOut.putNextEntry(new ZipEntry(entryName))
          Files.copy(filePath, zipOut)
          zipOut.closeEntry()
          Files.deleteIfExists(filePath)
        }
      } finally {
        zipOut.close()
      }
    } catch {
      case NonFatal(e) =>
        Files.deleteIfExists(zipPath)
        files.foreach { case (filePath, _) => Files.deleteIfExists(filePath) }
        throw e
    }

    val zipSource = StreamConverters
      .fromInputStream(() => new BufferedInputStream(Files.newInputStream(zipPath)))
      .mapMaterializedValue(_.map { _ => Files.deleteIfExists(zipPath) })

    Future.successful(
      Ok.chunked(zipSource)
        .as("application/zip")
        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
    )
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
  ): Future[Result] = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(row => row.toJson.toString)
      .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

    Future.successful(
      Ok.chunked(logStreamFailures(jsonSource, filename), inline.getOrElse(false), Some(filename))
        .as(ContentTypes.JSON)
    )
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
  ): Future[Result] = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(row => row.toJson.toString)
      .intersperse("[", ",", "]")

    Future.successful(
      Ok.chunked(logStreamFailures(jsonSource, filename), inline.getOrElse(false), Some(filename))
        .as(ContentTypes.JSON)
    )
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
      createShapefile: (Source[A, _], String, Int) => Future[Option[Path]],
      shapefileCreator: ShapefilesCreatorHelper
  ): Future[Result] = {
    // Write data to the shapefile in batches.
    createShapefile(dbDataStream, baseFileName, DEFAULT_BATCH_SIZE)
      .map {
        case Some(zipPath) =>
          // Zip the files and set up the buffered stream.
          val zipSource: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefile(Seq(zipPath), baseFileName)

          Ok.chunked(zipSource)
            .as("application/zip")
            .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")

        case None =>
          ApiError.toResult(ApiError.internalServerError("Failed to create shapefile"))
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
      createGeopackageMethod: (Source[T, _], String, Int) => Future[Option[Path]],
      inline: Option[Boolean]
  ): Future[Result] = {
    try {
      // Create the GeoPackage file.
      createGeopackageMethod(source, baseFileName, DEFAULT_BATCH_SIZE).map {
        case Some(geopackagePath) =>
          val fileName           = s"$baseFileName.gpkg"
          val contentDisposition = if (inline.getOrElse(false)) {
            s"inline; filename=$fileName"
          } else {
            s"attachment; filename=$fileName"
          }

          // Stream the file and delete it after streaming.
          val fileSource = StreamConverters
            .fromInputStream(() => new BufferedInputStream(Files.newInputStream(geopackagePath)))
            .mapMaterializedValue(_.map { _ => Files.deleteIfExists(geopackagePath) })

          Ok.chunked(fileSource)
            .as("application/geopackage+sqlite3")
            .withHeaders(CONTENT_DISPOSITION -> contentDisposition)

        case None =>
          logger.error("Failed to create GeoPackage file")
          ApiError.toResult(ApiError.internalServerError("Failed to create GeoPackage file"))
      }
    } catch {
      case e: Exception =>
        logger.error(s"Error creating GeoPackage output: ${e.getMessage}", e)
        Future.successful(
          ApiError.toResult(ApiError.internalServerError(s"Error creating GeoPackage: ${e.getMessage}"))
        )
    }
  }
}

/**
 * Pure geo-filter helpers shared across v3 API controllers.
 *
 * Extracted to a companion object so they can be unit-tested directly without any DI wiring.
 * The controller instance methods in [[BaseApiController]] delegate here.
 */
object BaseApiController {

  /**
   * Returns an ApiError if `bbox` was supplied but could not be parsed.
   *
   * @param bbox   The raw bbox query parameter value.
   * @param parsed The result of running `parseBBoxString(bbox)`.
   */
  def validateBBoxParam(bbox: Option[String], parsed: Option[LatLngBBox]): Option[ApiError] =
    if (bbox.isDefined && parsed.isEmpty)
      Some(
        ApiError
          .invalidParameter("Invalid value for bbox parameter. Expected format: minLng,minLat,maxLng,maxLat.", "bbox")
      )
    else None

  /**
   * Returns an ApiError if `regionId` is defined but not a positive integer.
   *
   * @param regionId The optional regionId query parameter.
   */
  def validateRegionId(regionId: Option[Int]): Option[ApiError] =
    if (regionId.exists(_ <= 0))
      Some(ApiError.invalidParameter("Invalid regionId value. Must be a positive integer.", "regionId"))
    else None

  /**
   * Resolves the effective bbox/regionId/regionName filters, applying the standard v3 precedence rules:
   * - An explicit valid bbox takes precedence over region filters.
   * - regionId takes precedence over regionName.
   * - If neither a bbox nor a region filter is provided, the city default bbox is used.
   *
   * @param bbox          The raw bbox query parameter (pre-parse string, used only to detect "was it supplied").
   * @param parsedBbox    The result of running `parseBBoxString(bbox)`.
   * @param regionId      The optional regionId query parameter.
   * @param regionName    The optional regionName query parameter.
   * @param cityMapParams Default map parameters for the current city.
   * @return A triple of (finalBbox, finalRegionId, finalRegionName) after applying precedence.
   */
  def resolveGeoFilters(
      bbox: Option[String],
      parsedBbox: Option[LatLngBBox],
      regionId: Option[Int],
      regionName: Option[String],
      cityMapParams: MapParams
  ): (Option[LatLngBBox], Option[Int], Option[String]) = {
    val defaultBox = LatLngBBox(
      minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
      minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
      maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
      maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
    )
    val bboxActive = bbox.isDefined && parsedBbox.isDefined
    val finalBbox  =
      if (bboxActive) parsedBbox else if (regionId.isDefined || regionName.isDefined) None else Some(defaultBox)
    val finalRegId   = if (bboxActive) None else regionId
    val finalRegName = if (bboxActive || regionId.isDefined) None else regionName
    (finalBbox, finalRegId, finalRegName)
  }

  /**
   * Parses a comma-separated query parameter into a sequence of trimmed strings.
   *
   * @param raw The optional raw query parameter string.
   * @return `None` if the parameter was absent; a `Some(Seq(...))` of trimmed tokens otherwise.
   */
  def parseCommaSeparated(raw: Option[String]): Option[Seq[String]] =
    raw.map(_.split(",").map(_.trim).toSeq)
}
