package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import play.api.libs.json._

import controllers.headers.ProvidesHeader
import math._
import models.user.{User, UserCurrentRegionTable}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

import play.extras.geojson.LatLng
import com.vividsolutions.jts.geom.{LineString, Coordinate, CoordinateSequence, GeometryFactory, PrecisionModel}
import collection.immutable.Seq


class ProjectSidewalkAPIController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

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
    import play.extras.geojson.Point
    val r = scala.util.Random

    val latLngList: List[LatLng] = makeALatLngGrid(lat1, lng1, lat2, lng2, stepSize)
    val features: List[JsObject] = latLngList.map { latLng =>
      val point = Point(latLng)
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


  // Helper methodss
  /**
    * Make a grid of latlng coordinates in a bounding box specified by a pair of latlng coordinates
    * @param lat1 Latitude
    * @param lng1 Longitude
    * @param lat2 Latitude
    * @param lng2 Longitude
    * @param stepSize A step size in meters
    * @return A list of latlng grid
    */
  def makeALatLngGrid(lat1: Double, lng1: Double, lat2: Double, lng2: Double, stepSize: Double): List[LatLng] =
    makeALatLngGrid(LatLng(lat1, lng1), LatLng(lat2, lng2), stepSize)

  /**
    * Make a grid of latlng coordinates in a bounding box specified by a pair of latlng coordinates
    * @param latLng1 A latlng coordinate
    * @param latLng2 A latlng coordinate
    * @param stepSize A step size in meters
    * @return A list of latlng grid
    */
  def makeALatLngGrid(latLng1: LatLng, latLng2: LatLng, stepSize: Double): List[LatLng] = {
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
      lat <- latRange;
      lng <- lngRange
    } yield LatLng(lat, lng)
    latLngs.toList
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
  def haversine(latLng1: LatLng, latLng2: LatLng): Double = haversine(latLng1.lat, latLng1.lng, latLng2.lat, latLng2.lng)
}
