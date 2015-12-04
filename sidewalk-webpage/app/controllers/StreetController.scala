package controllers

import play.api.mvc._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import play.extras.geojson
import com.vividsolutions.jts.io.{WKBReader, WKBWriter, WKTReader}
import com.vividsolutions.jts.geom.{LineString, Coordinate, CoordinateSequence, GeometryFactory, PrecisionModel}
import collection.immutable.Seq

import play.api.db.slick._

// import play.api.db.slick.Config.driver.simple._
import models.utils.MyPostgresDriver.simple._
import play.api.mvc._

import models.street._
import play.api.libs.json.Json
import play.api.libs.json.Json._

/**
 * Street controller
 */
object StreetController extends Controller {

  val streetEdges = TableQuery[StreetEdgeTable]
  val assignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]

  /**
   * This returns a list of all the streets stored in the database
   * @return
   */
  def getStreets(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) = Action { implicit request =>
    val streetEdges = StreetEdgeTable.getWithIn(minLat, minLng, maxLat, maxLng)
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


  def join(limit: Int) = DBAction { implicit js =>
    val joinQuery = for {
      se <- streetEdges if se.streetEdgeId > 10
      ac <- assignmentCounts if se.streetEdgeId === ac.streetEdgeId
    } yield (se.streetEdgeId, ac.assignmentCount)

    val tupleList = joinQuery.take(limit).list
    val listList = tupleList.map { t=> List(t._1, t._2)}

    Ok(toJson(listList))
  }

  implicit val assignmentFormat = Json.format[StreetEdgeAssignmentCount]
  def select = Action {
    val list = StreetEdgeAssignmentCountTable.selectAssignment
    Ok(toJson(list))
  }
}
