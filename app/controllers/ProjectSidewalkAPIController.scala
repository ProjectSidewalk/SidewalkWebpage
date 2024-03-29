package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.APIType.APIType
import controllers.headers.ProvidesHeader
import formats.json.APIFormats
import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import models.attribute.{ConfigTable, GlobalAttributeForAPI, GlobalAttributeTable, MapParams}
import org.locationtech.jts.geom.{Coordinate => JTSCoordinate}
import math._
import models.region._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, ProjectSidewalkStats}
import models.street.{StreetEdge, StreetEdgeInfo, StreetEdgeTable}
import models.user.{User, UserStatTable, WebpageActivity, WebpageActivityTable}
import play.api.libs.json._
import play.api.libs.json.Json._
import scala.collection.JavaConversions._
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.Future
import helper.ShapefilesCreatorHelper
import scala.collection.mutable

case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Long, regionId: Int, score: Double, auditCount: Int,
                             attributes: Array[Int], significance: Array[Double],
                             avgImageCaptureDate: Option[Timestamp], avgLabelDate: Option[Timestamp], imageCount: Int,
                             labelCount: Int)

case class StreetLabelCounter(streetEdgeId: Int, var nLabels: Int, var nImages: Int, var labelAgeSum: Double,
                              var imageAgeSum: Double, labelCounter: mutable.Map[String, Int])

case class NeighborhoodAttributeSignificance (val name: String,
                                              val geom: MultiPolygon,
                                              val shapefileGeom: Array[JTSCoordinate],
                                              val regionID: Int,
                                              val coverage: Double,
                                              val score: Double,
                                              val attributeScores: Array[Double],
                                              val significanceScores: Array[Double],
                                              val avgImageCaptureDate: Option[Timestamp],
                                              val avgLabelDate: Option[Timestamp])

case class StreetAttributeSignificance (val geometry: Array[JTSCoordinate],
                                        val streetID: Int,
                                        val osmID: Long,
                                        val regionID: Int,
                                        val score: Double,
                                        val auditCount: Int,
                                        val attributeScores: Array[Int],
                                        val significanceScores: Array[Double],
                                        val avgImageCaptureDate: Option[Timestamp],
                                        val avgLabelDate: Option[Timestamp])

case class APIBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}

object APIType extends Enumeration {
  type APIType = Value
  val Neighborhood, Street, Attribute = Value
}

/**
 * Holds the HTTP requests associated with API.
 *
 * @param env The Silhouette environment.
 */
