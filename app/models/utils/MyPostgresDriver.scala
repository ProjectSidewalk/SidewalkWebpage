package models.utils

import com.github.tminglei.slickpg._
import play.api.libs.json.{JsValue, Json, Writes}
import com.vividsolutions.jts.geom.{LineString, MultiPolygon}
import org.wololo.jts2geojson.GeoJSONWriter

trait MyPostgresDriver extends ExPostgresDriver
  with PgArraySupport
  with PgDateSupport
  with PgPlayJsonSupport
  with PgNetSupport
  with PgLTreeSupport
  with PgRangeSupport
  with PgHStoreSupport
  with PgSearchSupport
  with PgPostGISSupport {

  override val pgjson = "jsonb"

  trait MyAPI extends API
    with PostGISImplicits
    with PostGISAssistants
    with ArrayImplicits
    with DateTimeImplicits
    with PlayJsonImplicits
    with NetImplicits
    with LTreeImplicits
    with RangeImplicits
    with HStoreImplicits
    with SearchImplicits
    with SearchAssistants

  override val api = new MyAPI {
    implicit val multiPolygonWrites: Writes[MultiPolygon] = new Writes[MultiPolygon] {
      override def writes(multiPolygon: MultiPolygon): JsValue = {
        val writer = new GeoJSONWriter()
        val geojson = writer.write(multiPolygon)
        Json.parse(geojson.toString)
      }
    }
    implicit val LineStringWrites: Writes[LineString] = new Writes[LineString] {
      override def writes(lineString: LineString): JsValue = {
        val writer = new GeoJSONWriter()
        val geojson = writer.write(lineString)
        Json.parse(geojson.toString)
      }
    }
  }

  val plainAPI = new MyAPI {}
}

object MyPostgresDriver extends MyPostgresDriver
