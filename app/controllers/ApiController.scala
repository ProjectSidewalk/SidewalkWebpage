package controllers

import controllers.ApiType.ApiType
import controllers.base._
import controllers.helper.ShapefilesCreatorHelper
import formats.json.ApiFormats._
import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
import models.auth.DefaultEnv
import models.label.{LabelAllMetadata, LabelCVMetadata, ProjectSidewalkStats}
import models.region._
import models.street.{StreetEdge, StreetEdgeInfo}
import models.user.UserStatApi
import models.utils.MapParams
import models.api.{LabelData, RawLabelFilters, ApiError}

import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source, FileIO}
import org.apache.pekko.util.ByteString
import org.locationtech.jts.geom._
import play.api.http.ContentTypes
import play.api.i18n.Lang.logger
import play.api.libs.json._
import play.api.mvc.Result
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.nio.file.Path
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.math._

object ApiType extends Enumeration {
  type ApiType = Value
  val Neighborhood, Street, Attribute = Value
}

trait StreamingApiType {
  def toJSON: JsValue
  def toCSVRow: String
  // Most likely also has an associated create<type>ShapeFile() method to call on a stream of data of the type.
}

case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Long, regionId: Int, score: Double, auditCount: Int,
                             attributes: Array[Int], significance: Array[Double],
                             avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime],
                             imageCount: Int, labelCount: Int) extends StreamingApiType {
  def toJSON: JsObject = accessScoreStreetToJSON(this)
  def toCSVRow: String = accessScoreStreetToCSVRow(this)
}
object AccessScoreStreet {
  val csvHeader: String = "Street ID,OSM ID,Neighborhood ID,Access Score,Coordinates,Audit Count,Avg Curb Ramp Score," +
    "Avg No Curb Ramp Score,Avg Obstacle Score,Avg Surface Problem Score,Curb Ramp Significance," +
    "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
    "Avg Label Date\n"
}

case class StreetLabelCounter(streetEdgeId: Int, var nLabels: Int, var nImages: Int, var labelAgeSum: Long,
                              var imageAgeSum: Long, labelCounter: mutable.Map[String, Int])

case class AccessScoreNeighborhood(name: String, geom: MultiPolygon, regionID: Int, coverage: Double, score: Double,
                                   attributeScores: Array[Double], significanceScores: Array[Double],
                                   avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime]) extends StreamingApiType {
  def toJSON: JsObject = accessScoreNeighborhoodToJson(this)
  def toCSVRow: String = accessScoreNeighborhoodToCSVRow(this)
}
object AccessScoreNeighborhood {
  val csvHeader: String = "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
    "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
    "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
    "Avg Label Date\n"
}

case class ApiBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}