class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  /**
    * Adds an entry to the webpage_activity table with the endpoint used.
    *
    * @param remoteAddress  The remote address that made the API call.
    * @param identity       The user that made the API call. If no user is signed in, the value is None.
    * @param requestStr     The full request sent by the API call.
    */
  def apiLogging(remoteAddress: String, identity: Option[User], requestStr: String) = {
    if (remoteAddress != "0:0:0:0:0:0:0:1") {
      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
      val ipAddress: String = remoteAddress
      identity match {
        case Some(user) =>
          WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, requestStr, timestamp))
        case None =>
          val anonymousUser: DBUser = UserTable.find("anonymous").get
          WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, requestStr, timestamp))
      }
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
                                      severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
    val timeStr: String = new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")
    val baseFileName: String = s"attributesWithLabels_$timeStr"

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Attribute ID,Label Type,Attribute Severity,Attribute Temporary,Street ID,OSM Street ID," +
        "Neighborhood Name,Label ID,Panorama ID,Attribute Latitude,Attribute Longitude,Label Latitude," +
        "Label Longitude,Heading,Pitch,Zoom,Canvas X,Canvas Y,Canvas Width,Canvas Height,GSV URL,Image Capture Date," +
        "Label Date,Label Severity,Label Temporary,Agree Count,Disagree Count,Not Sure Count,Label Tags," +
        "Label Description,User ID"

      // Write column headers.
      writer.println(header)
      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        // Fetch a batch of rows.
        val rows: List[String] =
          GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, Some(startIndex), Some(batchSize))
          .map(APIFormats.globalAttributeWithLabelToCSVRow)

        // Write the batch to the file.
        writer.println(rows.mkString("\n"))

        startIndex += batchSize
        if (rows.length < batchSize) moreWork = false
      }
      writer.print("]}")
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      ShapefilesCreatorHelper.createAttributeShapeFile(s"attributes_$timeStr", bbox, severity)
      ShapefilesCreatorHelper.createLabelShapeFile(s"labels_$timeStr", bbox, severity)

      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(s"attributes_$timeStr", s"labels_$timeStr"))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {
      // In GeoJSON format. Writing 10k objects to a file at a time to reduce server memory usage and crashes.
      val attributesJsonFile = new java.io.File(s"$baseFileName.json")
      val writer = new java.io.PrintStream(attributesJsonFile)
      writer.print("""{"type":"FeatureCollection","features":[""")

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        val features: List[JsObject] =
          GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, Some(startIndex), Some(batchSize))
            .map(APIFormats.globalAttributeWithLabelToJSON)
        writer.print(features.map(_.toString).mkString(","))
        startIndex += batchSize
        if (features.length < batchSize) moreWork = false
        else writer.print(",")
      }
      writer.print("]}")
      writer.close()

      Future.successful(Ok.sendFile(content = attributesJsonFile, inline = inline.getOrElse(false), onClose = () => attributesJsonFile.delete()))
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
  def getAccessAttributesV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                            severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
    val baseFileName: String = s"attributes_${new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")}"

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      //Writing 10k objects to a file
      val file = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(file)
      // Write column headers.
      writer.println("Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Attribute Latitude,Attribute Longitude,Avg Image Capture Date,Avg Label Date,Severity,Temporary,Agree Count,Disagree Count,Not Sure Count,Cluster Size,User IDs")
      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        // Fetch a batch of rows.
        val rows: List[String] =
          GlobalAttributeTable.getGlobalAttributesInBoundingBox(APIType.Attribute, bbox, severity, Some(startIndex), Some(batchSize))
          .map(APIFormats.globalAttributeToCSVRow)

        // Write the batch to the file.
        writer.println(rows.mkString("\n"))
        startIndex += batchSize
        if (rows.length < batchSize) moreWork = false
      }
      writer.print("]}")
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      ShapefilesCreatorHelper.createAttributeShapeFile(baseFileName, bbox, severity)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(baseFileName))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {
      // In GeoJSON format. Writing 10k objects to a file at a time to reduce server memory usage and crashes.
      val attributesJsonFile = new java.io.File(s"$baseFileName.json")
      val writer = new java.io.PrintStream(attributesJsonFile)
      writer.print("""{"type":"FeatureCollection","features":[""")

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        val features: List[JsObject] =
          GlobalAttributeTable.getGlobalAttributesInBoundingBox(APIType.Attribute, bbox, severity, Some(startIndex), Some(batchSize))
            .map(APIFormats.globalAttributeToJSON)
        writer.print(features.map(_.toString).mkString(","))
        startIndex += batchSize
        if (features.length < batchSize) moreWork = false
        else writer.print(",")
      }
      writer.print("]}")
      writer.close()

      Future.successful(Ok.sendFile(content = attributesJsonFile, inline = inline.getOrElse(false), onClose = () => attributesJsonFile.delete()))
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
  def getAccessScoreNeighborhoodsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                                    filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
    val baseFileName: String = s"accessScoreNeighborhood_${new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")}"

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val neighborhoodList = computeAccessScoresForNeighborhoods(bbox)

      val file = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
        "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
        "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
        "Avg Label Date"
      // Write the column headers.
      writer.println(header)

      // Write each row in the CSV.
      neighborhoodList.foreach(n => writer.println(APIFormats.neighborhoodAttributeSignificanceToCSVRow(n)))

      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      val regions: List[NeighborhoodAttributeSignificance] = computeAccessScoresForNeighborhoods(bbox)
      // Send the list of objects to the helper class.
      ShapefilesCreatorHelper.createNeighborhoodShapefile(baseFileName, regions)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(baseFileName))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {  // In GeoJSON format.

      // Get AccessScore data and output in GeoJSON format.
      def featureCollection = {
        val neighborhoodsJson: List[JsObject] = computeAccessScoresForNeighborhoods(bbox).map(APIFormats.neighborhoodAttributeSignificanceToJson)

        Json.obj("type" -> "FeatureCollection", "features" -> neighborhoodsJson)
      }
      Future.successful(Ok(featureCollection))
    }
  }

  /**
   * Computes AccessScore for every neighborhood in the given bounding box.
   *
   * @param bbox
   */
  def computeAccessScoresForNeighborhoods(bbox: APIBBox): List[NeighborhoodAttributeSignificance] = {
    // Gather all of the data we'll need.
    val neighborhoods: List[Region] = RegionTable.getNeighborhoodsWithin(bbox)
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    val streetAccessScores2: List[AccessScoreStreet] = computeAccessScoresForStreets(APIType.Neighborhood, bbox)
    val auditedStreets: List[AccessScoreStreet] = streetAccessScores2.filter(_.auditCount > 0)

    // Populate every object in the list.
    val neighborhoodList: List[NeighborhoodAttributeSignificance] = neighborhoods.map { n =>
      val coordinates: Array[JTSCoordinate] = n.geom.getCoordinates.map(c => new JTSCoordinate(c.x, c.y))
      val auditedStreetsIntersecting: List[AccessScoreStreet] = auditedStreets.filter(_.regionId == n.regionId)
      // Set default values for everything to 0, so null values will be 0 as well.
      var coverage: Double = 0.0
      var accessScore: Double = 0.0
      var averagedStreetFeatures: Array[Double] = Array(0.0, 0.0, 0.0, 0.0, 0.0)
      var avgImageCaptureDate: Option[Timestamp] = None
      var avgLabelDate: Option[Timestamp] = None

      if (auditedStreetsIntersecting.nonEmpty) {
        averagedStreetFeatures = auditedStreetsIntersecting.map(_.attributes)
          .transpose.map(_.sum.toDouble / auditedStreetsIntersecting.size).toArray
        accessScore = computeAccessScore(averagedStreetFeatures, significance)
        val streetsIntersecting: List[AccessScoreStreet] = streetAccessScores2.filter(_.regionId == n.regionId)
        coverage = auditedStreetsIntersecting.size.toDouble / streetsIntersecting.size

        // Compute average image & label age if there are any labels on the streets.
        val nImages: Int = auditedStreetsIntersecting.map(s => s.imageCount).sum
        val nLabels: Int = auditedStreetsIntersecting.map(s => s.labelCount).sum
        val (avgImageAge, avgLabelAge): (Option[Long], Option[Long]) =
          if (nImages > 0 && nLabels > 0) {(
              Some(auditedStreetsIntersecting.flatMap(s => s.avgImageCaptureDate.map(_.getTime * s.imageCount)).sum / nImages),
              Some(auditedStreetsIntersecting.flatMap(s => s.avgLabelDate.map(_.getTime * s.labelCount)).sum / nLabels)
          )} else {
            (None, None)
          }
        avgImageCaptureDate = avgImageAge.map(age => new Timestamp(age))
        avgLabelDate = avgLabelAge.map(age => new Timestamp(age))

        assert(coverage <= 1.0)
      }
      NeighborhoodAttributeSignificance(n.name, n.geom, coordinates, n.regionId,
        coverage, accessScore, averagedStreetFeatures, significance, avgImageCaptureDate, avgLabelDate)
    }
    neighborhoodList
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
  def getAccessScoreStreetsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))
    val baseFileName: String = s"accessScoreStreet_${new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")}"

    // Retrieve data and cluster them by location and label type.
    val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(APIType.Street, bbox)

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Street ID,OSM ID,Neighborhood ID,Access Score,Coordinates,Audit Count," +
        "Avg Curb Ramp Score,Avg No Curb Ramp Score,Avg Obstacle Score,Avg Surface Problem Score," +
        "Curb Ramp Significance,No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance," +
        "Avg Image Capture Date,Avg Label Date"
      // Write column headers.
      writer.println(header)
      // Write each row in the CSV.
      for (streetAccessScore <- streetAccessScores) {
        writer.println(APIFormats.accessScoreStreetToCSVRow(streetAccessScore))
      }
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      val streetBuffer: mutable.Buffer[StreetAttributeSignificance] = new ArrayBuffer[StreetAttributeSignificance]
      for (streetAccessScore <- streetAccessScores) {
        streetBuffer.add(
          StreetAttributeSignificance(
            streetAccessScore.streetEdge.geom.getCoordinates().map(c => new JTSCoordinate(c.x, c.y)),
            streetAccessScore.streetEdge.streetEdgeId,
            streetAccessScore.osmId,
            streetAccessScore.regionId,
            streetAccessScore.score,
            streetAccessScore.auditCount,
            streetAccessScore.attributes,
            streetAccessScore.significance,
            streetAccessScore.avgImageCaptureDate,
            streetAccessScore.avgLabelDate))
      }
      ShapefilesCreatorHelper.createStreetShapefile(baseFileName, streetBuffer)

      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array.apply(baseFileName))

      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {  // In GeoJSON format.
      val features: List[JsObject] = streetAccessScores.map(APIFormats.accessScoreStreetToJSON)
      Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
    }
  }

  /**
   * Retrieve streets in the given bounding box and corresponding labels for each street.
   *
   * @param apiType
   * @param bbox
   *
   */
  def computeAccessScoresForStreets(apiType: APIType, bbox: APIBBox): List[AccessScoreStreet] = {
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    // Get streets and set up attribute counter for the streets.
    val streets: List[StreetEdgeInfo] = StreetEdgeTable.selectStreetsIntersecting(apiType, bbox)
    val streetAttCounts: mutable.Seq[(StreetEdgeInfo, StreetLabelCounter)] = streets.map { s =>
      (s, StreetLabelCounter(s.street.streetEdgeId, 0, 0, 0, 0, mutable.Map("CurbRamp" -> 0, "NoCurbRamp" -> 0, "Obstacle" -> 0, "SurfaceProblem" -> 0)))
    }.to[mutable.Seq]

    // Get attributes for the streets in batches and increment the counters based on those attributes.
    var startIndex: Int = 0
    val batchSize: Int = 20000
    var moreWork: Boolean = true
    while (moreWork) {
      val attributes: List[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(apiType, bbox, None, Some(startIndex), Some(batchSize))
      attributes.foreach { a =>
        val streetBabe: StreetLabelCounter = streetAttCounts.filter(_._2.streetEdgeId == a.streetEdgeId).map(_._2).head
        streetBabe.nLabels += a.labelCount
        streetBabe.nImages += a.imageCount
        streetBabe.labelAgeSum += a.avgLabelDate.getTime * a.labelCount
        streetBabe.imageAgeSum += a.avgImageCaptureDate.getTime * a.imageCount
        if (streetBabe.labelCounter.contains(a.labelType)) streetBabe.labelCounter(a.labelType) += 1
      }

      startIndex += batchSize
      if (attributes.length < batchSize) moreWork = false
    }

    // Compute the access score and other stats for each street.
    val streetAccessScores: List[AccessScoreStreet] = streetAttCounts.toList.par.map { case (s, cnt) =>
      val (avgImageCaptureDate, avgLabelDate): (Option[Timestamp], Option[Timestamp]) = if (cnt.nLabels > 0 && cnt.nImages > 0) {
        (Some(new Timestamp((cnt.imageAgeSum / cnt.nImages).toLong)), Some(new Timestamp((cnt.labelAgeSum / cnt.nLabels).toLong)))
      } else {
        (None, None)
      }
      // Compute access score.
      val attributes: Array[Int] = Array(cnt.labelCounter("CurbRamp"), cnt.labelCounter("NoCurbRamp"), cnt.labelCounter("Obstacle"), cnt.labelCounter("SurfaceProblem"))
      val score: Double = computeAccessScore(attributes.map(_.toDouble), significance)
      AccessScoreStreet(s.street, s.osmId, s.regionId, score, s.auditCount, attributes, significance, avgImageCaptureDate, avgLabelDate, cnt.nImages, cnt.nLabels)
    }.seq.toList
    streetAccessScores
  }

  def computeAccessScore(attributes: Array[Double], significance: Array[Double]): Double = {
    val t: Double = (for ((f, s) <- (attributes zip significance)) yield f * s).sum  // dot product
    val s: Double = 1 / (1 + math.exp(-t))  // sigmoid function
    s
  }

  def getRawLabels(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String], inline: Option[Boolean]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val bbox: APIBBox = APIBBox(minLat = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      minLng = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)),
      maxLat = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2)),
      maxLng = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2)))

    val timeStr: String = new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")
    val baseFileName: String = s"rawLabels_$timeStr"

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      //Writing 10k objects to a file
      val file = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(file)
      // Write column headers.
      val header: String = "Label ID,Latitude,Longitude,User ID,Panorama ID,Label Type,Severity,Tags,Temporary," +
        "Description,Label Date,Street ID,Neighborhood ID,Correct,Agree Count,Disagree Count,Not Sure Count," +
        "Validations,Task ID,Mission ID,Image Capture Date,Heading,Pitch,Zoom,Canvas X,Canvas Y,Canvas Width," +
        "Canvas Height,GSV URL,Panorama X,Panorama Y,Panorama Width,Panorama Height,Panorama Heading,Panorama Pitch"
      writer.println(header)

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        // Fetch a batch of rows.
        val rows: List[String] = LabelTable.getAllLabelMetadata(bbox, Some(startIndex), Some(batchSize))
          .map(APIFormats.rawLabelMetadataToCSVRow)

        // Write the batch to the file.
        writer.println(rows.mkString("\n"))
        startIndex += batchSize
        if (rows.length < batchSize) moreWork = false
      }
      writer.print("]}")
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      ShapefilesCreatorHelper.createRawLabelShapeFile(baseFileName, bbox)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(baseFileName, Array(baseFileName))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {
      // In GeoJSON format. Writing 10k objects to a file at a time to reduce server memory usage and crashes.
      val labelsJsonFile = new java.io.File(s"$baseFileName.json")
      val writer = new java.io.PrintStream(labelsJsonFile)
      writer.print("""{"type":"FeatureCollection","features":[""")

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        val features: List[JsObject] =
          LabelTable.getAllLabelMetadata(bbox, Some(startIndex), Some(batchSize)).map(APIFormats.rawLabelMetadataToJSON)
        writer.print(features.map(_.toString).mkString(","))
        startIndex += batchSize
        if (features.length < batchSize) moreWork = false
        else writer.print(",")
      }
      writer.print("]}")
      writer.close()

      Future.successful(Ok.sendFile(content = labelsJsonFile, inline = inline.getOrElse(false), onClose = () => labelsJsonFile.delete()))
    }
  }

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   *
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @return
   */
  def getUsersAPIStats(filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val baseFileName: String = s"userStats_${new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")}"
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val userStatsFile = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(userStatsFile)
      // Write column headers.
      val header: String = "User ID,Labels,Meters Explored,Labels per Meter,High Quality,High Quality Manual," +
        "Label Accuracy,Validated Labels,Validations Received,Labels Validated Correct,Labels Validated Incorrect," +
        "Labels Not Validated,Validations Given,Dissenting Validations Given,Agree Validations Given," +
        "Disagree Validations Given,Not Sure Validations Given,Curb Ramp Labels,Curb Ramps Validated Correct," +
        "Curb Ramps Validated Incorrect,Curb Ramps Not Validated,No Curb Ramp Labels,No Curb Ramps Validated Correct," +
        "No Curb Ramps Validated Incorrect,No Curb Ramps Not Validated,Obstacle Labels,Obstacles Validated Correct," +
        "Obstacles Validated Incorrect,Obstacles Not Validated,Surface Problem Labels," +
        "Surface Problems Validated Correct,Surface Problems Validated Incorrect,Surface Problems Not Validated," +
        "No Sidewalk Labels,No Sidewalks Validated Correct,No Sidewalks Validated Incorrect," +
        "No Sidewalks Not Validated,Crosswalk Labels,Crosswalks Validated Correct,Crosswalks Validated Incorrect," +
        "Crosswalks Not Validated,Pedestrian Signal Labels,Pedestrian Signals Validated Correct," +
        "Pedestrian Signals Validated Incorrect,Pedestrian Signals Not Validated,Cant See Sidewalk Labels," +
        "Cant See Sidewalks Validated Correct,Cant See Sidewalks Validated Incorrect," +
        "Cant See Sidewalks Not Validated,Other Labels,Others Validated Correct,Others Validated Incorrect," +
        "Others Not Validated"
      writer.println(header)
      // Write each row in the CSV.
      for (current <- UserStatTable.getStatsForAPI) {
        writer.println(APIFormats.userStatToCSVRow(current))
      }
      writer.close()
      Future.successful(Ok.sendFile(content = userStatsFile, onClose = () => userStatsFile.delete()))
    } else { // In JSON format.
      Future.successful(Ok(Json.toJson(UserStatTable.getStatsForAPI.map(APIFormats.userStatToJson))))
    }
  }

  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val baseFileName: String = s"projectSidewalkStats_${new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")}"
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
      val writer = new java.io.PrintStream(sidewalkStatsFile)

      val stats: ProjectSidewalkStats = LabelTable.getOverallStatsForAPI(filterLowQuality)
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
      Future.successful(Ok.sendFile(content = sidewalkStatsFile, onClose = () => sidewalkStatsFile.delete()))
    } else { // In JSON format.
      Future.successful(Ok(APIFormats.projectSidewalkStatsToJson(LabelTable.getOverallStatsForAPI(filterLowQuality))))
    }
  }
}
