package controllers

import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import org.locationtech.jts.geom._
import controllers.APIType.APIType
import controllers.base._
import controllers.helper.ShapefilesCreatorHelper
import formats.json.APIFormats
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeWithLabelForAPI}
import models.utils.MapParams
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.apache.pekko.util.ByteString

import java.io.BufferedInputStream
import java.nio.file.Path
import play.api.http.ContentTypes
import play.api.i18n.Lang.logger
import play.api.mvc.AnyContent
import play.silhouette.api.actions.UserAwareRequest
import service.APIService
import service.utils.ConfigService

import java.sql.Timestamp
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.collection.parallel.CollectionConverters._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}
//import models.attribute.{ConfigTable, GlobalAttributeForAPI, GlobalAttributeTable, GlobalAttributeWithLabelForAPI, MapParams}
//import org.locationtech.jts.geom.{Coordinate => JTSCoordinate}

import math._
import models.region._
import models.label.{LabelTable, ProjectSidewalkStats}
import models.street.{StreetEdge, StreetEdgeInfo, StreetEdgeTable}
import models.user.SidewalkUserWithRole
import play.api.libs.json._
import play.api.libs.json.Json._

//import scala.collection.JavaConversions._ // TODO JavaConverters favored over JavaConversions in Scala >= 2.11
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.Future
//import helper.ShapefilesCreatorHelper
//import models.label.LabelTable.LabelAllMetadata

import java.io.File
import scala.collection.mutable

case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Long, regionId: Int, score: Double, auditCount: Int,
                             attributes: Array[Int], significance: Array[Double],
                             avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime],
                             imageCount: Int, labelCount: Int)

case class StreetLabelCounter(streetEdgeId: Int, var nLabels: Int, var nImages: Int, var labelAgeSum: Long,
                              var imageAgeSum: Long, labelCounter: mutable.Map[String, Int])

//case class NeighborhoodAttributeSignificance (name: String, geom: MultiPolygon, shapefileGeom: Array[JTSCoordinate],
//                                              regionID: Int, coverage: Double, score: Double,
//                                              attributeScores: Array[Double], significanceScores: Array[Double],
//                                              avgImageCaptureDate: Option[OffsetDateTime], avgLabelDate: Option[OffsetDateTime])

//case class StreetAttributeSignificance (geometry: Array[JTSCoordinate], streetID: Int, osmID: Long, regionID: Int,
//                                        score: Double, auditCount: Int, attributeScores: Array[Int],
//                                        significanceScores: Array[Double], avgImageCaptureDate: Option[OffsetDateTime],
//                                        avgLabelDate: Option[OffsetDateTime])

case class APIBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}

object APIType extends Enumeration {
  type APIType = Value
  val Neighborhood, Street, Attribute = Value
}

trait BatchableAPIType {
  def toJSON: JsObject
  def toCSVRow: String
}

