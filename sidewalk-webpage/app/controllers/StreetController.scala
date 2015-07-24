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

  /**
   * This returns a list of all the streets stored in the database
   * @return
   */
  def listStreets = Action {
    val features: List[JsObject] = StreetEdgeTable.all.map { edge =>
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

  val streetEdges = TableQuery[StreetEdgeTable]
  val assignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]

  def join(limit: Int) = DBAction { implicit js =>
    val joinQuery = for {
      se <- streetEdges if se.streetEdgeId > 10
      sac <- assignmentCounts if se.streetEdgeId === sac.streetEdgeId
    } yield (se.streetEdgeId, sac.assignmentCount)

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
