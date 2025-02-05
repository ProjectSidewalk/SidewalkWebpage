package models.utils

import com.github.tminglei.slickpg._
import play.api.libs.json.{JsValue, Json, Writes}
import com.vividsolutions.jts.geom.{LineString, MultiPolygon}
import org.wololo.jts2geojson.GeoJSONWriter

// Additional imports included by slick-pg maintainer.
//import com.github.tminglei.slickpg.utils.PlainSQLUtils.mkGetResult
//import com.vividsolutions.jts.geom.{Geometry, Polygon}
//import slick.jdbc.JdbcProfile
//import slick.jdbc.JdbcType
//import slick.profile.Capability

trait MyPostgresProfile extends ExPostgresProfile
  with PgArraySupport
  with PgDate2Support
  with PgPlayJsonSupport
  with PgNetSupport
  with PgLTreeSupport
  with PgRangeSupport
  with PgHStoreSupport
  with PgSearchSupport
  with PgPostGISSupport {

  override val pgjson = "jsonb"

  trait MyAPI extends API
    with PostGISImplicits // Maybe also PostGISPlainImplicits, slick-pg guy had that.
    with PostGISAssistants
    with ArrayImplicits
    with DateTimeImplicits
    with PlayJsonImplicits // Or maybe JsonImplicits, slick-pg guy had that.
    with NetImplicits
    with LTreeImplicits
    with RangeImplicits
    with HStoreImplicits
    with SearchImplicits
    with SearchAssistants {
    // TODO These were included after slick-pg guy helped us. Not sure if they'll be helpful.
//    implicit val strListTypeMapper = new SimpleArrayJdbcType[String]("text").to(_.toList)
//    implicit val playJsonArrayTypeMapper =
//      new AdvancedArrayJdbcType[JsValue](pgjson,
//        (s) => utils.SimpleArrayUtils.fromString[JsValue](Json.parse(_))(s).orNull,
//        (v) => utils.SimpleArrayUtils.mkString[JsValue](_.toString())(v)
//      ).to(_.toList)
//
//    implicit val getPolygon = mkGetResult(_.nextGeometry[Polygon]())
//    implicit val getPolygonOption = mkGetResult(_.nextGeometryOption[Polygon]())
  }

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

object MyPostgresProfile extends MyPostgresProfile
