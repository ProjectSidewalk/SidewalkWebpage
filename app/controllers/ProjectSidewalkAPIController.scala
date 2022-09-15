package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import com.vividsolutions.jts.index.kdtree.{KdNode, KdTree}
import controllers.headers.ProvidesHeader
import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeTable, GlobalAttributeWithLabelForAPI}
import org.locationtech.jts.geom.{Coordinate => JTSCoordinate}
import math._
import models.region._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.GSVDataTable
import models.label.{LabelLocation, LabelTable}
import models.street.{OsmWayStreetEdge, OsmWayStreetEdgeTable}
import models.street.{StreetEdge, StreetEdgeInformation, StreetEdgeTable}
import models.user.{User, UserStatTable, WebpageActivity, WebpageActivityTable}
import play.api.Play.current
import play.api.libs.json._
import play.api.libs.json.Json._
import play.extras.geojson.{LatLng => JsonLatLng, LineString => JsonLineString, MultiPolygon => JsonMultiPolygon, Point => JsonPoint}
import scala.collection.JavaConversions._
import scala.collection.mutable.{ArrayBuffer, Buffer}
import scala.concurrent.Future
import helper.ShapefilesCreatorHelper
import models.region.RegionTable.MultiPolygonUtils


case class NeighborhoodAttributeSignificance (val name: String,
                                              val geometry: Array[JTSCoordinate],
                                              val regionID: Int,
                                              val coverage: Double,
                                              val score: Double,
                                              val attributeScores: Array[Double],
                                              val significanceScores: Array[Double],
                                              val avgImageDate: Timestamp,
                                              val avgLabelDate: Timestamp)

case class StreetAttributeSignificance (val geometry: Array[JTSCoordinate],
                                        val streetID: Int,
                                        val osmID: Int,
                                        val score: Double,
                                        val audited: Boolean,
                                        val attributeScores: Array[Double],
                                        val significanceScores: Array[Double],
                                        val avgImageDate: Timestamp,
                                        val avgLabelDate: Timestamp)


/**
 * Holds the HTTP requests associated with API.
 *
 * @param env The Silhouette environment.
 */
