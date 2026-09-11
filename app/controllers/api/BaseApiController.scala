package controllers.api

import controllers.base.{CustomBaseController, CustomControllerComponents}
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, StreamingApiType}
import models.label.LabelTypeEnum
import models.utils.{LatLngBBox, MapParams}
import org.apache.pekko.stream.scaladsl.{Source, StreamConverters}
import play.api.Logger
import play.api.http.{ContentTypes, HttpVerbs}
import play.api.mvc.{RequestHeader, Result}

import java.io.BufferedInputStream
import java.nio.file.{Files, Path, Paths}
import java.time.{Duration, Instant, OffsetDateTime}
import java.time.format.{DateTimeFormatter, DateTimeParseException}
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.{ZipEntry, ZipOutputStream}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.IteratorHasAsScala
import scala.math._
import scala.util.{Failure, Success, Try, Using}
import scala.util.control.NonFatal

/**
 * Base controller for API endpoints with common utility methods.
 */
abstract class BaseApiController(cc: CustomControllerComponents)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  private val logger = Logger(this.getClass)

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

  /**
   * Parses an optional single-valued `labelType` query parameter into a label type, through the same allowlist check
   * (and error wording) as the endpoints that take a list.
   *
   * @param labelType The optional label type name.
   * @return `Right(None)` if absent, `Right(Some(labelType))` if valid, or `Left(ApiError)` for an unknown name.
   */
  protected def parseLabelTypeParam(labelType: Option[String]): Either[ApiError, Option[LabelTypeEnum.Base]] =
    parseAllowlistedList(labelType, LabelTypeEnum.labelTypeNames, "labelType")
      .map(_.flatMap(_.headOption).flatMap(LabelTypeEnum.byName.get))

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
  protected def parseAllowlistedList(
      raw: Option[String],
      allowlist: Set[String],
      paramName: String
  ): Either[ApiError, Option[Seq[String]]] =
    BaseApiController.parseAllowlistedList(raw, allowlist, paramName)
  protected def timestampedFilename(prefix: String): String =
    BaseApiController.timestampedFilename(prefix)

  /**
   * Each download gets its own folder: file names only carry the time to the second, so two downloads in the same
   * second would otherwise overwrite each other (#4133).
   *
   * @return The new, empty folder.
   */
  private def newDownloadDir(): Path = {
    Files.createDirectories(BaseApiController.downloadsDir)
    sweepStaleDownloadDirs()
    Files.createTempDirectory(BaseApiController.downloadsDir, "")
  }

  /**
   * Serves one copy of a URL at a time. Building a file takes minutes on prod, and a client that retries early doubles
   * that work (#4161), so the retry gets a 429 instead. Only for file downloads: the site's own pages fetch the same
   * CSV/GeoJSON URLs in parallel, and those are cheap to repeat. `serve` must wrap its body with [[releasing]].
   */
  private def oneAtATime(serve: BaseApiController.InFlight => Future[Result])(implicit
      request: RequestHeader
  ): Future[Result] = {
    val key   = request.uri
    val now   = Instant.now()
    val fresh = new BaseApiController.InFlight(now)
    val busy  = ApiError
      .toResult(
        ApiError.duplicateRequest("This file is already being built for an earlier request. Please try again shortly.")
      )
      .withHeaders(RETRY_AFTER -> "30")
    // Drop entries nobody will release (the client left before Play sent anything), so the map can't grow forever.
    BaseApiController.inFlight.entrySet().removeIf(e => !e.getValue.stillBusy(now))
    if (request.method == HttpVerbs.HEAD) {
      // A HEAD is a "would this be refused?" check that builds nothing: the Label Map's download button asks first,
      // since a browser download that gets a 429 just fails silently.
      val taken = Option(BaseApiController.inFlight.get(key)).exists(_.stillBusy(now))
      return Future.successful(if (taken) busy else Ok)
    }
    val owner =
      BaseApiController.inFlight.merge(key, fresh, (current, _) => if (current.stillBusy(now)) current else fresh)
    if (owner ne fresh) {
      Future.successful(busy)
    } else {
      // `serve` can fail before it even returns a Future (e.g. a full disk); the URL must be freed then too.
      Try(serve(fresh)).fold(
        e => { fresh.release(key); Future.failed(e) },
        _.transform {
          case Success(result) if result.header.status >= 400 => fresh.release(key); Success(result)
          case Success(result)                                => fresh.resultAt = Some(Instant.now()); Success(result)
          case Failure(e)                                     => fresh.release(key); Failure(e)
        }
      )
    }
  }

  /** Ties the URL's hold to the response body: alive while chunks flow, freed when the body ends for any reason. */
  private def releasing[T](body: Source[T, _], entry: BaseApiController.InFlight)(implicit
      request: RequestHeader
  ): Source[T, _] =
    body
      .mapMaterializedValue { mat => entry.bodyStarted = true; mat }
      .map { chunk => entry.lastSeen = Instant.now(); chunk }
      .watchTermination() { (mat, done) => done.onComplete(_ => entry.release(request.uri)); mat }

  /**
   * Deletes folders whose client gave up before the file was ready, since those are never streamed and so never
   * cleaned up the normal way (#4133). Throttled because it runs on the request thread.
   */
  private def sweepStaleDownloadDirs(): Unit = {
    val now = Instant.now()
    if (BaseApiController.lastSweep.plus(BaseApiController.sweepInterval).isBefore(now)) {
      BaseApiController.lastSweep = now
      val cutoff = now.minus(BaseApiController.staleDownloadAge)
      val dirs   = Try(Using.resource(Files.list(BaseApiController.downloadsDir))(_.iterator().asScala.toSeq))
      dirs.failed.foreach(e => logger.warn(s"Could not sweep old download folders: ${e.getMessage}"))
      // One folder failing (usually deleted by its own download mid-sweep) must not stop the rest.
      dirs.getOrElse(Seq.empty).filter(Files.isDirectory(_)).foreach { dir =>
        Try {
          val lastWrite = Using
            .resource(Files.list(dir))(_.iterator().asScala.map(Files.getLastModifiedTime(_).toInstant).maxOption)
            .getOrElse(Files.getLastModifiedTime(dir).toInstant)
          if (lastWrite.isBefore(cutoff)) {
            logger.warn(s"Deleting abandoned download folder $dir: nothing has written to it since $lastWrite.")
            deleteDownloadDir(dir)
          }
        }
      }
    }
  }

  /** Deletes a download folder and its files, ignoring failures (already gone, still in use). */
  private def deleteDownloadDir(dir: Path): Unit = {
    val _ = Try {
      Using.resource(Files.walk(dir))(_.sorted(java.util.Comparator.reverseOrder[Path]()).forEach(p => Files.delete(p)))
    }
  }

  /** Streams a finished file and deletes its folder when the stream ends, however it ends. */
  private def serveDownloadFile(
      dir: Path,
      file: Path,
      contentType: String,
      disposition: String,
      entry: BaseApiController.InFlight
  )(implicit request: RequestHeader): Result = {
    val fileSource = StreamConverters
      .fromInputStream(() => new BufferedInputStream(Files.newInputStream(file)))
      .mapMaterializedValue(_.andThen { case _ => deleteDownloadDir(dir) })
    Ok.chunked(releasing(fileSource, entry)).as(contentType).withHeaders(CONTENT_DISPOSITION -> disposition)
  }

  /**
   * Outputs a CSV stream from the provided database data stream.
   *
   * @tparam A The type of data in the stream, which must extend `StreamingApiType`.
   * @param dbDataStream The source stream of data to be converted into CSV format.
   * @param csvHeader The header line for the CSV file, without a trailing newline.
   * @param inline Optional flag indicating whether to display the file inline or as an attachment.
   * @param filename The name of the output CSV file.
   */
  protected def outputCSV[A <: StreamingApiType](
      dbDataStream: Source[A, _],
      csvHeader: String,
      inline: Option[Boolean],
      filename: String
  ): Future[Result] = {
    // Logging wraps the bare rows so a cut-off is reported in rows. The header carries its own newline because
    // `intersperse` puts nothing between it and the first row.
    val csvSource: Source[String, _] = logStreamFailures(dbDataStream.map(row => row.toCsvRow), filename)
      .intersperse(s"$csvHeader\n", "\n", "\n")

    // Play's chunked(content, inline, fileName) overload emits a properly quoted Content-Disposition that honors
    // `inline`; adding a manual header here would both un-quote the filename and force `attachment`.
    Future.successful(Ok.chunked(csvSource, inline.getOrElse(false), Some(filename)).as("text/csv"))
  }

  /**
   * Writes CSV files into a fresh download folder, zips them, and streams the zip. The URL is held before the CSVs
   * are written, so a duplicate request is turned away before doing any of the work.
   *
   * @param baseFileName The base name for the ZIP file (without extension).
   * @param writeCsvs Writes the CSV files into the given folder and returns (file path, zip entry name) pairs.
   * @return A Result containing the zipped CSV files as a downloadable response.
   */
  protected def outputZippedCsvs(baseFileName: String)(writeCsvs: Path => Future[Seq[(Path, String)]])(implicit
      request: RequestHeader
  ): Future[Result] = oneAtATime { entry =>
    val dir     = newDownloadDir()
    val zipPath = dir.resolve(s"$baseFileName.zip")
    writeCsvs(dir)
      .map { files =>
        Using.resource(new ZipOutputStream(Files.newOutputStream(zipPath))) { zipOut =>
          files.foreach { case (filePath, entryName) =>
            zipOut.putNextEntry(new ZipEntry(entryName))
            Files.copy(filePath, zipOut)
            zipOut.closeEntry()
            Files.deleteIfExists(filePath)
          }
        }
        serveDownloadFile(dir, zipPath, "application/zip", s"attachment; filename=$baseFileName.zip", entry)
      }
      .recoverWith { case NonFatal(e) =>
        deleteDownloadDir(dir)
        Future.failed(e)
      }
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
    val jsonSource: Source[String, _] =
      geoJsonFeatureCollection(logStreamFailures(dbDataStream.map(row => row.toJson.toString), filename))

    Future.successful(Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename)).as(ContentTypes.JSON))
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
    val jsonSource: Source[String, _] = logStreamFailures(dbDataStream.map(row => row.toJson.toString), filename)
      .intersperse("[", ",", "]")

    Future.successful(Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename)).as(ContentTypes.JSON))
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
  )(implicit request: RequestHeader): Future[Result] =
    outputShapefiles(
      dbDataStream,
      baseFileName,
      (source: Source[A, _], outputFile: String, batchSize: Int) =>
        createShapefile(source, outputFile, batchSize).map(_.map(Seq(_))),
      shapefileCreator
    )

  /**
   * Outputs several shapefiles as one downloadable ZIP file response.
   *
   * @param createShapefiles Builds the shapefiles under the given base path in batches of the given size; None if that
   *                         failed.
   * @return The zip as a downloadable response, or an error response if the shapefiles couldn't be created.
   */
  protected def outputShapefiles[A](
      dbDataStream: Source[A, _],
      baseFileName: String,
      createShapefiles: (Source[A, _], String, Int) => Future[Option[Seq[Path]]],
      shapefileCreator: ShapefilesCreatorHelper
  )(implicit request: RequestHeader): Future[Result] = oneAtATime { entry =>
    val dir        = newDownloadDir()
    val outputFile = dir.resolve(baseFileName).toString
    createShapefiles(dbDataStream, outputFile, DEFAULT_BATCH_SIZE)
      .map {
        case Some(shapefilePaths) =>
          val zipPath = shapefileCreator.zipShapefile(shapefilePaths, outputFile)
          serveDownloadFile(dir, zipPath, "application/zip", s"attachment; filename=$baseFileName.zip", entry)
        case None =>
          deleteDownloadDir(dir)
          ApiError.toResult(ApiError.internalServerError("Failed to create shapefile"))
      }
      .recoverWith { case NonFatal(e) =>
        deleteDownloadDir(dir)
        Future.failed(e)
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
  )(implicit request: RequestHeader): Future[Result] = oneAtATime { entry =>
    val dir = newDownloadDir()
    // Going through `flatMap` means a builder that throws is handled by the same `recover` as one that fails later.
    Future.unit
      .flatMap(_ => createGeopackageMethod(source, dir.resolve(baseFileName).toString, DEFAULT_BATCH_SIZE))
      .map {
        case Some(geopackagePath) =>
          val fileName           = s"$baseFileName.gpkg"
          val contentDisposition = if (inline.getOrElse(false)) {
            s"inline; filename=$fileName"
          } else {
            s"attachment; filename=$fileName"
          }
          serveDownloadFile(dir, geopackagePath, "application/geopackage+sqlite3", contentDisposition, entry)

        case None =>
          deleteDownloadDir(dir)
          logger.error("Failed to create GeoPackage file")
          ApiError.toResult(ApiError.internalServerError("Failed to create GeoPackage file"))
      }
      .recover { case NonFatal(e) =>
        deleteDownloadDir(dir)
        logger.error(s"Error creating GeoPackage output: ${e.getMessage}", e)
        ApiError.toResult(ApiError.internalServerError(s"Error creating GeoPackage: ${e.getMessage}"))
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

  /**
   * Parses a comma-separated query parameter, validating every token against an allowlist.
   *
   * Beyond input validation, the allowlist makes the tokens safe to splice into the raw SQL built in the DAO layer.
   *
   * @param raw       The optional raw query parameter string.
   * @param allowlist The set of valid token values.
   * @param paramName The public parameter name, used in the error message.
   * @return          `Right(None)` if absent; `Right(Some(tokens))` if every trimmed token is allowlisted;
   *                  `Left(ApiError)` naming the offending parameter otherwise.
   */
  def parseAllowlistedList(
      raw: Option[String],
      allowlist: Set[String],
      paramName: String
  ): Either[ApiError, Option[Seq[String]]] =
    parseCommaSeparated(raw) match {
      case None         => Right(None)
      case Some(tokens) =>
        tokens.find(token => !allowlist.contains(token)) match {
          case Some(badToken) =>
            Left(
              ApiError.invalidParameter(
                s"Invalid $paramName value: '$badToken'. Must be a comma-separated list of: " +
                  s"${allowlist.toSeq.sorted.mkString(", ")}.",
                paramName
              )
            )
          case None => Right(Some(tokens))
        }
    }

  /**
   * Builds a timestamped download filename prefix, e.g. "labels_2026-08-05-134512".
   *
   * The timestamp deliberately contains no colons: they are illegal in Windows filenames and in an unquoted
   * Content-Disposition filename value.
   *
   * @param prefix The filename prefix (e.g. "labels").
   */
  def timestampedFilename(prefix: String): String =
    s"${prefix}_${OffsetDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd-HHmmss"))}"

  /** Where file downloads (shapefile, GeoPackage, zipped CSVs) are built, one folder each. */
  val downloadsDir: Path = Paths.get("api-downloads")

  /** A download folder with no writes for this long counts as abandoned. */
  val staleDownloadAge: Duration = Duration.ofHours(2)

  /** URLs being served right now; see [[InFlight]]. */
  val inFlight: ConcurrentHashMap[String, InFlight] = new ConcurrentHashMap()

  /** How often, at most, abandoned download folders are swept. */
  val sweepInterval: Duration = Duration.ofMinutes(5)

  /** When the stale-folder sweep last ran. */
  @volatile var lastSweep: Instant = Instant.EPOCH

  /** A download with no sign of life (nothing built or sent) for this long has leaked and stops blocking its URL. */
  val inFlightLimit: Duration = Duration.ofMinutes(15)

  /** Play starts sending a body right after the action returns, so one not started by then never will. */
  val bodyStartGrace: Duration = Duration.ofSeconds(10)

  /**
   * One download being served. It blocks its URL while the file is built and while the body streams. A body Play
   * never sends (the client vanished first, or a test read only the status) stops blocking after [[bodyStartGrace]].
   */
  final class InFlight(val started: Instant) {
    @volatile var resultAt: Option[Instant] = None
    @volatile var bodyStarted: Boolean      = false
    @volatile var lastSeen: Instant         = started

    /** @return Whether an identical request at `now` should still be turned away. */
    def stillBusy(now: Instant): Boolean = resultAt match {
      case Some(handedOver) if !bodyStarted => handedOver.plus(bodyStartGrace).isAfter(now)
      case _                                => lastSeen.plus(inFlightLimit).isAfter(now)
    }

    /** Frees the URL, unless a later request already took it over. */
    def release(key: String): Unit = { val _ = inFlight.remove(key, this) }
  }
}
