package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import play.api.libs.json._
import controllers.headers.ProvidesHeader

import math._
import models.user.{User, UserCurrentRegionTable}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._
import play.extras.geojson.{Feature => JsonFeature, LatLng => JsonLatLng, LineString => JsonLineString, Point => JsonPoint, Polygon => JsonPolygon}
import com.vividsolutions.jts.index.kdtree.{KdNode, KdTree}
import models.label.{LabelLocation, LabelTable}
import models.street.{StreetEdge, StreetEdgeTable}
import play.extras.geojson

import collection.immutable
import collection.immutable.Seq


class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def getAccessFeatures(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    val r = scala.util.Random
    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)

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
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }

  /**
    * AccessScore:Grid
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @param stepSize
    * @return
    */
  def getAccessScoreGrid(lat1: Double, lng1: Double, lat2: Double, lng2: Double, stepSize: Double) = UserAwareAction.async { implicit request =>
    val r = scala.util.Random

    val latLngList: List[JsonLatLng] = makeALatLngGrid(lat1, lng1, lat2, lng2, stepSize)



    val features: List[JsObject] = latLngList.map { latLng =>
      val point = JsonPoint(latLng)
      val properties = Json.obj(
        "score" -> r.nextDouble * r.nextDouble,  // Todo. Actually calculate the access score,
        "significance" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        ),
        "feature" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }

  /**
    *
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def getAccessScoreNeighborhood(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    val r = scala.util.Random
    val neighborhoods: List[NamedRegion] = RegionTable.selectNamedNeighborhoodsIn(lat1, lng1, lat2, lng2)
    val features: List[JsObject] = neighborhoods.map { region =>
      val coordinates: Array[Coordinate] = region.geom.getCoordinates
      val latlngs: Seq[JsonLatLng] = coordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val polygon: JsonPolygon[JsonLatLng] = JsonPolygon(Seq(latlngs))
      val properties = Json.obj(
        "region_id" -> region.regionId,
        "region_name" -> region.name,
        "score" -> r.nextDouble * r.nextDouble,  // Todo. Actually calculate the access score,
        "significance" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        ),
        "feature" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }

  /**
    * Get an access score of a given lat lng point
    * @param lat
    * @param lng
    * @return
    */
  def getAccessScorePoint(lat: Double, lng: Double) = UserAwareAction.async { implicit request =>
    val r = scala.util.Random
    val feature = JsonFeature(JsonPoint(JsonLatLng(lat, lng)),
      properties = Some(Json.obj(
        "score" -> r.nextDouble * r.nextDouble,  // Todo. Actually calculate the access score,
        "significance" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        ),
        "feature" -> Json.obj(
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        )
      ))
    )
    val json = Json.toJson(feature)
    Future.successful(Ok(json))
  }

  /**
    * AccessScore:Street
    *
    * E.g., /v1/access/street?lng1=-76.9975519180&lat1=38.910286924&lng2=-76.9920158386&lat2=38.90793262720
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def getAccessScoreStreet(lat1: Double, lng1: Double, lat2: Double, lng2: Double) = UserAwareAction.async { implicit request =>
    val r = scala.util.Random
    val minLat = min(lat1, lat2)
    val maxLat = max(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLng = max(lng1, lng2)

    // Retrieve data and cluster them by location and label type.
    val labelLocations: List[LabelLocation] = LabelTable.selectLocationsOfLabelsIn(minLat, minLng, maxLat, maxLng)
    val clusteredLabelLocations: List[LabelLocation] = clusterLabelLocations(labelLocations)
    val streetEdges: List[StreetEdge] = StreetEdgeTable.selectStreetsWithin(minLat, minLng, maxLat, maxLng)

    val streetJson = computeAccessScoresForStreets(streetEdges, clusteredLabelLocations)

    val features: List[JsObject] = streetEdges.map { edge =>
      val coordinates: Array[Coordinate] = edge.geom.getCoordinates
      val latlngs: List[JsonLatLng] = coordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> edge.streetEdgeId,
        "score" -> r.nextDouble * r.nextDouble,  // Todo. Actually calculate the access score,
        "significance" -> Json.obj(
          "CurbRamp" -> 1.0,
          "NoCurbRamp" -> -1.0,
          "Obstacle" -> -1.0,
          "SurfaceProblem" -> -1.0
        ),
        "feature" -> Json.obj(
          "CurbRamp" -> 1.0,
          "NoCurbRamp" -> 1.0,
          "Obstacle" -> 1.0,
          "SurfaceProblem" -> 1.0
        )
      )

      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> streetJson)
    Future.successful(Ok(featureCollection))
  }


  // Helper methodss
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
    */

  def computeAccessScoresForStreets(streets: List[StreetEdge], labelLocations: List[LabelLocation]): List[JsObject] = {
    val radius = 1.5E-4  // Approximately 5 meters
    val pm = new PrecisionModel()
    val srid = 4326
    val factory: GeometryFactory = new GeometryFactory(pm, srid)

    val streetJson = streets.map { edge =>
      // Expand each edge a little bit and count the number of accessibility features.
      val buffer: Geometry = edge.geom.buffer(radius)

//      val c: Seq[JsonLatLng] = buffer.getCoordinates.map(c => JsonLatLng(c.y, c.x)).toList
//      val bufferPolygon = JsonPolygon(Seq(c))
//      val jsonObj = Json.obj("type" -> "Feature", "geometry" -> bufferPolygon, "properties" -> Json.obj("id" -> 1))

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

      // Compute an access score. Todo. Finalize the equation
      val features = Array(labelCounter("CurbRamp"), labelCounter("NoCurbRamp"), labelCounter("Obstacle"), labelCounter("SurfaceProblem")).map(_.toDouble)
      val significance = Array(1.0, -1.0, -1.0, -1.0)
      val accessScore: Double = computeAccessScore(features, significance)

      val latlngs: List[JsonLatLng] = edge.geom.getCoordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
      val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> edge.streetEdgeId,
        "score" -> accessScore,
        "significance" -> Json.obj(
          "CurbRamp" -> 1.0,
          "NoCurbRamp" -> -1.0,
          "Obstacle" -> -1.0,
          "SurfaceProblem" -> -1.0
        ),
        "feature" -> Json.obj(
          "CurbRamp" -> labelCounter("CurbRamp").toDouble,
          "NoCurbRamp" -> labelCounter("NoCurbRamp").toDouble,
          "Obstacle" -> labelCounter("Obstacle").toDouble,
          "SurfaceProblem" -> labelCounter("SurfaceProblem").toDouble
        )
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }
    streetJson
  }

  def computeAccessScore(features: Array[Double], significance: Array[Double]): Double = {
    val t = (for ( (f, s) <- (features zip significance) ) yield f * s).sum  // dot product
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
