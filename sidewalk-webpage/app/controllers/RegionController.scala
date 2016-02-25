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

import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

object RegionController extends Controller {

  val regions = TableQuery[RegionTable]
  val regionTypes = TableQuery[RegionTypeTable]

  /**
   * This returns a list of all the streets stored in the database
   * @return
   */
  def listNeighborhoods = Action {
    val features: List[JsObject] = RegionTable.listRegionOfType("neighborhood").map { region =>
      val coordinates: Array[Coordinate] = region.geom.getCoordinates
      val latlngs: Seq[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
      val polygon: geojson.Polygon[geojson.LatLng] = geojson.Polygon(Seq(latlngs))
      val properties = Json.obj(
        "region_id" -> region.regionId,
        "description" -> region.description
      )
      Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Ok(featureCollection)
  }
}
