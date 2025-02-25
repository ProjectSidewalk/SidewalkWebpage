package controllers

import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import org.locationtech.jts.geom._
import controllers.APIType.APIType
import controllers.base._
import controllers.helper.ShapefilesCreatorHelper
import formats.json.APIFormats
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeWithLabelForAPI}
import models.label.LabelAllMetadata
import models.utils.MapParams
import models.region._
import models.street.{StreetEdge, StreetEdgeInfo}
import models.user.UserStatAPI
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.apache.pekko.util.ByteString

import java.nio.file.Path
import play.api.http.ContentTypes
import play.api.i18n.Lang.logger
import play.api.mvc.{AnyContent, Result}
import play.api.libs.json._
import play.silhouette.api.actions.UserAwareRequest
import service.APIService
import service.utils.ConfigService

import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.Future
import scala.collection.mutable
import math._

object APIType extends Enumeration {
  type APIType = Value
  val Neighborhood, Street, Attribute = Value
}

trait StreamingAPIType {
  def toJSON: JsObject
  def toCSVRow: String
  // Most likely also has an associated create<type>ShapeFile() method to call on a stream of data of the type.
}

case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Long, regionId: Int, score: Double, auditCount: Int,
                             attributes: Array[Int], significance: Array[Double],
                             avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime],
                             imageCount: Int, labelCount: Int) extends StreamingAPIType {
  def toJSON: JsObject = APIFormats.accessScoreStreetToJSON(this)
  def toCSVRow: String = APIFormats.accessScoreStreetToCSVRow(this)
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
                                   avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime]) extends StreamingAPIType {
  def toJSON: JsObject = APIFormats.accessScoreNeighborhoodToJson(this)
  def toCSVRow: String = APIFormats.accessScoreNeighborhoodToCSVRow(this)
}
object AccessScoreNeighborhood {
  val csvHeader: String = "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
    "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
    "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
    "Avg Label Date\n"
}

case class APIBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}