@Singleton
class ProjectSidewalkAPIController @Inject()(cc: CustomControllerComponents,
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
   * Write data to a file in GeoJSON format, getting data in batches.
   * @param baseFileName
   * @param getBatch
   * @tparam A
   * @return
   */
//  def batchWriteJSON[A <: BatchableAPIType](baseFileName: String, getBatch: (Int, Int) => Future[Seq[A]]) = {
//    val jsonFile = new java.io.File(s"$baseFileName.json")
//    val writer = new java.io.PrintStream(jsonFile)
//    writer.print("""{"type":"FeatureCollection","features":[""")
//
//    var startIndex: Int = 0
//    val batchSize: Int = 20000
//    var moreWork: Boolean = true
//    while (moreWork) {
//      println("start batch")
//      // Fetch a batch of rows.
//      // TODO we REALLY need to fix this Await.result call. It's blocking the thread.
//      val features: Seq[JsObject] = Await.result(getBatch(startIndex, batchSize).map(_.map(_.toJSON)), 10.minutes)
//
//      println("batch done, rows = " + features.length)
//      // Write the batch to the file.
//      writer.print(features.map(_.toString).mkString(","))
//      startIndex += batchSize
//      if (features.length < batchSize) moreWork = false
//      else writer.print(",")
//    }
//    writer.print("]}")
//    writer.close()
//
//    jsonFile
//  }

  /**
   * Write data to a file in CSV format, getting data in batches.
   * @param baseFileName
   * @param getBatch
   * @tparam A
   * @return
   */
  def batchWriteCSV[A <: BatchableAPIType](baseFileName: String, getBatch: (Int, Int) => List[A], csvHeader: String) = {
    val file = new java.io.File(s"$baseFileName.csv")
    val writer = new java.io.PrintStream(file)
    // Write column headers.
    writer.println(csvHeader)

    var startIndex: Int = 0
    val batchSize: Int = 20000
    var moreWork: Boolean = true
    while (moreWork) {
      // Fetch a batch of rows.
      val rows: List[String] = getBatch(startIndex, batchSize).map(_.toCSVRow)

      // Write the batch to the file.
      writer.println(rows.mkString("\n"))
      startIndex += batchSize
      if (rows.length < batchSize) moreWork = false
    }
    writer.close()

    file
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

      filetype match {
        case Some("csv") =>
          val csvSource: Source[String, _] = dbDataStream
            .map(attribute => attribute.toCSVRow)
            .intersperse(GlobalAttributeWithLabelForAPI.csvHeader, "\n", "\n")

          Future.successful(
            Ok.chunked(csvSource, inline.getOrElse(false), Some(baseFileName + ".csv"))
              .as("text/csv").withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.csv")
          )

        case Some("shapefile") =>
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
          // Default to GeoJSON.
          val jsonSource: Source[String, _] = dbDataStream
            .map(attribute => attribute.toJSON.toString)
            .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

          Future.successful(
            Ok.chunked(jsonSource, inline.getOrElse(false), Some(baseFileName + ".json")).as(ContentTypes.JSON)
          )
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
      val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
        maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
      val baseFileName: String = s"attributes_${OffsetDateTime.now()}"

      // Set up streaming data from the database.
      val dbDataStream: Source[GlobalAttributeForAPI, _] =
        apiService.getAttributesInBoundingBox(APIType.Attribute, bbox, severity, batchSize = 10000)

      filetype match {
        case Some("csv") =>
          // TODO can these be simplified with the BatchableAPIType trait?
          val csvSource: Source[String, _] = dbDataStream
            .map(attribute => attribute.toCSVRow)
            .intersperse(GlobalAttributeForAPI.csvHeader, "\n", "\n")

          Ok.chunked(csvSource, inline.getOrElse(false), Some(baseFileName + ".csv"))
            .as("text/csv").withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.csv")

        case Some("shapefile") =>
          // Write attributes to the shapefile in batches.
          shapefileCreator.createAttributeShapeFile(dbDataStream, baseFileName, batchSize = 10000).map { zipPath =>
            // Zip the files and set up the buffered stream.
            val zipSource: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefiles(Seq(zipPath), baseFileName)
            Ok.chunked(zipSource).as("application/zip")
              .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
          }.getOrElse {
            InternalServerError("Failed to create shapefile")
          }

        case _ =>
          // Default to GeoJSON.
          // TODO can these be simplified with the BatchableAPIType trait?
          val jsonSource: Source[String, _] = dbDataStream
            .map(attribute => attribute.toJSON.toString)
            .intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

          Ok.chunked(jsonSource, inline.getOrElse(false), Some(baseFileName + ".json")).as(ContentTypes.JSON)
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
//  def getAccessScoreNeighborhoodsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)
//
//    val cityMapParams: MapParams = ConfigTable.getCityMapParams
//    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
//      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
//      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
//      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
//    val baseFileName: String = s"accessScoreNeighborhood_${Timestamp.from(Instant.now).toString.replaceAll(" ", "-")}"
//
//    // In CSV format.
//    if (filetype.isDefined && filetype.get == "csv") {
//      val neighborhoodList = computeAccessScoresForNeighborhoods(bbox)
//
//      val file = new java.io.File(s"$baseFileName.csv")
//      val writer = new java.io.PrintStream(file)
//      val header: String = "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
//        "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
//        "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
//        "Avg Label Date"
//      // Write the column headers.
//      writer.println(header)
//
//      // Write each row in the CSV.
//      neighborhoodList.foreach(n => writer.println(APIFormats.neighborhoodAttributeSignificanceToCSVRow(n)))
//
//      writer.close()
//      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
//    } else if (filetype.isDefined && filetype.get == "shapefile") {
//      val regions: List[NeighborhoodAttributeSignificance] = computeAccessScoresForNeighborhoods(bbox)
//      // Send the list of objects to the helper class.
//      ShapefilesCreatorHelper.createNeighborhoodShapefile(baseFileName, regions)
//      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(baseFileName))
//      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
//    } else {  // In GeoJSON format.
//
//      // Get AccessScore data and output in GeoJSON format.
//      def featureCollection = {
//        val neighborhoodsJson: List[JsObject] = computeAccessScoresForNeighborhoods(bbox).map(APIFormats.neighborhoodAttributeSignificanceToJson)
//
//        Json.obj("type" -> "FeatureCollection", "features" -> neighborhoodsJson)
//      }
//      Future.successful(Ok(featureCollection))
//    }
//  }

  /**
   * Computes AccessScore for every neighborhood in the given bounding box.
   *
   * @param bbox
   */
//  def computeAccessScoresForNeighborhoods(bbox: APIBBox): List[NeighborhoodAttributeSignificance] = {
//    // Gather all of the data we'll need.
//    val neighborhoods: List[Region] = RegionTable.getNeighborhoodsWithin(bbox)
//    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)
//
//    val streetAccessScores2: List[AccessScoreStreet] = computeAccessScoresForStreets(APIType.Neighborhood, bbox)
//    val auditedStreets: List[AccessScoreStreet] = streetAccessScores2.filter(_.auditCount > 0)
//
//    // Populate every object in the list.
//    val neighborhoodList: List[NeighborhoodAttributeSignificance] = neighborhoods.map { n =>
//      val coordinates: Array[JTSCoordinate] = n.geom.getCoordinates.map(c => new JTSCoordinate(c.x, c.y))
//      val auditedStreetsIntersecting: List[AccessScoreStreet] = auditedStreets.filter(_.regionId == n.regionId)
//      // Set default values for everything to 0, so null values will be 0 as well.
//      var coverage: Double = 0.0
//      var accessScore: Double = 0.0
//      var averagedStreetFeatures: Array[Double] = Array(0.0, 0.0, 0.0, 0.0, 0.0)
//      var avgImageCaptureDate: Option[Timestamp] = None
//      var avgLabelDate: Option[Timestamp] = None
//
//      if (auditedStreetsIntersecting.nonEmpty) {
//        averagedStreetFeatures = auditedStreetsIntersecting.map(_.attributes)
//          .transpose.map(_.sum.toDouble / auditedStreetsIntersecting.size).toArray
//        accessScore = computeAccessScore(averagedStreetFeatures, significance)
//        val streetsIntersecting: List[AccessScoreStreet] = streetAccessScores2.filter(_.regionId == n.regionId)
//        coverage = auditedStreetsIntersecting.size.toDouble / streetsIntersecting.size
//
//        // Compute average image & label age if there are any labels on the streets.
//        val nImages: Int = auditedStreetsIntersecting.map(s => s.imageCount).sum
//        val nLabels: Int = auditedStreetsIntersecting.map(s => s.labelCount).sum
//        val (avgImageAge, avgLabelAge): (Option[Long], Option[Long]) =
//          if (nImages > 0 && nLabels > 0) {(
//              Some(auditedStreetsIntersecting.flatMap(s => s.avgImageCaptureDate.map(_.getTime * s.imageCount)).sum / nImages),
//              Some(auditedStreetsIntersecting.flatMap(s => s.avgLabelDate.map(_.getTime * s.labelCount)).sum / nLabels)
//          )} else {
//            (None, None)
//          }
//        avgImageCaptureDate = avgImageAge.map(age => new Timestamp(age))
//        avgLabelDate = avgLabelAge.map(age => new Timestamp(age))
//
//        assert(coverage <= 1.0)
//      }
//      NeighborhoodAttributeSignificance(n.name, n.geom, coordinates, n.regionId,
//        coverage, accessScore, averagedStreetFeatures, significance, avgImageCaptureDate, avgLabelDate)
//    }
//    neighborhoodList
//  }

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
      bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
        maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
        maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))

      // Retrieve data and cluster them by location and label type.
      streetAccessScores: Seq[AccessScoreStreet] <- computeAccessScoresForStreets(APIType.Street, bbox)
    } yield {
      val baseFileName: String = s"accessScoreStreet_${Timestamp.from(Instant.now).toString.replaceAll(" ", "-")}"

      // In CSV format.
      if (filetype.isDefined && filetype.get == "csv") {
        val header: String = "Street ID,OSM ID,Neighborhood ID,Access Score,Coordinates,Audit Count," +
          "Avg Curb Ramp Score,Avg No Curb Ramp Score,Avg Obstacle Score,Avg Surface Problem Score," +
          "Curb Ramp Significance,No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance," +
          "Avg Image Capture Date,Avg Label Date\n"

        val csvSource: Source[String, _] = Source.fromIterator(() =>
          streetAccessScores.iterator.map(APIFormats.accessScoreStreetToCSVRow)
        ).intersperse(header, "\n", "\n")

        Ok.chunked(csvSource, inline = false, Some(baseFileName + ".csv"))
          .as("text/csv").withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.csv")

      } else if (filetype.isDefined && filetype.get == "shapefile") {
        // Write streets to the shapefile in batches.
        val streetsStream: Source[AccessScoreStreet, _] = Source.fromIterator(() => streetAccessScores.iterator)
        shapefileCreator.createStreetShapefile(streetsStream, baseFileName, batchSize = 10000).map { zipPath =>
          // Zip the files and set up the buffered stream.
          val zipSource: Source[ByteString, Future[Boolean]] = shapefileCreator.zipShapefiles(Seq(zipPath), baseFileName)
          Ok.chunked(zipSource).as("application/zip")
            .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=$baseFileName.zip")
        }.getOrElse {
          InternalServerError("Failed to create shapefile")
        }
      } else {
        // Default to GeoJSON.
        val jsonSource: Source[String, _] = Source.fromIterator(() =>
          streetAccessScores.iterator.map(APIFormats.accessScoreStreetToCSVRow)
        ).intersperse("""{"type":"FeatureCollection","features":[""", ",", "]}")

        Ok.chunked(jsonSource, inline = false, Some(baseFileName + ".json")).as(ContentTypes.JSON)
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
//  def getRawLabels(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)
//
//    // Set up necessary params.
//    val cityMapParams: MapParams = ConfigTable.getCityMapParams
//    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
//      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
//      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
//      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
//    val baseFileName: String = s"rawLabels_${Timestamp.from(Instant.now).toString.replaceAll(" ", "-")}"
//    def getBatchOfLabels(startIndex: Int, batchSize: Int): List[LabelAllMetadata] = {
//      LabelTable.getAllLabelMetadata(bbox, Some(startIndex), Some(batchSize))
//    }
//
//    // Write to file in appropriate format.
//    if (filetype.isDefined && filetype.get == "csv") {
//      val csvHeader: String = LabelAllMetadata.csvHeader
//      val file: File = batchWriteCSV(baseFileName, getBatchOfLabels, csvHeader)
//      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
//    } else if (filetype.isDefined && filetype.get == "shapefile") {
//      ShapefilesCreatorHelper.createRawLabelShapeFile(baseFileName, bbox)
//      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(baseFileName))
//      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
//    } else {
//      val labelsJsonFile: File = batchWriteJSON(baseFileName, getBatchOfLabels)
//      Future.successful(Ok.sendFile(content = labelsJsonFile, inline = inline.getOrElse(false), onClose = () => labelsJsonFile.delete()))
//    }
//  }

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   *
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @return
   */
//  def getUsersAPIStats(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    apiLogging(request.remoteAddress, request.identity, request.toString)
//    val baseFileName: String = s"userStats_${Timestamp.from(Instant.now).toString.replaceAll(" ", "-")}"
//    // In CSV format.
//    if (filetype.isDefined && filetype.get == "csv") {
//      val userStatsFile = new java.io.File(s"$baseFileName.csv")
//      val writer = new java.io.PrintStream(userStatsFile)
//      // Write column headers.
//      val header: String = "User ID,Labels,Meters Explored,Labels per Meter,High Quality,High Quality Manual," +
//        "Label Accuracy,Validated Labels,Validations Received,Labels Validated Correct,Labels Validated Incorrect," +
//        "Labels Not Validated,Validations Given,Dissenting Validations Given,Agree Validations Given," +
//        "Disagree Validations Given,Unsure Validations Given,Curb Ramp Labels,Curb Ramps Validated Correct," +
//        "Curb Ramps Validated Incorrect,Curb Ramps Not Validated,No Curb Ramp Labels,No Curb Ramps Validated Correct," +
//        "No Curb Ramps Validated Incorrect,No Curb Ramps Not Validated,Obstacle Labels,Obstacles Validated Correct," +
//        "Obstacles Validated Incorrect,Obstacles Not Validated,Surface Problem Labels," +
//        "Surface Problems Validated Correct,Surface Problems Validated Incorrect,Surface Problems Not Validated," +
//        "No Sidewalk Labels,No Sidewalks Validated Correct,No Sidewalks Validated Incorrect," +
//        "No Sidewalks Not Validated,Crosswalk Labels,Crosswalks Validated Correct,Crosswalks Validated Incorrect," +
//        "Crosswalks Not Validated,Pedestrian Signal Labels,Pedestrian Signals Validated Correct," +
//        "Pedestrian Signals Validated Incorrect,Pedestrian Signals Not Validated,Cant See Sidewalk Labels," +
//        "Cant See Sidewalks Validated Correct,Cant See Sidewalks Validated Incorrect," +
//        "Cant See Sidewalks Not Validated,Other Labels,Others Validated Correct,Others Validated Incorrect," +
//        "Others Not Validated"
//      writer.println(header)
//      // Write each row in the CSV.
//      for (current <- UserStatTable.getStatsForAPI) {
//        writer.println(APIFormats.userStatToCSVRow(current))
//      }
//      writer.close()
//      Future.successful(Ok.sendFile(content = userStatsFile, onClose = () => userStatsFile.delete()))
//    } else { // In JSON format.
//      Future.successful(Ok(Json.toJson(UserStatTable.getStatsForAPI.map(APIFormats.userStatToJson))))
//    }
//  }

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
