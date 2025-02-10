package models.utils

import com.github.tminglei.slickpg._
import play.api.libs.json.{JsValue, Json, Writes}
import com.vividsolutions.jts.geom.Geometry
import org.wololo.jts2geojson.GeoJSONWriter
import slick.basic.Capability
import slick.driver.JdbcProfile

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

  // TODO added based on documentation in 0.18.1, not sure if we want/need.
  // https://github.com/tminglei/slick-pg/tree/9484247c6f608252644d99882109f8e0c380ad1c
  // Add back `capabilities.insertOrUpdate` to enable native `upsert` support; for postgres 9.5+
  override protected def computeCapabilities: Set[Capability] =
    super.computeCapabilities + JdbcProfile.capabilities.insertOrUpdate

  override val api = MyAPI

  object MyAPI extends API
    with PostGISImplicits
    with PostGISAssistants
    with ArrayImplicits
    with DateTimeImplicits
    with JsonImplicits
    with NetImplicits
    with LTreeImplicits
    with RangeImplicits
    with HStoreImplicits
    with SearchImplicits
    with SearchAssistants {

    implicit val geometryWrites: Writes[Geometry] = Writes[Geometry] { geom =>
      val writer = new GeoJSONWriter()
      val geojson = writer.write(geom)
      Json.parse(geojson.toString)
    }

    // TODO These were included after slick-pg guy helped us. Not sure if they'll be helpful.
    implicit val strListTypeMapper = new SimpleArrayJdbcType[String]("text").to(_.toList)
    implicit val playJsonArrayTypeMapper =
      new AdvancedArrayJdbcType[JsValue](pgjson,
        (s) => utils.SimpleArrayUtils.fromString[JsValue](Json.parse(_))(s).orNull,
        (v) => utils.SimpleArrayUtils.mkString[JsValue](_.toString())(v)
      ).to(_.toList)
  }
}

object MyPostgresProfile extends MyPostgresProfile