@Singleton
class ApiController @Inject()(cc: CustomControllerComponents,
                              val silhouette: Silhouette[DefaultEnv],
                              apiService: ApiService,
                              configService: ConfigService,
                              shapefileCreator: ShapefilesCreatorHelper,
                              gsvDataService: service.GsvDataService
                             )(implicit ec: ExecutionContext, mat: Materializer) extends CustomBaseController(cc) {

  val DEFAULT_BATCH_SIZE = 20000

  /**
   * Creates a bounding box from the given latitudes and longitudes. Use default values from city if any None.
   */
  def createBBox(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], defaultMapParams: MapParams): ApiBBox = {
    ApiBBox(minLat = min(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      minLng = min(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2)),
      maxLat = max(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      maxLng = max(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2)))
  }

  /**
   * Creates and streams a CSV file from the given data stream.
   */
  private def outputCSV[A <: StreamingApiType](dbDataStream: Source[A, _], csvHeader: String, inline: Option[Boolean], filename: String): Result = {
    val csvSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toCSVRow)
      .intersperse(csvHeader, "\n", "\n")

    Ok.chunked(csvSource, inline.getOrElse(false), Some(filename))
      .as("text/csv").withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$filename")
  }

  /**
   * Creates and streams a GeoJSON file from the given data stream.
   */
  private def outputGeoJSON[A <: StreamingApiType](dbDataStream: Source[A, _], inline: Option[Boolean], filename: String): Result = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toJSON.toString)
      .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

    Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename)).as(ContentTypes.JSON)
  }

  /**
  * Creates and streams a GeoPackage file from the given data stream.
  *
  * @param dbDataStream The source stream of data objects
  * @param baseFileName Base name for the output file (without extension)
  * @return HTTP Result with the streamed GeoPackage file
  */
  private def outputGeopackage[A <: StreamingApiType](dbDataStream: Source[A, _], baseFileName: String): Result = {
    // Implementation depends on your GeoPackage creation method in shapefileCreator
    shapefileCreator.createRawLabelDataGeopackage(dbDataStream.asInstanceOf[Source[LabelData, _]], baseFileName, DEFAULT_BATCH_SIZE).map { path =>
      val fileSource = FileIO.fromPath(path)
      Ok.chunked(fileSource)
        .as("application/geopackage+sqlite3")
        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.gpkg")
    }.getOrElse {
      InternalServerError("Failed to create GeoPackage file")
    }
  }

  /**
   * Creates and streams a JSON file from the given data stream.
   */
  private def outputJSON[A <: StreamingApiType](dbDataStream: Source[A, _], inline: Option[Boolean], filename: String): Result = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toJSON.toString)
      .intersperse("[", ",", "]")

    Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename)).as(ContentTypes.JSON)
  }

  /**
   * Creates and streams a zipped Shapefile file from the given data stream.
   */
  private def outputShapefile[A <: StreamingApiType](dbDataStream: Source[A, _], baseFileName: String,
                                                     createShapefile: (Source[A, _], String, Int) => Option[Path]): Result = {
    // Write data to the shapefile in batches.
    createShapefile(dbDataStream, baseFileName, DEFAULT_BATCH_SIZE).map { zipPath =>
      // Zip the files and set up the buffered stream.
      val zipSource: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefiles(Seq(zipPath), baseFileName)
      Ok.chunked(zipSource).as("application/zip")
        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
    }.getOrElse {
      InternalServerError("Failed to create shapefile")
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
  def getAccessAttributesWithLabelsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                                      severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>

    configService.getCityMapParams.flatMap { cityMapParams =>
      val bbox: ApiBBox = ApiBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
        maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
      val timeStr: String = OffsetDateTime.now().toString
      val baseFileName: String = s"attributesWithLabels_$timeStr"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeWithLabelForApi, _] =
        apiService.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, DEFAULT_BATCH_SIZE)
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          Future.successful(
            outputCSV(dbDataStream, GlobalAttributeWithLabelForApi.csvHeader, inline, baseFileName + ".csv")
          )

        case Some("shapefile") =>
          // We aren't using the same shapefile output method as we do for other APIs because we are creating two
          // separate shapefiles and zipping them together.

          // Get a separate attributes data stream as well for Shapefiles.
          val attributesDataStream: Source[GlobalAttributeForApi, _] =
            apiService.getAttributesInBoundingBox(ApiType.Attribute, bbox, severity, DEFAULT_BATCH_SIZE)

          val futureResults: Future[(Path, Path)] = Future.sequence(Seq(
            Future { shapefileCreator.createAttributeShapeFile(attributesDataStream, s"attributes_$timeStr", DEFAULT_BATCH_SIZE).get },
            Future { shapefileCreator.createLabelShapeFile(dbDataStream, s"labels_$timeStr", DEFAULT_BATCH_SIZE).get }
          )).recover {
            case e: Exception =>
              logger.error("Error creating shapefiles", e)
              throw e
          }.map { paths => (paths(0), paths(1)) } // Put them into a tuple.

          // Once both sets of files have been created, zip them together and stream the result.
          futureResults.map { case (attributePath, labelPath) =>
            val zipSource: Source[ByteString, Future[Boolean]] =
              shapefileCreator.zipShapefiles(Seq(attributePath, labelPath), baseFileName)

            Ok.chunked(zipSource).as("application/zip")
              .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
          }.recover {
            case e: Exception =>
              logger.error("Error in shapefile creation process", e)
              InternalServerError("Failed to create shapefiles")
          }

        case _ =>
          Future.successful(outputGeoJSON(dbDataStream, inline, baseFileName + ".json"))
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
  def getAccessAttributesV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], severity: Option[String],
                            filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      val bbox: ApiBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val baseFileName: String = s"attributes_${OffsetDateTime.now()}"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeForApi, _] =
        apiService.getAttributesInBoundingBox(ApiType.Attribute, bbox, severity, DEFAULT_BATCH_SIZE)
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, GlobalAttributeForApi.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createAttributeShapeFile)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }

  /**
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param filetype One of "csv", "shapefile", or "geojson"
   */
  def getAccessScoreNeighborhoodsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: ApiBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Retrieve data and cluster them by location and label type.
      neighborhoodAccessScores: Seq[AccessScoreNeighborhood] <- computeAccessScoresForNeighborhoods(bbox)
    } yield {
      val baseFileName: String = s"accessScoreNeighborhood_${OffsetDateTime.now()}"
      val neighborhoodStream: Source[AccessScoreNeighborhood, _] = Source.fromIterator(() => neighborhoodAccessScores.iterator)
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(neighborhoodStream, AccessScoreNeighborhood.csvHeader, inline = None, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(neighborhoodStream, baseFileName, shapefileCreator.createNeighborhoodShapefile)
        case _ =>
          outputGeoJSON(neighborhoodStream, inline = Some(true), baseFileName + ".json")
      }
    }
  }

  /**
   * Computes AccessScore for every neighborhood in the given bounding box.
   * @param bbox
   */
  def computeAccessScoresForNeighborhoods(bbox: ApiBBox): Future[Seq[AccessScoreNeighborhood]] = {
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)
    for {
      neighborhoods: Seq[Region] <- apiService.getNeighborhoodsWithin(bbox)
      streetAccessScores: Seq[AccessScoreStreet] <- computeAccessScoresForStreets(ApiType.Neighborhood, bbox)
    } yield {
      val auditedStreets: Seq[AccessScoreStreet] = streetAccessScores.filter(_.auditCount > 0)

      // Populate every object in the list.
      val neighborhoodList: Seq[AccessScoreNeighborhood] = neighborhoods.map { n =>
        val auditedStreetsIntersecting: Seq[AccessScoreStreet] = auditedStreets.filter(_.regionId == n.regionId)
        // Set default values for everything to 0, so null values will be 0 as well.
        var coverage: Double = 0.0
        var accessScore: Double = 0.0
        var averagedStreetFeatures: Array[Double] = Array(0.0, 0.0, 0.0, 0.0, 0.0)
        var avgImageCaptureDate: Option[OffsetDateTime] = None
        var avgLabelDate: Option[OffsetDateTime] = None

        if (auditedStreetsIntersecting.nonEmpty) {
          averagedStreetFeatures = auditedStreetsIntersecting.map(_.attributes)
            .transpose.map(_.sum.toDouble / auditedStreetsIntersecting.size).toArray
          accessScore = computeAccessScore(averagedStreetFeatures, significance)
          val streetsIntersecting: Seq[AccessScoreStreet] = streetAccessScores.filter(_.regionId == n.regionId)
          coverage = auditedStreetsIntersecting.size.toDouble / streetsIntersecting.size

          // Compute average image & label age if there are any labels on the streets.
          val nImages: Int = auditedStreetsIntersecting.map(s => s.imageCount).sum
          val nLabels: Int = auditedStreetsIntersecting.map(s => s.labelCount).sum
          val (avgImageAge, avgLabelAge): (Option[Long], Option[Long]) =
            if (nImages > 0 && nLabels > 0) {(
              Some(auditedStreetsIntersecting.flatMap(s => s.avgImageCaptureDate.map(_.toInstant.toEpochMilli * s.imageCount)).sum / nImages),
              Some(auditedStreetsIntersecting.flatMap(s => s.avgLabelDate.map(_.toInstant.toEpochMilli * s.labelCount)).sum / nLabels)
            )} else {
              (None, None)
            }
          avgImageCaptureDate = avgImageAge.map(age => Instant.ofEpochMilli(age).atOffset(ZoneOffset.UTC))
          avgLabelDate = avgLabelAge.map(age => Instant.ofEpochMilli(age).atOffset(ZoneOffset.UTC))

          assert(coverage <= 1.0)
        }
        AccessScoreNeighborhood(n.name, n.geom, n.regionId, coverage, accessScore, averagedStreetFeatures, significance, avgImageCaptureDate, avgLabelDate)
      }
      neighborhoodList
    }
  }

  /**
   * AccessScore:Street V2 (using new clustering methods).
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @return     The access score for the given neighborhood
   */
  def getAccessScoreStreetsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: ApiBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Retrieve data and cluster them by location and label type.
      streetAccessScores: Seq[AccessScoreStreet] <- computeAccessScoresForStreets(ApiType.Street, bbox)
    } yield {
      val baseFileName: String = s"accessScoreStreet_${OffsetDateTime.now()}"
      val streetsStream: Source[AccessScoreStreet, _] = Source.fromIterator(() => streetAccessScores.iterator)
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(streetsStream, AccessScoreStreet.csvHeader, inline = None, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(streetsStream, baseFileName, shapefileCreator.createStreetShapefile)
        case _ =>
          outputGeoJSON(streetsStream, inline = Some(true), filename = baseFileName + ".json")
      }
    }
  }

  /**
   * Retrieve streets in the given bounding box and corresponding attributes, then compute AccessScore for each street.
   * @param apiType
   * @param bbox
   */
  def computeAccessScoresForStreets(apiType: ApiType, bbox: ApiBBox): Future[Seq[AccessScoreStreet]] = {
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    // Get streets from db and set up attribute counter for the streets.
    apiService.selectStreetsIntersecting(apiType, bbox).flatMap { streets: Seq[StreetEdgeInfo] =>
      val streetAttCounts: mutable.Seq[(StreetEdgeInfo, StreetLabelCounter)] = streets.map { s =>
        (s, StreetLabelCounter(s.street.streetEdgeId, 0, 0, 0, 0, mutable.Map("CurbRamp" -> 0, "NoCurbRamp" -> 0, "Obstacle" -> 0, "SurfaceProblem" -> 0)))
      }.to(mutable.Seq)

      // Get attributes for the streets in batches and increment the counters based on those attributes.
      apiService.getAttributesInBoundingBox(apiType, bbox, None, DEFAULT_BATCH_SIZE)
        .runWith(Sink.foreach { attribute =>
          val street: StreetLabelCounter = streetAttCounts.filter(_._2.streetEdgeId == attribute.streetEdgeId).map(_._2).head
          street.nLabels += attribute.labelCount
          street.nImages += attribute.imageCount
          street.labelAgeSum += attribute.avgLabelDate.toInstant.toEpochMilli * attribute.labelCount
          street.imageAgeSum += attribute.avgImageCaptureDate.toInstant.toEpochMilli * attribute.imageCount
          if (street.labelCounter.contains(attribute.labelType)) street.labelCounter(attribute.labelType) += 1
        }).map { _ =>
        // Compute the access score and other stats for each street in parallel.
        val streetAccessScores: Seq[AccessScoreStreet] = streetAttCounts.toSeq.map { case (s, cnt) =>
          val (avgImageCaptureDate, avgLabelDate): (Option[OffsetDateTime], Option[OffsetDateTime]) =
            if (cnt.nLabels > 0 && cnt.nImages > 0) {(
              Some(Instant.ofEpochMilli(cnt.imageAgeSum / cnt.nImages).atOffset(ZoneOffset.UTC)),
              Some(Instant.ofEpochMilli(cnt.labelAgeSum / cnt.nLabels).atOffset(ZoneOffset.UTC))
            )} else {
              (None, None)
          }
          // Compute access score.
          val attributes: Array[Int] = Array(cnt.labelCounter("CurbRamp"), cnt.labelCounter("NoCurbRamp"), cnt.labelCounter("Obstacle"), cnt.labelCounter("SurfaceProblem"))
          val score: Double = computeAccessScore(attributes.map(_.toDouble), significance)
          AccessScoreStreet(s.street, s.osmId, s.regionId, score, s.auditCount, attributes, significance, avgImageCaptureDate, avgLabelDate, cnt.nImages, cnt.nLabels)
        }
        streetAccessScores
      }
    }
  }

  def computeAccessScore(attributes: Array[Double], significance: Array[Double]): Double = {
    val t: Double = (for ((f, s) <- (attributes zip significance)) yield f * s).sum  // dot product
    val s: Double = 1 / (1 + math.exp(-t))  // sigmoid function
    s
  }

  /**
  * v3 API: Returns all sidewalk labels within the specified parameters.
  * 
  * @param bbox Bounding box in format "minLon,minLat,maxLon,maxLat"
  * @param label_type Comma-separated list of label types to include
  * @param tag Comma-separated list of tags to filter by
  * @param min_severity Minimum severity score (1-5 scale)
  * @param max_severity Maximum severity score (1-5 scale)
  * @param validation_status Filter by validation status: "validated_correct", "validated_incorrect", "unvalidated"
  * @param start_date Start date for filtering (ISO 8601 format)
  * @param end_date End date for filtering (ISO 8601 format)
  * @param filetype Output format: "geojson" (default), "csv", "shapefile", "geopackage"
  * @param inline Whether to display the file inline or as an attachment
  */
  def getRawLabelsV3(
    bbox: Option[String],
    label_type: Option[String],
    tag: Option[String],
    min_severity: Option[Int],
    max_severity: Option[Int],
    validation_status: Option[String],
    start_date: Option[String],
    end_date: Option[String],
    filetype: Option[String],
    inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Parse bbox parameter
      val parsedBbox: Option[ApiBBox] = bbox.flatMap { b =>
        try {
          val parts = b.split(",").map(_.trim.toDouble)
          if (parts.length == 4) {
            Some(ApiBBox(
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
        ApiBBox(
          minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
          minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
          maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
          maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
        )
      )
      
      // Parse date strings to OffsetDateTime if provided
      val parsedStartDate = start_date.flatMap { s =>
        try {
          Some(OffsetDateTime.parse(s))
        } catch {
          case _: Exception => None
        }
      }
      
      val parsedEndDate = end_date.flatMap { e =>
        try {
          Some(OffsetDateTime.parse(e))
        } catch {
          case _: Exception => None
        }
      }
      
      // Parse comma-separated lists into sequences
      val parsedLabelTypes = label_type.map(_.split(",").map(_.trim).toSeq)
      val parsedTags = tag.map(_.split(",").map(_.trim).toSeq)
      
      // Map validation status to internal representation
      val validationStatusMapped = validation_status.map {
        case "validated_correct" => "Agreed"
        case "validated_incorrect" => "Disagreed"
        case "unvalidated" => "Unvalidated"
        case _ => null
      }
      
      // Create filters object
      val filters = RawLabelFilters(
        bbox = Some(apiBox),
        labelTypes = parsedLabelTypes,
        tags = parsedTags,
        minSeverity = min_severity,
        maxSeverity = max_severity,
        validationStatus = validationStatusMapped.filter(_ != null),
        startDate = parsedStartDate,
        endDate = parsedEndDate
      )
      
      // Get the data stream
      val dbDataStream: Source[LabelData, _] = apiService.getRawLabelsV3(filters, DEFAULT_BATCH_SIZE)
      val baseFileName: String = s"labels_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Handle error cases
      if (bbox.isDefined && parsedBbox.isEmpty) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid value for bbox parameter. Expected format: minLon,minLat,maxLon,maxLat.", "bbox")))
      } else if (validation_status.isDefined && validationStatusMapped.isEmpty) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid validation_status value. Must be one of: validated_correct, validated_incorrect, unvalidated", 
          "validation_status")))
      } else {
        // Output data in the appropriate file format
        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, LabelData.csvHeader, inline, baseFileName + ".csv")
          case Some("shapefile") =>
            outputShapefile(dbDataStream, baseFileName, shapefileCreator.createRawLabelShapeFile)
          case Some("geopackage") =>
            outputGeopackage(dbDataStream, baseFileName)
          case _ => // Default to GeoJSON
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
        }
      }
    }
  }
  
  /**
   * Returns all the raw labels within the bounding box in given file format.
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getRawLabels(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Set up streaming data from the database.
      val bbox: ApiBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val dbDataStream: Source[LabelAllMetadata, _] = apiService.getAllLabelMetadata(bbox, DEFAULT_BATCH_SIZE)
      val baseFileName: String = s"rawLabels_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, LabelAllMetadata.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createLabelAllMetadataShapeFile)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   * @param filetype One of "csv", "shapefile", or "geojson"
   */
  def getUsersApiStats(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getStatsForApi.map { userStats: Seq[UserStatApi] =>
      val baseFileName: String = s"userStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          val userStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(userStatsFile)
          writer.println(UserStatApi.csvHeader)
          userStats.foreach(userStat => writer.println(userStatToCSVRow(userStat)))
          writer.close()
          Ok.sendFile(content = userStatsFile, onClose = () => { userStatsFile.delete(); () })
        case _ =>
          Ok(Json.toJson(userStats.map(userStatToJson)))
      }
    }
  }

  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getOverallStatsForApi(filterLowQuality).map { stats: ProjectSidewalkStats =>
      val baseFileName: String = s"projectSidewalkStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(sidewalkStatsFile)

          writer.println(s"Launch Date, ${stats.launchDate}")
          writer.println(s"Recent Labels Average Timestamp, ${stats.avgTimestampLast100Labels}")
          writer.println(s"KM Explored,${stats.kmExplored}")
          writer.println(s"KM Explored Without Overlap,${stats.kmExploreNoOverlap}")
          writer.println(s"Total User Count,${stats.nUsers}")
          writer.println(s"Explorer User Count,${stats.nExplorers}")
          writer.println(s"Validate User Count,${stats.nValidators}")
          writer.println(s"Registered User Count,${stats.nRegistered}")
          writer.println(s"Anonymous User Count,${stats.nAnon}")
          writer.println(s"Turker User Count,${stats.nTurker}")
          writer.println(s"Researcher User Count,${stats.nResearcher}")
          writer.println(s"Total Label Count,${stats.nResearcher}")
          for ((labType, sevStats) <- stats.severityByLabelType) {
            writer.println(s"$labType Count,${sevStats.n}")
            writer.println(s"$labType Count With Severity,${sevStats.nWithSeverity}")
            writer.println(s"$labType Severity Mean,${sevStats.severityMean.map(_.toString).getOrElse("NA")}")
            writer.println(s"$labType Severity SD,${sevStats.severitySD.map(_.toString).getOrElse("NA")}")
          }
          writer.println(s"Total Validations,${stats.nValidations}")
          for ((labType, accStats) <- stats.accuracyByLabelType) {
            writer.println(s"$labType Labels Validated,${accStats.n}")
            writer.println(s"$labType Agreed Count,${accStats.nAgree}")
            writer.println(s"$labType Disagreed Count,${accStats.nDisagree}")
            writer.println(s"$labType Accuracy,${accStats.accuracy.map(_.toString).getOrElse("NA")}")
          }

          writer.close()
          Ok.sendFile(content = sidewalkStatsFile, onClose = () => { sidewalkStatsFile.delete(); () })
        case _ =>
          Ok(projectSidewalkStatsToJson(stats))
      }
    }
  }

  /**
   * Get metadata used for 2022 CV project for all labels, and output as JSON.
   * @param filetype One of "csv" or "json".
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getAllLabelMetadataForCV(filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    // Set up streaming data from the database.
    val dbDataStream: Source[LabelCVMetadata, _] = apiService.getLabelCVMetadata(DEFAULT_BATCH_SIZE)
    val baseFileName: String = s"labelsWithCVMetadata_${OffsetDateTime.now()}"
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

    // Output data in the appropriate file format: CSV or JSON (default).
    filetype match {
      case Some("csv") =>
        Future.successful(outputCSV(dbDataStream, LabelCVMetadata.csvHeader, inline, baseFileName + ".csv"))
      case _ =>
        Future.successful(outputJSON(dbDataStream, inline, baseFileName + ".json"))
    }
  }

  /**
   * Get the list of pano IDs in our database.
   */
  def getAllPanoIds = Action.async {
    gsvDataService.getAllPanosWithLabels.map { panos =>
      Ok(Json.toJson(panos.map(p => Json.toJson(p))))
    }
  }
}
