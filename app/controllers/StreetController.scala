package controllers

import play.api.libs.json._
import play.extras.geojson
import com.vividsolutions.jts.geom.Coordinate

import models.utils.MyPostgresDriver.api._
import play.api.mvc._
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{I18nSupport, MessagesApi}

import models.street._
import play.api.libs.json.Json
import play.api.libs.json.Json._

/**
 * Street controller
 */
object StreetController extends Controller {

  val streetEdges = TableQuery[StreetEdgeTable]

  /**
   * This returns a list of all the streets stored in the database
   * @return
   */
  def getStreets(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) = Action { implicit request =>
    val streetEdges = StreetEdgeTable.selectStreetsIntersecting(minLat, minLng, maxLat, maxLng)
    val features: List[JsObject] = streetEdges.map { edge =>
      val coordinates: Array[Coordinate] = edge.geom.getCoordinates
      val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
      val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> edge.streetEdgeId,
        "way_type" -> edge.wayType
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Ok(featureCollection)
  }
}
