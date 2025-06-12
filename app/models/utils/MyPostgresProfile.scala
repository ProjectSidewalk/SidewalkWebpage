package models.utils

import com.fasterxml.jackson.databind.ObjectMapper
import com.github.tminglei.slickpg._
import com.github.tminglei.slickpg.geom.PgPostGISExtensions
import org.locationtech.jts.geom.{Geometry, LineString, MultiPolygon, Point}
import org.n52.jackson.datatype.jts.JtsModule
import play.api.libs.json.{JsValue, Json, Writes}

trait MyPostgresProfile extends ExPostgresProfile
  with PgArraySupport
  with PgDate2Support
  with PgPostGISExtensions
  with PgPlayJsonSupport
  with PgNetSupport
  with PgLTreeSupport
  with PgRangeSupport
  with PgHStoreSupport
  with PgSearchSupport
  with PgPostGISSupport {

  override val pgjson = "jsonb"

  // TODO added based on documentation in 0.21.1, not sure if we want/need.
  // https://github.com/tminglei/slick-pg/tree/1c9fe0e069c91e3b64ee824fff1b6f925ea53bbd
  // Add back `capabilities.insertOrUpdate` to enable native `upsert` support; for postgres 9.5+
  override protected def computeCapabilities: Set[slick.basic.Capability] =
    super.computeCapabilities + slick.jdbc.JdbcCapabilities.insertOrUpdate

  override val api = MyAPI

  object MyAPI extends ExtPostgresAPI
    with PostGISImplicits
    with PostGISPlainImplicits
    with PostGISAssistants
    with ArrayImplicits
    with Date2DateTimeImplicitsDuration
    with JsonImplicits
    with NetImplicits
    with LTreeImplicits
    with RangeImplicits
    with HStoreImplicits
    with SearchImplicits
    with SearchAssistants {

    // Adds implicit conversion from JTS Geometry types to Play JSON JsValue. Need to explicitly add each geom type.
    private val mapper = new ObjectMapper()
    mapper.registerModule(new JtsModule())
    implicit val geometryWrites: Writes[Geometry] = Writes[Geometry] { geom =>
      Json.parse(mapper.writeValueAsString(geom))
    }
    implicit val multiPolygonWrites: Writes[MultiPolygon] = geometryWrites.contramap(identity)
    implicit val lineStringWrites: Writes[LineString] = geometryWrites.contramap(identity)
    implicit val pointWrites: Writes[Point] = geometryWrites.contramap(identity)

    // TODO These are included in the template code. Not sure if they'll be helpful.
    implicit val strSeqTypeMapper: DriverJdbcType[Seq[String]] = new SimpleArrayJdbcType[String]("text").to(_.toSeq)
    implicit val playJsonArrayTypeMapper: DriverJdbcType[Seq[JsValue]] =
      new AdvancedArrayJdbcType[JsValue](pgjson,
        (s) => utils.SimpleArrayUtils.fromString[JsValue](Json.parse(_))(s).orNull,
        (v) => utils.SimpleArrayUtils.mkString[JsValue](_.toString())(v)
      ).to(_.toSeq)
  }
}

object MyPostgresProfile extends MyPostgresProfile
