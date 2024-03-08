package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.APIFormats
import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeTable, ConfigTable, MapParams}
import org.locationtech.jts.geom.{Coordinate => JTSCoordinate}
import math._
import models.region._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, ProjectSidewalkStats}
import models.street.{StreetEdge, StreetEdgeInfo, StreetEdgeTable}
import models.user.{User, UserStatTable, WebpageActivity, WebpageActivityTable}
import play.api.libs.json._
import play.api.libs.json.Json._
import play.extras.geojson.{LatLng => JsonLatLng, LineString => JsonLineString, MultiPolygon => JsonMultiPolygon, Point => JsonPoint}
import scala.collection.JavaConversions._
import scala.collection.mutable.{ArrayBuffer}
import scala.concurrent.Future
import helper.ShapefilesCreatorHelper
import models.region.RegionTable.MultiPolygonUtils
import scala.collection.mutable


case class NeighborhoodAttributeSignificance (val name: String,
                                              val geometry: Array[JTSCoordinate],
                                              val regionID: Int,
                                              val coverage: Double,
                                              val score: Double,
                                              val attributeScores: Array[Double],
                                              val significanceScores: Array[Double],
                                              val avgImageCaptureDate: Option[Timestamp],
                                              val avgLabelDate: Option[Timestamp]) {
  def toJSON(geom: MultiPolygon): JsObject = {
    if (coverage > 0.0D) {
      val properties: JsObject = Json.obj(
        "coverage" -> coverage,
        "neighborhood_id" -> regionID,
        "neighborhood_name" -> name,
        "score" -> score,
        "significance" -> Json.obj(
          "CurbRamp" -> significanceScores(0),
          "NoCurbRamp" -> significanceScores(1),
          "Obstacle" -> significanceScores(2),
          "SurfaceProblem" -> significanceScores(3)
        ),
        "avg_attribute_count" -> Json.obj(
          "CurbRamp" -> attributeScores(0),
          "NoCurbRamp" -> attributeScores(1),
          "Obstacle" -> attributeScores(2),
          "SurfaceProblem" -> attributeScores(3)
        ),
        "avg_image_capture_date" -> avgImageCaptureDate.map(_.toString),
        "avg_label_date" -> avgLabelDate.map(_.toString)
      )
      Json.obj("type" -> "Feature", "geometry" -> geom.toJSON, "properties" -> properties)
    } else {
      val properties: JsObject = Json.obj(
        "coverage" -> 0.0,
        "neighborhood_id" -> regionID,
        "neighborhood_name" -> name,
        "score" -> None.asInstanceOf[Option[Double]],
        "significance" -> Json.obj(
          "CurbRamp" -> 0.75,
          "NoCurbRamp" -> -1.0,
          "Obstacle" -> -1.0,
          "SurfaceProblem" -> -1.0
        ),
        "avg_attribute_count" -> None.asInstanceOf[Option[Array[Double]]],
        "avg_image_capture_date" -> None.asInstanceOf[Option[Timestamp]],
        "avg_label_date" -> None.asInstanceOf[Option[Timestamp]]
      )
      Json.obj("type" -> "Feature", "geometry" -> geom.toJSON, "properties" -> properties)
    }
  }

  def toCSV(geom: MultiPolygon): String = {
    val coordinates: Array[Coordinate] = geom.getCoordinates
    val coordStr: String = s""""[${coordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
    if (coverage > 0.0D) {
      s""""$name",$regionID,$score,$coordStr,$coverage,${attributeScores(0)},${attributeScores(1)},""" +
        s"${attributeScores(2)},${attributeScores(3)},${significanceScores(0)},${significanceScores(1)}," +
        s"${significanceScores(2)},${significanceScores(3)},${avgImageCaptureDate.map(_.toString).getOrElse("NA")}," +
        s"${avgLabelDate.map(_.toString).getOrElse("NA")}"
    } else {
      s""""$name",$regionID,NA,$coordStr,0.0,NA,NA,NA,NA,${significanceScores(0)},${significanceScores(1)},""" +
        s"${significanceScores(2)},${significanceScores(3)},NA,NA"
    }
  }
}

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


/**
 * Holds the HTTP requests associated with API.
 *
 * @param env The Silhouette environment.
 */
class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class AttributeForAccessScore(lat: Float, lng: Float, labelType: String, avgImageCaptureDate: Timestamp,
                                     avgLabelDate: Timestamp, imageCount: Int, labelCount: Int)
  case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Long, regionId: Int, score: Double, auditCount: Int,
                               attributes: Array[Int], significance: Array[Double],
                               avgImageCaptureDate: Option[Timestamp], avgLabelDate: Option[Timestamp], imageCount: Int,
                               labelCount: Int) {
    def toJSON: JsObject  = {
      val latlngs: List[JsonLatLng] = streetEdge.geom.getCoordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> streetEdge.streetEdgeId,
        "osm_id" -> osmId,
        "neighborhood_id" -> regionId,
        "score" -> score,
        "audit_count" -> auditCount,
        "avg_image_capture_date" -> avgImageCaptureDate.map(_.toString),
        "avg_label_date" -> avgLabelDate.map(_.toString),
        "significance" -> Json.obj(
          "CurbRamp" -> significance(0),
          "NoCurbRamp" -> significance(1),
          "Obstacle" -> significance(2),
          "SurfaceProblem" -> significance(3)
        ),
        "attribute_count" -> Json.obj(
          "CurbRamp" -> attributes(0),
          "NoCurbRamp" -> attributes(1),
          "Obstacle" -> attributes(2),
          "SurfaceProblem" -> attributes(3)
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }

    def toCSV: String = {
      val coordStr: String = s""""[${streetEdge.geom.getCoordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
      s"${streetEdge.streetEdgeId},$osmId,$regionId,$score,$coordStr,$auditCount,${attributes(0)},${attributes(1)}," +
        s"${attributes(2)},${attributes(3)},${significance(0)},${significance(1)},${significance(2)}," +
        s"${significance(3)},${avgImageCaptureDate.map(_.toString).getOrElse("NA")}," +
        s"${avgLabelDate.map(_.toString).getOrElse("NA")}"
    }
  }

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
    * @param severity
    * @param filetype
    * @param inline
    * @return
    */
  def getAccessAttributesWithLabelsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                                      severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val minLat: Double = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val maxLat: Double = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val minLng: Double = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
    val maxLng: Double = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File(s"access_attributes_with_labels_${new Timestamp(Instant.now.toEpochMilli).toString}.csv")
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
        // Fetch a batch of rows
        val rows: List[String] = GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity, Some(startIndex), Some(batchSize))
          .map(_.attributesToArray.mkString(","))

        // Write the batch to the file
        writer.println(rows.mkString("\n"))

        startIndex += batchSize
        if (rows.length < batchSize) moreWork = false
      }
      writer.print("]}")
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      val time = new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")

      ShapefilesCreatorHelper.createAttributeShapeFile(s"attributes_$time", minLat, minLng, maxLat, maxLng, severity)
      ShapefilesCreatorHelper.createLabelShapeFile(s"labels_$time", minLat, minLng, maxLat, maxLng, severity)

      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(s"attributeWithLabels_$time", Array(s"attributes_$time", s"labels_$time"))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {
      // In GeoJSON format. Writing 10k objects to a file at a time to reduce server memory usage and crashes.
      val attributesJsonFile = new java.io.File(s"attributesWithLabels_${new Timestamp(Instant.now.toEpochMilli).toString}.json")
      val writer = new java.io.PrintStream(attributesJsonFile)
      writer.print("""{"type":"FeatureCollection","features":[""")

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        val features: List[JsObject] = GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity, Some(startIndex), Some(batchSize)).map(_.toJSON)
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
    * @param severity
    * @param filetype
    * @param inline
    * @return
    */
  def getAccessAttributesV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                            severity: Option[String], filetype: Option[String], inline: Option[Boolean]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val minLat:Double = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val maxLat:Double = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val minLng:Double = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
    val maxLng:Double = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      //Writing 10k objects to a file
      val file = new java.io.File(s"access_attributes_without_labels_${new Timestamp(Instant.now.toEpochMilli).toString}.csv")
      val writer = new java.io.PrintStream(file)
      // Write column headers.
      writer.println("Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Attribute Latitude,Attribute Longitude,Avg Image Capture Date,Avg Label Date,Severity,Temporary,Agree Count,Disagree Count,Not Sure Count,Cluster Size,User IDs")
      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        // Fetch a batch of rows
        val rows: List[String] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity, Some(startIndex), Some(batchSize))
          .map(_.attributesToArray.mkString(","))

        // Write the batch to the file
        writer.println(rows.mkString("\n"))
        startIndex += batchSize
        if (rows.length < batchSize) moreWork = false
      }
      writer.print("]}")
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      val time = new Timestamp(Instant.now.toEpochMilli).toString.replaceAll(" ", "-")
      ShapefilesCreatorHelper.createAttributeShapeFile(s"attributes_$time", minLat, minLng, maxLat, maxLng, severity)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles(s"accessAttributes_$time", Array(s"attributes_$time"))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {
      // In GeoJSON format. Writing 10k objects to a file at a time to reduce server memory usage and crashes.
      val attributesJsonFile = new java.io.File(s"attributes_${new Timestamp(Instant.now.toEpochMilli).toString}.json")
      val writer = new java.io.PrintStream(attributesJsonFile)
      writer.print("""{"type":"FeatureCollection","features":[""")

      var startIndex: Int = 0
      val batchSize: Int = 20000
      var moreWork: Boolean = true
      while (moreWork) {
        val features: List[JsObject] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity, Some(startIndex), Some(batchSize)).map(_.toJSON)
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
    * @param filetype
    * @return
    */
  def getAccessScoreNeighborhoodsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double],
                                    filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val minLat: Double = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val maxLat: Double = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val minLng: Double = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
    val maxLng: Double = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
    val coordinates = Array(minLat, maxLat, minLng, maxLng)

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val neighborhoodList = computeAccessScoresForNeighborhoods(coordinates)

      val file = new java.io.File("access_score_neighborhoods.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Neighborhood Name,Neighborhood ID,Access Score,Coordinates,Coverage,Avg Curb Ramp Count," +
        "Avg No Curb Ramp Count,Avg Obstacle Count,Avg Surface Problem Count,Curb Ramp Significance," +
        "No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance,Avg Image Capture Date," +
        "Avg Label Date"
      // Write the column headers.
      writer.println(header)

      // Write each row in the CSV.
      for ((region, geom) <- neighborhoodList) { writer.println(region.toCSV(geom)) }

      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if(filetype.isDefined && filetype.get == "shapefile"){
      val regions: mutable.Buffer[NeighborhoodAttributeSignificance] = new ArrayBuffer[NeighborhoodAttributeSignificance]
      for (region <- computeAccessScoresForNeighborhoods(coordinates)) regions.add(region._1)
      // Send the list of objects to the helper class.
      ShapefilesCreatorHelper.createNeighborhoodShapefile("neighborhood", regions)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles("neighborhoodScore", Array("neighborhood"))
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {  // In GeoJSON format.

      // Get AccessScore data and output in GeoJSON format.
      def featureCollection = {
        val neighborhoodList: List[(NeighborhoodAttributeSignificance, MultiPolygon)] = computeAccessScoresForNeighborhoods(coordinates)
        val neighborhoodsJson: List[JsObject] = for ((region, geom) <- neighborhoodList) yield {
          region.toJSON(geom)
        }
        Json.obj("type" -> "FeatureCollection", "features" -> neighborhoodsJson)
      }
      Future.successful(Ok(featureCollection))
    }
  }

  /**
    * Gets list of clustered attributes within a bounding box.
    *
    * @param coordinates
    * @return
    */
  def getLabelsForScore(coordinates: Array[Double]): List[AttributeForAccessScore] = {
    val globalAttributes: List[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(coordinates(0), coordinates(2), coordinates(1), coordinates(3), None)
    globalAttributes.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType, l.avgImageCaptureDate, l.avgLabelDate, l.imageCount, l.labelCount))
  }

  /**
   * Computes AccessScore for every neighborhood in the given bounding box.
   *
   * @param coordinates
   */
  def computeAccessScoresForNeighborhoods(coordinates: Array[Double]): List[(NeighborhoodAttributeSignificance, MultiPolygon)] = {
    // Gather all of the data we'll need.
    val labelsForScore: List[AttributeForAccessScore] = getLabelsForScore(coordinates)
    val streets: List[StreetEdgeInfo] = StreetEdgeTable.selectStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val auditedStreets: List[StreetEdgeInfo] = streets.filter(_.auditCount > 0)
    val neighborhoods: List[Region] = RegionTable.getNeighborhoodsWithin(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    // Populate every object in the list.
    val neighborhoodList: List[(NeighborhoodAttributeSignificance, MultiPolygon)] = neighborhoods.map { neighborhood =>
      val coordinates: Array[JTSCoordinate] = neighborhood.geom.getCoordinates.map(c => new JTSCoordinate(c.x, c.y))
      val auditedStreetsIntersecting = auditedStreets.filter(_.regionId == neighborhood.regionId)
      // Set default values for everything to 0, so null values will be 0 as well.
      var coverage: Double = 0.0
      var accessScore: Double = 0.0
      var averagedStreetFeatures: Array[Double] = Array(0.0, 0.0, 0.0, 0.0, 0.0)
      var avgImageCaptureDate: Option[Timestamp] = None
      var avgLabelDate: Option[Timestamp] = None

      if (auditedStreetsIntersecting.nonEmpty) {
        val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(auditedStreetsIntersecting, labelsForScore)
        averagedStreetFeatures = streetAccessScores.map(_.attributes).transpose.map(_.sum.toDouble / streetAccessScores.size).toArray
        accessScore = computeAccessScore(averagedStreetFeatures, significance)
        val streetsIntersecting: List[StreetEdgeInfo] = streets.filter(_.regionId == neighborhood.regionId)
        coverage = auditedStreetsIntersecting.size.toDouble / streetsIntersecting.size

        // Compute average image & label age if there are any labels on the streets.
        val nImages: Int = streetAccessScores.map(s => s.imageCount).sum
        val nLabels: Int = streetAccessScores.map(s => s.labelCount).sum
        val (avgImageAge, avgLabelAge): (Option[Long], Option[Long]) =
          if (nImages > 0 && nLabels > 0) {
            (
              Some(streetAccessScores.flatMap(s => s.avgImageCaptureDate.map(_.getTime * s.imageCount)).sum / nImages),
              Some(streetAccessScores.flatMap(s => s.avgLabelDate.map(_.getTime * s.labelCount)).sum / nLabels)
            )
          } else {
            (None, None)
          }
        avgImageCaptureDate = avgImageAge.map(age => new Timestamp(age))
        avgLabelDate = avgLabelAge.map(age => new Timestamp(age))

        assert(coverage <= 1.0)
      }
      (
        NeighborhoodAttributeSignificance(neighborhood.name, coordinates, neighborhood.regionId, coverage, accessScore,
          averagedStreetFeatures, significance, avgImageCaptureDate, avgLabelDate),
        neighborhood.geom
      )
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
    * @return     The access score for the given neighborhood
    */
  def getAccessScoreStreetsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val minLat: Double = min(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val maxLat: Double = max(lat1.getOrElse(cityMapParams.lat1), lat2.getOrElse(cityMapParams.lat2))
    val minLng: Double = min(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))
    val maxLng: Double = max(lng1.getOrElse(cityMapParams.lng1), lng2.getOrElse(cityMapParams.lng2))

    // Retrieve data and cluster them by location and label type.
    val streetEdges: List[StreetEdgeInfo] = StreetEdgeTable.selectStreetsIntersecting(minLat, minLng, maxLat, maxLng)
    val coordinates = Array(minLat, maxLat, minLng, maxLng)
    val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(streetEdges, getLabelsForScore(coordinates))

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File("access_score_streets.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Street ID,OSM ID,Neighborhood ID,Access Score,Coordinates,Audit Count," +
        "Avg Curb Ramp Score,Avg No Curb Ramp Score,Avg Obstacle Score,Avg Surface Problem Score," +
        "Curb Ramp Significance,No Curb Ramp Significance,Obstacle Significance,Surface Problem Significance," +
        "Avg Image Capture Date,Avg Label Date"
      // Write column headers.
      writer.println(header)
      // Write each row in the CSV.
      for (streetAccessScore <- streetAccessScores) {
        writer.println(streetAccessScore.toCSV)
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
      ShapefilesCreatorHelper.createStreetShapefile("streetValues", streetBuffer)

      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles("streetScore", Array.apply("streetValues"))

      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {  // In GeoJSON format.
      val features: List[JsObject] = streetAccessScores.map(_.toJSON)
      Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
    }
  }

  /**
    * Retrieve streets in the given bounding box and corresponding labels for each street.
    *
    * References:
    * - http://www.vividsolutions.com/jts/javadoc/com/vividsolutions/jts/geom/Geometry.html
    *
    * @param streets        List of streets that should be scored
    * @param labelLocations List of AttributeForAccessScore
    *
    */
  def computeAccessScoresForStreets(streets: List[StreetEdgeInfo], labelLocations: List[AttributeForAccessScore]): List[AccessScoreStreet] = {
    val radius = 3.0E-4  // Approximately 10 meters.
    val pm = new PrecisionModel()
    val srid = 4326
    val factory: GeometryFactory = new GeometryFactory(pm, srid)

    // Generate and store (point, label) pairs.
    val points: List[(Point, AttributeForAccessScore)] = labelLocations.map { ll =>
      val p: Point = factory.createPoint(new Coordinate(ll.lng.toDouble, ll.lat.toDouble))
      (p, ll)
    }

    // Evaluate scores for each street.
    val streetAccessScores = streets.map { edge =>
      // Expand each edge a little bit and count the number of accessibility attributes.
      val buffer: Geometry = edge.street.geom.buffer(radius)

      //  Increment a value in Map: http://stackoverflow.com/questions/15505048/access-initialize-and-update-values-in-a-mutable-map
      val labelCounter = collection.mutable.Map[String, Int](
        "CurbRamp" -> 0,
        "NoCurbRamp" -> 0,
        "Obstacle" -> 0,
        "SurfaceProblem" -> 0
      ).withDefaultValue(0)
      var labelAgeSum: Float = 0
      var imageAgeSum: Float = 0
      var nLabels: Int = 0
      var nImages: Int = 0
      // Update street cluster values for each point that's close enough to the street
      points.foreach { pointPair =>
        val (p: Point, ll: AttributeForAccessScore) = pointPair
        if (p.within(buffer) && labelCounter.contains(ll.labelType)) {
          labelCounter(ll.labelType) += 1
          imageAgeSum += ll.avgImageCaptureDate.getTime * ll.imageCount
          labelAgeSum += ll.avgLabelDate.getTime * ll.labelCount
          nImages += ll.imageCount
          nLabels += ll.labelCount
        }
      }
      val (avgImageCaptureDate, avgLabelDate): (Option[Timestamp], Option[Timestamp]) = if (nLabels > 0 && nImages > 0) {
        (Some(new Timestamp((imageAgeSum / nImages).toLong)), Some(new Timestamp((labelAgeSum / nLabels).toLong)))
      } else {
        (None, None)
      }
      // Compute an access score.
      val attributes = Array(labelCounter("CurbRamp"), labelCounter("NoCurbRamp"), labelCounter("Obstacle"), labelCounter("SurfaceProblem"))
      val significance = Array(0.75, -1.0, -1.0, -1.0)
      val accessScore: Double = computeAccessScore(attributes.map(_.toDouble), significance)
      AccessScoreStreet(edge.street, edge.osmId, edge.regionId, accessScore, edge.auditCount, attributes, significance, avgImageCaptureDate, avgLabelDate, nImages, nLabels)
    }
    streetAccessScores
  }

  def computeAccessScore(attributes: Array[Double], significance: Array[Double]): Double = {
    val t = (for ( (f, s) <- (attributes zip significance) ) yield f * s).sum  // dot product
    val s = 1 / (1 + math.exp(-t))  // sigmoid function
    s
  }

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   *
   * @param filetype
   * @return
   */
  def getUsersAPIStats(filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val userStatsFile = new java.io.File("user_stats.csv")
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
        writer.println(current.toArray.mkString(","))
      }
      writer.close()
      Future.successful(Ok.sendFile(content = userStatsFile, onClose = () => userStatsFile.delete()))
    } else { // In JSON format.
      Future.successful(Ok(Json.toJson(UserStatTable.getStatsForAPI.map(_.toJSON))))
    }
  }

  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val sidewalkStatsFile = new java.io.File("project_sidewalk_stats.csv")
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
