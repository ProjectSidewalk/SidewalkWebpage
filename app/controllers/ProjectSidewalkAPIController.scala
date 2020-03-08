package controllers


import collection.immutable.Seq
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import com.vividsolutions.jts.index.kdtree.{KdNode, KdTree}
import controllers.headers.ProvidesHeader
import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeTable}

import math._
import models.region._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelLocation, LabelTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.user.{User, WebpageActivity, WebpageActivityTable}
import play.api.cache.Cache
import play.api.Play.current
import play.api.libs.json._
import play.api.libs.json.Json._
import play.extras.geojson.{LatLng => JsonLatLng, LineString => JsonLineString, Point => JsonPoint, Polygon => JsonPolygon}

import scala.concurrent.Future


class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class AccessScoreStreet(streetEdge: StreetEdge, score: Double, attributes: Array[Double], significance: Array[Double])
  case class AttributeForAccessScore(lat: Float, lng: Float, labelType: String)

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
    * Returns all the global attributes within the bounding box and the labels that make up those attributes in geojson.
    *
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @param severity   The severity of the attributes that should be added in the geojson
    */
  def getAccessAttributesWithLabelsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, severity: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat:Float = min(lat1, lat2).toFloat
    val maxLat:Float = max(lat1, lat2).toFloat
    val minLng:Float = min(lng1, lng2).toFloat
    val maxLng:Float = max(lng1, lng2).toFloat

    val features: List[JsObject] =
      GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(minLat, minLng, maxLat, maxLng, severity).map(_.toJSON)

    Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
  }

  /**
    * Returns all the global attributes within the bounding box in geoJson.
    *
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @param severity   The severity of the attributes that should be added in the geojson
    */
  def getAccessAttributesV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double, severity: Option[String]) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat:Float = min(lat1, lat2).toFloat
    val maxLat:Float = max(lat1, lat2).toFloat
    val minLng:Float = min(lng1, lng2).toFloat
    val maxLng:Float = max(lng1, lng2).toFloat

    val features: List[JsObject] =
      GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat, minLng, maxLat, maxLng, severity).map(_.toJSON)

    Future.successful(Ok(Json.obj("type" -> "FeatureCollection", "features" -> features)))
  }

    /**
    * Returns all the global attributes within the bounding box in geoJson.
    *
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @param severity   The severity of the attributes that should be added in the geojson
    */
  def getAccessAttributesV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)

    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)

    def prepareFeatureCollection = {
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

    val featureCollection = if (request.toString == "GET /v1/access/attributes?lat1=38.761&lng1=-77.262&lat2=39.060&lng2=-76.830") {
      Cache.getOrElse(request.toString, 1800){
        prepareFeatureCollection
      }
    } else {
      prepareFeatureCollection
    }
    Future.successful(Ok(featureCollection))
  }

  /**
    * Gets the access score for a given neighborhood within a bounding box
    *
    * E.g. /v1/access/score/neighborhood?lng1=-77.01098442077637&lat1=38.89035159350444&lng2=-76.97793960571289&lat2=38.91851800248647
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @return           The access score for the given neighborhood
    */
  def getAccessScoreNeighborhoodsV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    Future.successful(Ok(getAccessScoreNeighborhoodsGeneric(lat1, lng1, lat2, lng2, version = 1, request.toString)))
  }

  /**
    *
    * E.g. /v2/access/score/neighborhood?lng1=-77.01098442077637&lat1=38.89035159350444&lng2=-76.97793960571289&lat2=38.91851800248647
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @return           The access score for the given neighborhood
    */
  def getAccessScoreNeighborhoodsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    Future.successful(Ok(getAccessScoreNeighborhoodsGeneric(lat1, lng1, lat2, lng2, version = 2, request.toString)))
  }

  def getAccessScoreNeighborhoodsGeneric(lat1: Double, lng1: Double, lat2: Double, lng2: Double, version: Int, requestStr: String) = {
    // Retrieve data and cluster them by location and label type.
    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)
    val severity: Option[String] = None

    // Retrieve data and cluster them by location and label type.
    def prepareFeatureCollection = {
      val labelsForScore: List[AttributeForAccessScore] = version match {
        case 1 =>
          val labelLocations: List[LabelLocation] = LabelTable.selectLocationsOfLabelsIn(minLat, minLng, maxLat, maxLng)
          val clusteredLabelLocations: List[LabelLocation] = clusterLabelLocations(labelLocations)
          clusteredLabelLocations.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType))
        case 2 =>
          val globalAttributes: List[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat.toFloat, minLng.toFloat, maxLat.toFloat, maxLng.toFloat, severity)
          globalAttributes.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType))
      }
      val allStreetEdges: List[StreetEdge] = StreetEdgeTable.selectStreetsIntersecting(minLat, minLng, maxLat, maxLng)
      val auditedStreetEdges: List[StreetEdge] = StreetEdgeTable.selectAuditedStreetsIntersecting(minLat, minLng, maxLat, maxLng)
      val neighborhoods: List[NamedRegion] = RegionTable.selectNamedNeighborhoodsWithin(lat1, lng1, lat2, lng2)

      val neighborhoodJson = for (neighborhood <- neighborhoods) yield {
        // prepare a geometry
        val coordinates: Array[Coordinate] = neighborhood.geom.getCoordinates
        val latlngs: Seq[JsonLatLng] = coordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
        val polygon: JsonPolygon[JsonLatLng] = JsonPolygon(Seq(latlngs))

        // Get access score
        // Element-wise sum of arrays: http://stackoverflow.com/questions/32878818/how-to-sum-up-every-column-of-a-scala-array
        val auditedStreetsIntersectingTheNeighborhood = auditedStreetEdges.filter(_.geom.intersects(neighborhood.geom))
        if (auditedStreetsIntersectingTheNeighborhood.nonEmpty) {
          val streetAccessScores: List[AccessScoreStreet] = computeAccessScoresForStreets(auditedStreetsIntersectingTheNeighborhood, labelsForScore)  // I'm just interested in getting the attributes
          val averagedStreetFeatures = streetAccessScores.map(_.attributes).transpose.map(_.sum / streetAccessScores.size).toArray
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
            )
          )
          Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
        } else {
          val properties = Json.obj(
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
          Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
        }
      }
      Json.obj("type" -> "FeatureCollection", "features" -> neighborhoodJson)
    }

    // Cache. https://www.playframework.com/documentation/2.3.x/ScalaCache
    val featureCollection = if (requestStr == "GET /v1/access/score/neighborhoods?lat1=38.761&lng1=-77.262&lat2=39.060&lng2=-76.830"
                                || requestStr == "GET /v2/access/score/neighborhoods?lat1=38.761&lng1=-77.262&lat2=39.060&lng2=-76.830") {
      Cache.getOrElse(requestStr, 1800){
        prepareFeatureCollection
      }
    } else {
      prepareFeatureCollection
    }
    featureCollection
  }

  /**
    * AccessScore:Street
    *
    * E.g., /v1/access/score/streets?lng1=-76.9975519180&lat1=38.910286924&lng2=-76.9920158386&lat2=38.90793262720
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @return           The access score for the given neighborhood
    */
  def getAccessScoreStreetsV1(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    Future.successful(Ok(getAccessScoreStreetsGeneric(lat1, lng1, lat2, lng2, version = 1)))
  }

  /**
    * AccessScore:Street V2 (using new clustering methods)
    *
    * E.g., /v2/access/score/streets?lng1=-76.9975519180&lat1=38.910286924&lng2=-76.9920158386&lat2=38.90793262720
    * @param lat1       First lattitude value for the bounding box
    * @param lng1       First longitude value for the bounding box
    * @param lat2       Second lattitude value for the bounding box
    * @param lng2       Second longitude value for the bounding box
    * @return           The access score for the given neighborhood
    */
  def getAccessScoreStreetsV2(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    apiLogging(request.remoteAddress, request.identity, request.toString)
    Future.successful(Ok(getAccessScoreStreetsGeneric(lat1, lng1, lat2, lng2, version = 2)))
  }

  /**
    * Generic version of getAccessScoreStreets, makes appropriate changes for v1 vs. v2.
    *
    * @param lat1           First lattitude value for the bounding box
    * @param lng1           First longitude value for the bounding box
    * @param lat2           Second lattitude value for the bounding box
    * @param lng2           Second longitude value for the bounding box
    * @param version        The version that should be used to get the street score
    */
  def getAccessScoreStreetsGeneric(lat1: Double, lng1: Double, lat2: Double, lng2: Double, version: Int): JsObject = {
    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)
    val severity: Option[String] = None

    // Retrieve data and cluster them by location and label type.
    val labelsForScore: List[AttributeForAccessScore] = version match {
      case 1 =>
        val labelLocations: List[LabelLocation] = LabelTable.selectLocationsOfLabelsIn(minLat, minLng, maxLat, maxLng)
        val clusteredLabelLocations: List[LabelLocation] = clusterLabelLocations(labelLocations)
        clusteredLabelLocations.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType))
      case 2 =>
        val globalAttributes: List[GlobalAttributeForAPI] = GlobalAttributeTable.getGlobalAttributesInBoundingBox(minLat.toFloat, minLng.toFloat, maxLat.toFloat, maxLng.toFloat, severity)
        globalAttributes.map(l => AttributeForAccessScore(l.lat, l.lng, l.labelType))
    }
    val streetEdges: List[StreetEdge] = StreetEdgeTable.selectAuditedStreetsWithin(minLat, minLng, maxLat, maxLng)
    val streetAccessScores = computeAccessScoresForStreets(streetEdges, labelsForScore)

    val streetJson = streetAccessScores.map { streetAccessScore =>
      val latlngs: List[JsonLatLng] = streetAccessScore.streetEdge.geom.getCoordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> streetAccessScore.streetEdge.streetEdgeId,
        "score" -> streetAccessScore.score,
        "significance" -> Json.obj(
          "CurbRamp" -> streetAccessScore.significance(0),
          "NoCurbRamp" -> streetAccessScore.significance(1),
          "Obstacle" -> streetAccessScore.significance(2),
          "SurfaceProblem" -> streetAccessScore.significance(3)
        ),
        "feature" -> Json.obj(
          "CurbRamp" -> streetAccessScore.attributes(0),
          "NoCurbRamp" -> streetAccessScore.attributes(1),
          "Obstacle" -> streetAccessScore.attributes(2),
          "SurfaceProblem" -> streetAccessScore.attributes(3)
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }

    Json.obj("type" -> "FeatureCollection", "features" -> streetJson)
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
  def computeAccessScoresForStreets(streets: List[StreetEdge], labelLocations: List[AttributeForAccessScore]): List[AccessScoreStreet] = {
    val radius = 3.0E-4  // Approximately 10 meters
    val pm = new PrecisionModel()
    val srid = 4326
    val factory: GeometryFactory = new GeometryFactory(pm, srid)

    val streetAccessScores = streets.map { edge =>
      // Expand each edge a little bit and count the number of accessibility attributes.
      val buffer: Geometry = edge.geom.buffer(radius)

      //  Increment a value in Map: http://stackoverflow.com/questions/15505048/access-initialize-and-update-values-in-a-mutable-map
      val labelCounter = collection.mutable.Map[String, Int](
        "CurbRamp" -> 0,
        "NoCurbRamp" -> 0,
        "Obstacle" -> 0,
        "SurfaceProblem" -> 0
      ).withDefaultValue(0)
      labelLocations.foreach { ll =>
        val p: Point = factory.createPoint(new Coordinate(ll.lng.toDouble, ll.lat.toDouble))
        if (p.within(buffer)) {
          labelCounter(ll.labelType) += 1
        }
      }

      // Compute an access score.
      val attributes = Array(labelCounter("CurbRamp"), labelCounter("NoCurbRamp"), labelCounter("Obstacle"), labelCounter("SurfaceProblem")).map(_.toDouble)
      val significance = Array(0.75, -1.0, -1.0, -1.0)
      val accessScore: Double = computeAccessScore(attributes, significance)
      AccessScoreStreet(edge, accessScore, attributes, significance)
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
}