@Singleton
class APIController @Inject()(cc: CustomControllerComponents,
                              val silhouette: Silhouette[DefaultEnv],
                              apiService: APIService,
                              configService: ConfigService,
                              shapefileCreator: ShapefilesCreatorHelper
                             )(implicit ec: ExecutionContext, mat: Materializer, assets: AssetsFinder) extends CustomBaseController(cc) {

  /**
    * Adds an entry to the webpage_activity table with the endpoint used.
    *
    * @param remoteAddress  The remote address that made the API call.
    * @param identity       The user that made the API call. If no user is signed in, the value is None.
    * @param requestStr     The full request sent by the API call.
    */
//  def apiLogging(remoteAddress: String, identity: Option[User], requestStr: String) = {
//    if (remoteAddress != "0:0:0:0:0:0:0:1") {
//      val timestamp: OffsetDateTime = OffsetDateTime.now
//      val ipAddress: String = remoteAddress
//      identity match {
//        case Some(user) =>
//          cc.loggingService.insert(WebpageActivity(0, user.userId.toString, ipAddress, requestStr, timestamp))
//        case None =>
//          val anonymousUser: DBUser = UserTable.find("anonymous").get
//          cc.loggingService.insert(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, requestStr, timestamp))
//      }
//    }
//  }

  /**
   * Creates a bounding box from the given latitudes and longitudes. Use default values from city if any None.
   */
  def createBBox(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], defaultMapParams: MapParams): APIBBox = {
    APIBBox(minLat = min(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      minLng = min(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2)),
      maxLat = max(lat1.getOrElse(defaultMapParams.lat1), lat2.getOrElse(defaultMapParams.lat2)),
      maxLng = max(lng1.getOrElse(defaultMapParams.lng1), lng2.getOrElse(defaultMapParams.lng2)))
  }

  /**
   * Creates and streams a CSV file from the given data stream.
   */
  private def outputCSV[A <: StreamingAPIType](dbDataStream: Source[A, _], csvHeader: String, inline: Option[Boolean], filename: String): Result = {
    val csvSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toCSVRow)
      .intersperse(csvHeader, "\n", "\n")

    Ok.chunked(csvSource, inline.getOrElse(false), Some(filename))
      .as("text/csv").withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$filename")
  }

  /**
   * Creates and streams a GeoJSON file from the given data stream.
   */
  private def outputGeoJSON[A <: StreamingAPIType](dbDataStream: Source[A, _], inline: Option[Boolean], filename: String): Result = {
    val jsonSource: Source[String, _] = dbDataStream
      .map(attribute => attribute.toJSON.toString)
      .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

    Ok.chunked(jsonSource, inline.getOrElse(false), Some(filename)).as(ContentTypes.JSON)
  }

  /**
   * Creates and streams a zipped Shapefile file from the given data stream.
   */
  private def outputShapefile[A <: StreamingAPIType](dbDataStream: Source[A, _], baseFileName: String,
                                                     createShapefile: (Source[A, _], String, Int) => Option[Path]): Result = {
    // Write data to the shapefile in batches.
    createShapefile(dbDataStream, baseFileName, 10000).map { zipPath =>
      // Zip the files and set up the buffered stream.
      val zipSource: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefiles(Seq(zipPath), baseFileName)
      Ok.chunked(zipSource).as("application/zip")
        .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
    }.getOrElse {
      InternalServerError("Failed to create shapefile")
    }
  }

  /**
    * Returns all global attributes within bounding box and the labels that make up those attributes.
    *
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param severity Optional severity level to filter by
    * @param filetype One of "csv", "shapefile", or "geojson"
    * @param inline
    * @return
    */
  def getAccessAttributesWithLabelsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                                      severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)
    configService.getCityMapParams.flatMap { cityMapParams =>
      val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
        maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
      val timeStr: String = OffsetDateTime.now().toString
      val baseFileName: String = s"attributesWithLabels_$timeStr"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeWithLabelForAPI, _] =
        apiService.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, batchSize = 10000)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          Future.successful(
            outputCSV(dbDataStream, GlobalAttributeWithLabelForAPI.csvHeader, inline, baseFileName + ".csv")
          )

        case Some("shapefile") =>
          // We aren't using the same shapefile output method as we do for other APIs because we are creating two
          // separate shapefiles and zipping them together.

          // Get a separate attributes data stream as well for Shapefiles.
          val attributesDataStream: Source[GlobalAttributeForAPI, _] =
            apiService.getAttributesInBoundingBox(APIType.Attribute, bbox, severity, batchSize = 10000)

          val futureResults: Future[(Path, Path)] = Future.sequence(Seq(
            Future { shapefileCreator.createAttributeShapeFile(attributesDataStream, s"attributes_$timeStr", batchSize = 10000).get },
            Future { shapefileCreator.createLabelShapeFile(dbDataStream, s"labels_$timeStr", batchSize = 10000).get }
          )).recover {
            case e: Exception =>
              logger.error("Error creating shapefiles", e)
              throw e
          }.map { case Seq(attributePath, labelPath) => (attributePath, labelPath) } // Put them into a tuple.

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
    *
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param severity Optional severity level to filter by.
    * @param filetype One of "csv", "shapefile", or "geojson"
    * @param inline
    * @return
    */
  def getAccessAttributesV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], severity: Option[String],
                            filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)

    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      val bbox: APIBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val baseFileName: String = s"attributes_${OffsetDateTime.now()}"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeForAPI, _] =
        apiService.getAttributesInBoundingBox(APIType.Attribute, bbox, severity, batchSize = 10000)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, GlobalAttributeForAPI.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createAttributeShapeFile)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }

  /**
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param filetype One of "csv", "shapefile", or "geojson"
    * @return
    */
  def getAccessScoreNeighborhoodsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)

    for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: APIBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Retrieve data and cluster them by location and label type.
      neighborhoodAccessScores: Seq[AccessScoreNeighborhood] <- computeAccessScoresForNeighborhoods(bbox)
    } yield {
      val baseFileName: String = s"accessScoreNeighborhood_${OffsetDateTime.now()}"
      val neighborhoodStream: Source[AccessScoreNeighborhood, _] = Source.fromIterator(() => neighborhoodAccessScores.iterator)

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
   *
   * @param bbox
   */
  def computeAccessScoresForNeighborhoods(bbox: APIBBox): Future[Seq[AccessScoreNeighborhood]] = {
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    for {
      neighborhoods: Seq[Region] <- apiService.getNeighborhoodsWithin(bbox)
      streetAccessScores: Seq[AccessScoreStreet] <- computeAccessScoresForStreets(APIType.Neighborhood, bbox)
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
    * AccessScore:Street V2 (using new clustering methods)
    *
    * @param lat1 First latitude value for the bounding box
    * @param lng1 First longitude value for the bounding box
    * @param lat2 Second latitude value for the bounding box
    * @param lng2 Second longitude value for the bounding box
    * @param filetype One of "csv", "shapefile", or "geojson"
    * @return     The access score for the given neighborhood
    */
  def getAccessScoreStreetsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)

    for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: APIBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Retrieve data and cluster them by location and label type.
      streetAccessScores: Seq[AccessScoreStreet] <- computeAccessScoresForStreets(APIType.Street, bbox)
    } yield {
      val baseFileName: String = s"accessScoreStreet_${OffsetDateTime.now()}"
      val streetsStream: Source[AccessScoreStreet, _] = Source.fromIterator(() => streetAccessScores.iterator)

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
   *
   * @param apiType
   * @param bbox
   *
   */
  def computeAccessScoresForStreets(apiType: APIType, bbox: APIBBox): Future[Seq[AccessScoreStreet]] = {
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    // Get streets from db and set up attribute counter for the streets.
    apiService.selectStreetsIntersecting(apiType, bbox).flatMap { streets: Seq[StreetEdgeInfo] =>
      val streetAttCounts: mutable.Seq[(StreetEdgeInfo, StreetLabelCounter)] = streets.map { s =>
        (s, StreetLabelCounter(s.street.streetEdgeId, 0, 0, 0, 0, mutable.Map("CurbRamp" -> 0, "NoCurbRamp" -> 0, "Obstacle" -> 0, "SurfaceProblem" -> 0)))
      }.to(mutable.Seq)

      // Get attributes for the streets in batches and increment the counters based on those attributes.
      apiService.getAttributesInBoundingBox(apiType, bbox, None, batchSize = 10000)
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
   * Returns all the raw labels within the bounding box in given file format.
   * @param lat1
   * @param lng1
   * @param lat2
   * @param lng2
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @param inline
   * @return
   */
  def getRawLabels(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)

    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Set up streaming data from the database.
      val bbox: APIBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val dbDataStream: Source[LabelAllMetadata, _] = apiService.getAllLabelMetadata(bbox, batchSize = 10000)
      val baseFileName: String = s"rawLabels_${OffsetDateTime.now()}"

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, LabelAllMetadata.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createRawLabelShapeFile)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   *
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @return
   */
  def getUsersAPIStats(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)

    apiService.getStatsForAPI.map { userStats: Seq[UserStatAPI] =>
      val baseFileName: String = s"userStats_${OffsetDateTime.now()}"

      // Output data in the appropriate file format: CSV, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          val userStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(userStatsFile)
          writer.println(UserStatAPI.csvHeader)
          userStats.foreach(userStat => writer.println(APIFormats.userStatToCSVRow(userStat)))
          writer.close()
          Ok.sendFile(content = userStatsFile, onClose = () => userStatsFile.delete())
        case _ =>
          Ok(Json.toJson(userStats.map(APIFormats.userStatToJson)))
      }
    }
  }

//  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)
//    val baseFileName: String = s"projectSidewalkStats_${Timestamp.from(Instant.now).toString.replaceAll(" ", "-")}"
//    // In CSV format.
//    if (filetype.isDefined && filetype.get == "csv") {
//      val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
//      val writer = new java.io.PrintStream(sidewalkStatsFile)
//
//      val stats: ProjectSidewalkStats = LabelTable.getOverallStatsForAPI(filterLowQuality)
//      writer.println(s"Launch Date, ${stats.launchDate}")
//      writer.println(s"Recent Labels Average Timestamp, ${stats.avgTimestampLast100Labels}")
//      writer.println(s"KM Explored,${stats.kmExplored}")
//      writer.println(s"KM Explored Without Overlap,${stats.kmExploreNoOverlap}")
//      writer.println(s"Total User Count,${stats.nUsers}")
//      writer.println(s"Explorer User Count,${stats.nExplorers}")
//      writer.println(s"Validate User Count,${stats.nValidators}")
//      writer.println(s"Registered User Count,${stats.nRegistered}")
//      writer.println(s"Anonymous User Count,${stats.nAnon}")
//      writer.println(s"Turker User Count,${stats.nTurker}")
//      writer.println(s"Researcher User Count,${stats.nResearcher}")
//      writer.println(s"Total Label Count,${stats.nResearcher}")
//      for ((labType, sevStats) <- stats.severityByLabelType) {
//        writer.println(s"$labType Count,${sevStats.n}")
//        writer.println(s"$labType Count With Severity,${sevStats.nWithSeverity}")
//        writer.println(s"$labType Severity Mean,${sevStats.severityMean.map(_.toString).getOrElse("NA")}")
//        writer.println(s"$labType Severity SD,${sevStats.severitySD.map(_.toString).getOrElse("NA")}")
//      }
//      writer.println(s"Total Validations,${stats.nValidations}")
//      for ((labType, accStats) <- stats.accuracyByLabelType) {
//        writer.println(s"$labType Labels Validated,${accStats.n}")
//        writer.println(s"$labType Agreed Count,${accStats.nAgree}")
//        writer.println(s"$labType Disagreed Count,${accStats.nDisagree}")
//        writer.println(s"$labType Accuracy,${accStats.accuracy.map(_.toString).getOrElse("NA")}")
//      }
//
//      writer.close()
//      Future.successful(Ok.sendFile(content = sidewalkStatsFile, onClose = () => sidewalkStatsFile.delete()))
//    } else { // In JSON format.
//      Future.successful(Ok(APIFormats.projectSidewalkStatsToJson(LabelTable.getOverallStatsForAPI(filterLowQuality))))
//    }
//  }
}