class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

    case class AttributeForAccessScore(lat: Float, lng: Float, labelType: String, avgImageDate: Timestamp, avgLabelDate: Timestamp, imageCount: Int, labelCount: Int)
  case class AccessScoreStreet(streetEdge: StreetEdge, osmId: Int, score: Double, audited: Boolean, attributes: Array[Double], significance: Array[Double], avgImageDate: Timestamp, avgLabelDate: Timestamp, imageCount: Int, labelCount: Int) {
    def toJSON: JsObject  = {
      val latlngs: List[JsonLatLng] = streetEdge.geom.getCoordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> streetEdge.streetEdgeId,
        "osm_id" -> osmId,
        "score" -> score,
        "audited" -> audited,
        "average_image_date" -> avgImageDate.toString(),
        "average_label_date" -> avgLabelDate.toString(),
        "significance" -> Json.obj(
          "CurbRamp" -> significance(0),
          "NoCurbRamp" -> significance(1),
          "Obstacle" -> significance(2),
          "SurfaceProblem" -> significance(3)
        ),
        "feature" -> Json.obj(
          "CurbRamp" -> attributes(0),
          "NoCurbRamp" -> attributes(1),
          "Obstacle" -> attributes(2),
          "SurfaceProblem" -> attributes(3)
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }
  }

  /**
    * Adds an entry to the webpage_activity table with the endpoint used.
    *
    * @param remoteAddress  The remote address that made the API call
    * @param identity       The user that made the API call, if the user is signed in. If no user is signed in, the value is None
    * @param requestStr     The full request sent by the API call
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
    * @return
    */
  def getAccessAttributesWithLabelsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, severity: Option[String], filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat:Float = min(lat1, lat2).toFloat
    val maxLat:Float = max(lat1, lat2).toFloat
    val minLng:Float = min(lng1, lng2).toFloat
    val maxLng:Float = max(lng1, lng2).toFloat

    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File("access_attributes_with_labels.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Attribute ID,Label Type,Attribute Severity,Attribute Temporary,Street ID," +
        "OSM Street ID,Neighborhood Name,Label ID,Panorama ID,Attribute Latitude," + 
        "Attribute Longitude,Label Latitude,Label Longitude,Heading,Pitch,Zoom,Canvas X,Canvas Y," +
        "Canvas Width,Canvas Height,GSV URL,Image Date,Label Date,Label Severity,Label Temporary," +
        "Agree Count,Disagree Count,Not Sure Count,Label Tags,Label Description"
      // Write column headers.
      writer.println(header)
      // Write each row in the CSV.
      for (current <- GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity)) {
        writer.println(current.attributesToArray.mkString(","))
      }
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {

      val attributeList: Buffer[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity).to[ArrayBuffer]

      ShapefilesCreatorHelper.createAttributeShapeFile("attributes", attributeList)

      val labelList: Buffer[GlobalAttributeWithLabelForAPI] = GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity).to[ArrayBuffer]

      ShapefilesCreatorHelper.createLabelShapeFile("labels", labelList)

      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles("attributeWithLabels", Array("attributes", "labels"))

      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else {  // In GeoJSON format.
      val features: List[JsObject] = 
        GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity).map(_.toJSON)
      Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
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
    * @return
    */
  def getAccessAttributesV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, severity: Option[String],
                            filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat:Float = min(lat1, lat2).toFloat
    val maxLat:Float = max(lat1, lat2).toFloat
    val minLng:Float = min(lng1, lng2).toFloat
    val maxLng:Float = max(lng1, lng2).toFloat
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val accessAttributesfile = new java.io.File("access_attributes.csv")
      val writer = new java.io.PrintStream(accessAttributesfile)
      // Write column headers.
      writer.println("Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Attribute Latitude,Attribute Longitude,Image Date,Label Date,Severity,Temporary,Agree Count,Disagree Count,Not Sure Count")
      // Write each row in the CSV.
      for (current <- GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity)) {
        writer.println(current.attributesToArray.mkString(","))
      }
      writer.close()
      Future.successful(Ok.sendFile(content = accessAttributesfile, onClose = () => accessAttributesfile.delete()))
    } else if (filetype.isDefined && filetype.get == "shapefile") {
      val attributeList: Buffer[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity).to[ArrayBuffer]
      ShapefilesCreatorHelper.createAttributeShapeFile("attributes", attributeList)
      val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles("accessAttributes", Array("attributes"));
      Future.successful(Ok.sendFile(content = shapefile, onClose = () => shapefile.delete()))
    } else { // In GeoJSON format.
      val features: List[JsObject] =
        GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity).map(_.toJSON)
      Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
    }
  }

    /**
    * Returns all the global attributes within the bounding box in geoJson.
    *
    * @param lat1     First latttude value for the bounding box
    * @param lng1     First longitude value for the bounding box
    * @param lat2     Second latitude value for the bounding box
    * @param lng2     Second longitude value for the bounding box
    * @param severity The severity of the attributes that should be added in the geojson
    */
  def getAccessAttributesV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)

    def featureCollection = {
      // Retrieve data and cluster them by location and label type.
      val labelLocations: List[LabelLocation] = LabelTable.selectLocationsOfLabelsIn(minLat, minLng, maxLat, maxLng)
      val clustered: List[LabelLocation] = clusterLabelLocations(labelLocations)

      val features: List[JsObject] = clustered.map { label =>
        val latlng = JsonLatLng(label.lat.toDouble, label.lng.toDouble)
        val point = JsonPoint(latlng)
        val labelType = label.labelType
        val labelId = label.labelId
        val panoramaId = label.gsvPanoramaId
        val properties = Json.obj(
          "label_type" -> labelType,  // Todo. Actually calculate the access score,
          "panorama_id" -> panoramaId
        )
        Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
      }
      Json.obj("type" -> "FeatureCollection", "features" -> features)
    }
    Future.successful(Ok(featureCollection))
  }

  /**
    * E.g. /v1/access/score/neighborhood?lng1=-77.01098442077637&lat1=38.89035159350444&lng2=-76.97793960571289&lat2=38.91851800248647
    * @param lat1 First latitude value for the bounding box
    * @param lng1 First longitude value for the bounding box
    * @param lat2 Second latitude value for the bounding box
    * @param lng2 Second longitude value for the bounding box
    * @return     The access score for the given neighborhood
    */
  def getAccessScoreNeighborhoodsV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val coordinates = Array(min(lat1, lat2), max(lat1, lat2), min(lng1, lng2), max(lng1, lng2))
    Future.successful(Ok(getAccessScoreNeighborhoodsJson(version = 1, coordinates)))
  }

  /**
    * E.g. /v2/access/score/neighborhood?lng1=-77.01098442077637&lat1=38.89035159350444&lng2=-76.97793960571289&lat2=38.91851800248647
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param filetype
    * @return
    */
  def getAccessScoreNeighborhoodsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val coordinates = Array(min(lat1, lat2), max(lat1, lat2), min(lng1, lng2), max(lng1, lng2))
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file: java.io.File = getAccessScoreNeighborhoodsCSV(version = 2, coordinates)
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else if(filetype.isDefined && filetype.get == "shapefile"){
      val file: java.io.File = getAccessScoreNeighborhoodsShapefile(coordinates)
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete()))
    } else {  // In GeoJSON format.
      Future.successful(Ok(getAccessScoreNeighborhoodsJson(version = 2, coordinates)))
    }
  }

  /**
   * Gets the Access Score of the neighborhoods within the coordinates in a shapefile format.
   *
   * @param coordinates: A coordinate representation of the bounding box for the query. Every neighborhood
   *                     within this bounding box will have their access score calculated and returned.
   * @return             A shapefile representation of the access scores within the given coordinates.
   */
  def getAccessScoreNeighborhoodsShapefile(coordinates: Array[Double]): java.io.File = {
    // Gather all of the data that will be written to the Shapefile.
    val labelsForScore: List[AttributeForAccessScore] = getLabelsForScore(version = 2, coordinates)
    val allStreetEdges: List[StreetEdge] = StreetEdgeTable.selectStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val auditedStreetEdges: List[StreetEdgeInformation] = StreetEdgeTable.selectAuditedStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val neighborhoods: List[NamedRegion] = RegionTable.selectNamedNeighborhoodsWithin(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)
    // Create a list of NeighborhoodAttributeSignificance objects to pass to the helper class.
    val neighborhoodList: Buffer[NeighborhoodAttributeSignificance] = new ArrayBuffer[NeighborhoodAttributeSignificance]
    // Populate every object in the list.
    for (neighborhood <- neighborhoods) {
      val coordinates: Array[JTSCoordinate] = neighborhood.geom.getCoordinates.map(c => new JTSCoordinate(c.x, c.y))
      val auditedStreetsIntersectingTheNeighborhood = auditedStreetEdges.filter(_.streetEdge.geom.intersects(neighborhood.geom))
      // set default values for everything to 0, so null values will be 0 as well.
      var coverage: Double = 0.0
      var accessScore: Double = 0.0
      var averagedStreetFeatures: Array[Double] = Array(0.0,0.0,0.0,0.0,0.0)
      var avgImageDate: Timestamp = new Timestamp(0)
      var avgLabelDate: Timestamp = new Timestamp(0)
      if (auditedStreetsIntersectingTheNeighborhood.nonEmpty) {
        val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(auditedStreetsIntersectingTheNeighborhood, labelsForScore)  // I'm just interested in getting the attributes
        averagedStreetFeatures = streetAccessScores.map(_.attributes).transpose.map(_.sum / streetAccessScores.size).toArray
        val avgImageAge = streetAccessScores.map(s => s.avgImageDate.getTime() * s.imageCount).sum / streetAccessScores.map(s => s.imageCount).sum
        val avgLabelAge = streetAccessScores.map(s => s.avgLabelDate.getTime() * s.labelCount).sum / streetAccessScores.map(s => s.labelCount).sum
        avgImageDate = new Timestamp(avgImageAge)
        avgLabelDate = new Timestamp(avgLabelAge)
        accessScore = computeAccessScore(averagedStreetFeatures, significance)
        val allStreetsIntersectingTheNeighborhood = allStreetEdges.filter(_.geom.intersects(neighborhood.geom))
        coverage = auditedStreetsIntersectingTheNeighborhood.size.toDouble / allStreetsIntersectingTheNeighborhood.size

        assert(coverage <= 1.0)
      } 
      neighborhoodList.add(new NeighborhoodAttributeSignificance(neighborhood.name,
                                                                coordinates, 
                                                                neighborhood.regionId, 
                                                                coverage, 
                                                                accessScore, 
                                                                averagedStreetFeatures, 
                                                                significance,
                                                                avgImageDate,
                                                                avgLabelDate))
    }
    // Send the list of objects to the helper class.
    ShapefilesCreatorHelper.createNeighborhoodShapefile("neighborhood", neighborhoodList)
    val shapefile: java.io.File = ShapefilesCreatorHelper.zipShapeFiles("neighborhoodScore", Array("neighborhood"))
    shapefile
  }

  /**
    * Generic version of getAccessScoreNeighborHood, makes changes for v1 vs v2, for CSV file format only.
    *
    * @param version
    * @param coordinates
    * @return
    */
  def getAccessScoreNeighborhoodsCSV(version: Int, coordinates: Array[Double]): java.io.File = {
    val file = new java.io.File("access_score_neighborhoods.csv")
    val writer = new java.io.PrintStream(file)
    val header: String = "Neighborhood Name,Region ID,Access Score,Coordinates,Coverage,Average Curb Ramp Score," + 
                          "Average No Curb Ramp Score,Average Obstacle Score,Average Surface Problem Score," + 
                          "Curb Ramp Significance,No Curb Ramp Significance,Obstacle Significance," + 
                          "Surface Problem Significance,Average Image Date,Average Label Date"
    // Write the column headers.
    writer.println(header)
    val labelsForScore: List[AttributeForAccessScore] = getLabelsForScore(version, coordinates)
    val allStreetEdges: List[StreetEdge] = StreetEdgeTable.selectStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val auditedStreetEdges: List[StreetEdgeInformation] = StreetEdgeTable.selectAuditedStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val neighborhoods: List[NamedRegion] = RegionTable.selectNamedNeighborhoodsWithin(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    val significance = Array(0.75, -1.0, -1.0, -1.0)
    // Write each row in the CSV.
    for (neighborhood <- neighborhoods) {
      val coordinates: Array[Coordinate] = neighborhood.geom.getCoordinates
      val auditedStreetsIntersectingTheNeighborhood = auditedStreetEdges.filter(_.streetEdge.geom.intersects(neighborhood.geom))
      val coordStr: String = "\"[" + coordinates.map(c => "(" + c.x + "," + c.y + ")").mkString(",") + "]\""
      if (auditedStreetsIntersectingTheNeighborhood.nonEmpty) {
        val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(auditedStreetsIntersectingTheNeighborhood, labelsForScore)  // I'm just interested in getting the attributes
        val averagedStreetFeatures = streetAccessScores.map(_.attributes).transpose.map(_.sum / streetAccessScores.size).toArray
        val avgImageAge = streetAccessScores.map(s => s.avgImageDate.getTime() * s.imageCount).sum / streetAccessScores.map(s => s.imageCount).sum
        val avgLabelAge = streetAccessScores.map(s => s.avgLabelDate.getTime() * s.labelCount).sum / streetAccessScores.map(s => s.labelCount).sum
        val avgImageDate = new Timestamp(avgImageAge)
        val avgLabelDate = new Timestamp(avgLabelAge)
        val accessScore: Double = computeAccessScore(averagedStreetFeatures, significance)
        val allStreetsIntersectingTheNeighborhood = allStreetEdges.filter(_.geom.intersects(neighborhood.geom))
        val coverage: Double = auditedStreetsIntersectingTheNeighborhood.size.toDouble / allStreetsIntersectingTheNeighborhood.size

        assert(coverage <= 1.0)

        writer.println(neighborhood.name + "," + neighborhood.regionId + "," + accessScore + "," +
                      coordStr + "," + coverage + "," + averagedStreetFeatures(0) + "," + averagedStreetFeatures(1) + "," + 
                      averagedStreetFeatures(2) + "," + averagedStreetFeatures(3) + "," + 
                      significance(0) + "," + significance(1) + "," + significance(2) + "," + significance(3) + "," +
                      avgImageDate + "," + avgLabelDate)                
      } else {
        writer.println(neighborhood.name + "," + neighborhood.regionId + "," + "NA" + "," +
                      coordStr + ","  + 0.0 + "," + "NA" + "," + "NA" + "," + "NA" + "," + "NA" + "," + 
                      significance(0) + "," + significance(1) + "," + 
                      significance(2) + "," + significance(3) + "," + "NA" + "," + "NA")
      }
    }
    writer.close()
    file
  }

  /**
    * Gets list of clustered attributes within a bounding box.
    *
    * @param version
    * @param coordinates
    * @return
    */
  def getLabelsForScore(version: Int, coordinates: Array[Double]): List[AttributeForAccessScore] = {
    val labelsForScore: List[AttributeForAccessScore] = version match {
      case 1 =>
        val labelLocations: List[LabelLocation] = LabelTable.selectLocationsOfLabelsIn(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
        val clusteredLabelLocations: List[LabelLocation] = clusterLabelLocations(labelLocations)
        clusteredLabelLocations.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType, new Timestamp(0), new Timestamp(0), 1, 1))
      case 2 =>
        val globalAttributes: List[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(coordinates(0).toFloat, coordinates(2).toFloat, coordinates(1).toFloat, coordinates(3).toFloat, None)
        globalAttributes.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType, l.avgImageDate, l.avgLabelDate, l.imageCount, l.labelCount))
    }
    labelsForScore
  }

  /**
    * Generic version of getAccessScoreNeighborhood, makes changes for v1 vs v2, for GeoJSON file format only.
    *
    * @param version
    * @param coordinates
    * @return
    */
  def getAccessScoreNeighborhoodsJson(version: Int, coordinates: Array[Double]): JsObject = {
    // Retrieve data and cluster them by location and label type.
    def featureCollection = {
      val labelsForScore: List[AttributeForAccessScore] = getLabelsForScore(version, coordinates)
      val allStreetEdges: List[StreetEdge] = StreetEdgeTable.selectStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
      val auditedStreetEdges: List[StreetEdgeInformation] = StreetEdgeTable.selectAuditedStreetsIntersecting(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
      val neighborhoods: List[NamedRegion] = RegionTable.selectNamedNeighborhoodsWithin(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
      val neighborhoodsJson = for (neighborhood <- neighborhoods) yield {
        val neighborhoodJson: JsonMultiPolygon[JsonLatLng] = neighborhood.geom.toJSON

        // Get access score
        // Element-wise sum of arrays: http://stackoverflow.com/questions/32878818/how-to-sum-up-every-column-of-a-scala-array
        val auditedStreetsIntersectingTheNeighborhood = auditedStreetEdges.filter(_.streetEdge.geom.intersects(neighborhood.geom))
        if (auditedStreetsIntersectingTheNeighborhood.nonEmpty) {
          val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(auditedStreetsIntersectingTheNeighborhood, labelsForScore)  // I'm just interested in getting the attributes
          val averagedStreetFeatures = streetAccessScores.map(_.attributes).transpose.map(_.sum / streetAccessScores.size).toArray
          val avgImageAge = streetAccessScores.map(s => s.avgImageDate.getTime() * s.imageCount).sum / streetAccessScores.map(s => s.imageCount).sum
          val avgLabelAge = streetAccessScores.map(s => s.avgLabelDate.getTime() * s.labelCount).sum / streetAccessScores.map(s => s.labelCount).sum
          val avgImageDate = new Timestamp(avgImageAge)
          val avgLabelDate = new Timestamp(avgLabelAge)
          val significance = Array(0.75, -1.0, -1.0, -1.0)
          val accessScore: Double = computeAccessScore(averagedStreetFeatures, significance)

          val allStreetsIntersectingTheNeighborhood = allStreetEdges.filter(_.geom.intersects(neighborhood.geom))
          val coverage: Double = auditedStreetsIntersectingTheNeighborhood.size.toDouble / allStreetsIntersectingTheNeighborhood.size

          assert(coverage <= 1.0)

          val properties = Json.obj(
            "coverage" -> coverage,
            "region_id" -> neighborhood.regionId,
            "region_name" -> neighborhood.name,
            "score" -> accessScore,
            "significance" -> Json.obj(
              "CurbRamp" -> 0.75,
              "NoCurbRamp" -> -1.0,
              "Obstacle" -> -1.0,
              "SurfaceProblem" -> -1.0
            ),
            "feature" -> Json.obj(
              "CurbRamp" -> averagedStreetFeatures(0),
              "NoCurbRamp" -> averagedStreetFeatures(1),
              "Obstacle" -> averagedStreetFeatures(2),
              "SurfaceProblem" -> averagedStreetFeatures(3)
            ),
            "avg_image_date" -> avgImageDate.toString(),
            "avg_label_date" -> avgLabelDate.toString()
          )
          Json.obj("type" -> "Feature", "geometry" -> neighborhoodJson, "properties" -> properties)
        } else {
          val properties = Json.obj(
            "coverage" -> 0.0,
            "region_id" -> neighborhood.regionId,
            "region_name" -> neighborhood.name,
            "score" -> None.asInstanceOf[Option[Double]],
            "significance" -> Json.obj(
              "CurbRamp" -> 0.75,
              "NoCurbRamp" -> -1.0,
              "Obstacle" -> -1.0,
              "SurfaceProblem" -> -1.0
            ),
            "feature" -> None.asInstanceOf[Option[Array[Double]]]
          )
          Json.obj("type" -> "Feature", "geometry" -> neighborhoodJson, "properties" -> properties)
        }
      }
      Json.obj("type" -> "FeatureCollection", "features" -> neighborhoodsJson)
    }
    featureCollection
  }

  /**
    * AccessScore:Street
    *
    * E.g., /v1/access/score/streets?lng1=-76.9975519180&lat1=38.910286924&lng2=-76.9920158386&lat2=38.90793262720
    * @param lat1 First latttude value for the bounding box
    * @param lng1 First longitude value for the bounding box
    * @param lat2 Second latitude value for the bounding box
    * @param lng2 Second longitude value for the bounding box
    * @return     The access score for the given neighborhood
    */
  def getAccessScoreStreetsV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val features: List[JsObject] = getAccessScoreStreetsGeneric(lat1, lng1, lat2, lng2, version = 1).map(_.toJSON)
    Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
  }

  /**
    * AccessScore:Street V2 (using new clustering methods)
    *
    * E.g., /v2/access/score/streets?lng1=-76.9975519180&lat1=38.910286924&lng2=-76.9920158386&lat2=38.90793262720
    * @param lat1 First latitude value for the bounding box
    * @param lng1 First longitude value for the bounding box
    * @param lat2 Second latitude value for the bounding box
    * @param lng2 Second longitude value for the bounding box
    * @return     The access score for the given neighborhood
    */
  def getAccessScoreStreetsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, filetype: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    val streetAccessScores: List[AccessScoreStreet] = getAccessScoreStreetsGeneric(lat1, lng1, lat2, lng2, version = 2)
    // In CSV format.
    if (filetype.isDefined && filetype.get == "csv") {
      val file = new java.io.File("access_score_streets.csv")
      val writer = new java.io.PrintStream(file)
      val header: String = "Region ID,OSM ID,Access Score,Coordinates,Audited,Average Curb Ramp Score," + 
                            "Average No Curb Ramp Score,Average Obstacle Score,Average Surface Problem Score," + 
                            "Curb Ramp Significance,No Curb Ramp Significance,Obstacle Significance," + 
                            "Surface Problem Significance,Average Image Date,Average Label Date"
      // Write column headers.
      writer.println(header)
      // Write each row in the CSV.
      for (streetAccessScore <- streetAccessScores) {
        val coordStr: String = "\"[" + streetAccessScore.streetEdge.geom.getCoordinates.map(c => "(" + c.x + "," + c.y + ")").mkString(",") + "]\""
        writer.println(streetAccessScore.streetEdge.streetEdgeId + "," + streetAccessScore.osmId + "," +
                      streetAccessScore.score + "," + coordStr + "," + streetAccessScore.audited + "," +
                      streetAccessScore.attributes(0) + "," + streetAccessScore.attributes(1) + "," + 
                      streetAccessScore.attributes(2) + "," + streetAccessScore.attributes(3) + "," + 
                      streetAccessScore.significance(0) + "," + streetAccessScore.significance(1) + "," + 
                      streetAccessScore.significance(2) + "," + streetAccessScore.significance(3) + "," +
                      streetAccessScore.avgImageDate + "," + streetAccessScore.avgLabelDate)
      }
      writer.close()
      Future.successful(Ok.sendFile(content = file, onClose = () => file.delete))
    } else if (filetype.isDefined && filetype.get == "shapefile"){
      val streetBuffer: Buffer[StreetAttributeSignificance] = new ArrayBuffer[StreetAttributeSignificance]
      for(streetAccessScore <- streetAccessScores){
        streetBuffer.add(
          StreetAttributeSignificance(
            streetAccessScore.streetEdge.geom.getCoordinates().map(c => new JTSCoordinate(c.x, c.y)),
            streetAccessScore.streetEdge.streetEdgeId,
            streetAccessScore.osmId,
            streetAccessScore.score,
            streetAccessScore.audited,
            streetAccessScore.attributes,
            streetAccessScore.significance,
            streetAccessScore.avgImageDate,
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
    * Generic version of getAccessScoreStreets, makes appropriate changes for v1 vs. v2.
    *
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param version
    * @return
    */
  def getAccessScoreStreetsGeneric(lat1: Double, lng1: Double, lat2: Double, lng2: Double, version: Int): List[AccessScoreStreet]  = {
    val coordinates = Array(min(lat1, lat2), max(lat1, lat2), min(lng1, lng2), max(lng1, lng2))
    // Retrieve data and cluster them by location and label type.
    val streetEdges: List[StreetEdgeInformation] = StreetEdgeTable.selectStreetsWithin(coordinates(0), coordinates(2), coordinates(1), coordinates(3))
    computeAccessScoresForStreets(streetEdges, getLabelsForScore(version, coordinates))
  }

  // Helper methods
  def clusterLabelLocations(labelLocations: List[LabelLocation]): List[LabelLocation] = {
    // Cluster together the labelLocations
    var clusterIndex = 1
    val radius = 5.78E-5  // Approximately 5 meters
    val group = labelLocations.groupBy(l => l.labelType)
    val clustered = for ((labelType, groupedLabels) <- group) yield {
      val tree: KdTree = new KdTree(0.0)
      groupedLabels.foreach { label => tree.insert(new Coordinate(label.lng.toDouble, label.lat.toDouble), label) }
      val clusters = new scala.collection.mutable.HashMap[LabelLocation, Int]

      for (label <- groupedLabels) {
        val (x, y) = (label.lng.toDouble, label.lat.toDouble)
        val (xMin, xMax, yMin, yMax) = (x - radius, x + radius, y - radius, y + radius)
        val envelope = new Envelope(xMin, xMax, yMin, yMax)
        val nearbyLabels = tree.query(envelope).toArray.map { node =>
          node.asInstanceOf[KdNode].getData.asInstanceOf[LabelLocation]
        }

        // Group the labels into a cluster
        if (!clusters.contains(label)) {
          clusters.put(label, clusterIndex)
          nearbyLabels.foreach { nearbyLabel =>
            if (!clusters.contains(nearbyLabel)) {
              clusters.put(nearbyLabel, clusterIndex)
            }
          }
          clusterIndex += 1
        }
      }

      val swapped = clusters.groupBy(_._2).mapValues(_.keys)
      val clusteredLabelLocations = for ((ci, ll) <- swapped) yield {
        val labels = ll.toSeq
        val xmean = labels.map(_.lng).sum / labels.size
        val ymean = labels.map(_.lat).sum / labels.size
        LabelLocation(0, 0, labels.head.gsvPanoramaId, labelType, ymean, xmean)
      }
      clusteredLabelLocations
    }
    clustered.flatten.toList
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
  def computeAccessScoresForStreets(streets: List[StreetEdgeInformation], labelLocations: List[AttributeForAccessScore]): List[AccessScoreStreet] = {
    val radius = 3.0E-4  // Approximately 10 meters
    val pm = new PrecisionModel()
    val srid = 4326
    val factory: GeometryFactory = new GeometryFactory(pm, srid)

    val streetsWithOsmWayIds: List[(StreetEdgeInformation, OsmWayStreetEdge)] = OsmWayStreetEdgeTable.selectOsmWayIdsForStreets(streets)

    val streetAccessScores = streetsWithOsmWayIds.map { item =>
      val (edge: StreetEdgeInformation, osmStreetId: OsmWayStreetEdge) = item;
      // Expand each edge a little bit and count the number of accessibility attributes.
      val buffer: Geometry = edge.streetEdge.geom.buffer(radius)

      //  Increment a value in Map: http://stackoverflow.com/questions/15505048/access-initialize-and-update-values-in-a-mutable-map
      val labelCounter = collection.mutable.Map[String, Int](
        "CurbRamp" -> 0,
        "NoCurbRamp" -> 0,
        "Obstacle" -> 0,
        "SurfaceProblem" -> 0
      ).withDefaultValue(0)
      var labelAgeSum: Float = 0
      var imageAgeSum: Float = 0
      var totalLabels: Int = 0
      var totalImages: Int = 0
      labelLocations.foreach { ll =>
        val p: Point = factory.createPoint(new Coordinate(ll.lng.toDouble, ll.lat.toDouble))
        if (p.within(buffer)) {
          labelCounter(ll.labelType) += 1
          imageAgeSum += ll.avgImageDate.getTime() * ll.imageCount
          labelAgeSum += ll.avgLabelDate.getTime() * ll.labelCount
          totalImages += ll.imageCount
          totalLabels += ll.labelCount
        }
      }
      val avgImageDate: Timestamp = new Timestamp((imageAgeSum / totalImages).toLong)
      val avgLabelDate: Timestamp = new Timestamp((labelAgeSum / totalLabels).toLong)

      // Compute an access score.
      val attributes = Array(labelCounter("CurbRamp"), labelCounter("NoCurbRamp"), labelCounter("Obstacle"), labelCounter("SurfaceProblem")).map(_.toDouble)
      val significance = Array(0.75, -1.0, -1.0, -1.0)
      val accessScore: Double = computeAccessScore(attributes, significance)
      AccessScoreStreet(edge.streetEdge, osmStreetId.osmWayId, accessScore, edge.audited, attributes, significance, avgImageDate, avgLabelDate, totalImages, totalLabels)
    }
    streetAccessScores
  }

  def computeAccessScore(attributes: Array[Double], significance: Array[Double]): Double = {
    val t = (for ( (f, s) <- (attributes zip significance) ) yield f * s).sum  // dot product
    val s = 1 / (1 + math.exp(-t))  // sigmoid function
    s
  }

  /**
    * Compute distance between two latlng coordinates using the Haversine formula
    * References:
    * https://rosettacode.org/wiki/Haversine_formula#Scala
    *
    * @param lat1
    * @param lon1
    * @param lat2
    * @param lon2
    * @return Distance in meters
    */
  def haversine(lat1:Double, lon1:Double, lat2:Double, lon2:Double): Double = {
    val R = 6372800.0  //radius in m
    val dLat=(lat2 - lat1).toRadians
    val dLon=(lon2 - lon1).toRadians

    val a = pow(sin(dLat/2),2) + pow(sin(dLon/2),2) * cos(lat1.toRadians) * cos(lat2.toRadians)
    val c = 2 * asin(sqrt(a))
    R * c
  }

  /**
    * Compute distance between two latlng coordinates using the Haversine formula
    * @param latLng1
    * @param latLng2
    * @return Distance in meters
    */
  def haversine(latLng1: JsonLatLng, latLng2: JsonLatLng): Double = haversine(latLng1.lat, latLng1.lng, latLng2.lat, latLng2.lng)

  /**
    * Make a grid of latlng coordinates in a bounding box specified by a pair of latlng coordinates
    * @param latLng1 A latlng coordinate
    * @param latLng2 A latlng coordinate
    * @param stepSize A step size in meters
    * @return A list of latlng grid
    */
  def makeALatLngGrid(latLng1: JsonLatLng, latLng2: JsonLatLng, stepSize: Double): List[JsonLatLng] = {
    val minLat: Double = min(latLng1.lat, latLng2.lat)
    val maxLat: Double = max(latLng1.lat, latLng2.lat)
    val minLng: Double = min(latLng1.lng, latLng2.lng)
    val maxLng: Double = max(latLng1.lng, latLng2.lng)

    val distance = haversine(minLat, minLng, maxLat, maxLng)
    val stepRatio: Double = stepSize / distance

    val dLat = maxLat - minLat
    val dLng = maxLng - minLng
    val stepSizeLng = dLng * stepRatio
    val stepSizeLat = dLat * stepRatio
    val lngRange = minLng to maxLng by stepSizeLng
    val latRange = minLat to maxLat by stepSizeLat

    val latLngs = for {
      lat <- latRange
      lng <- lngRange
    } yield JsonLatLng(lat, lng)
    latLngs.toList
  }

  /**
    * Make a grid of latlng coordinates in a bounding box specified by a pair of latlng coordinates
    * @param lat1 Latitude
    * @param lng1 Longitude
    * @param lat2 Latitude
    * @param lng2 Longitude
    * @param stepSize A step size in meters
    * @return A list of latlng grid
    */
  def makeALatLngGrid(lat1: Double, lng1: Double, lat2: Double, lng2: Double, stepSize: Double): List[JsonLatLng] =
    makeALatLngGrid(JsonLatLng(lat1, lng1), JsonLatLng(lat2, lng2), stepSize)

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
}
