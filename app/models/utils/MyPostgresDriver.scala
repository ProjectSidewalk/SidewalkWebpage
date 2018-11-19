package models.utils

import com.github.tminglei.slickpg._
import com.github.tminglei.slickpg.utils.PlainSQLUtils.mkGetResult
import com.vividsolutions.jts.geom.{Geometry, Polygon}
import play.api.libs.json.{JsValue, Json}
import slick.driver.JdbcProfile
import slick.profile.Capability

trait MyPostgresDriver extends ExPostgresDriver
  with PgArraySupport
  with PgDate2Support
  with PgRangeSupport
  with PgHStoreSupport
  with PgPlayJsonSupport
  with PgSearchSupport
  with PgPostGISSupport
  with PgNetSupport
  with PgLTreeSupport {
  def pgjson = "jsonb" // jsonb support is in postgres 9.4.0 onward; for 9.3.x use "json"

  // Add back `capabilities.insertOrUpdate` to enable native `upsert` support; for postgres 9.5+
  override protected def computeCapabilities: Set[Capability] =
    super.computeCapabilities + JdbcProfile.capabilities.insertOrUpdate

  override val api = new MyAPI {}

  trait MyAPI extends API with ArrayImplicits
    with DateTimeImplicits
    with JsonImplicits
    with NetImplicits
    with LTreeImplicits
    with PostGISImplicits
    with PostGISPlainImplicits
    with RangeImplicits
    with HStoreImplicits
    with SearchImplicits
    with SearchAssistants {
    implicit val strListTypeMapper = new SimpleArrayJdbcType[String]("text").to(_.toList)
    implicit val playJsonArrayTypeMapper =
      new AdvancedArrayJdbcType[JsValue](pgjson,
        (s) => utils.SimpleArrayUtils.fromString[JsValue](Json.parse(_))(s).orNull,
        (v) => utils.SimpleArrayUtils.mkString[JsValue](_.toString())(v)
      ).to(_.toList)

    implicit val getPolygon = mkGetResult(_.nextGeometry[Polygon]())
    implicit val getPolygonOption = mkGetResult(_.nextGeometryOption[Polygon]())
  }
}

object MyPostgresDriver extends MyPostgresDriver