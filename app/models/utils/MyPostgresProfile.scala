package models.utils

import com.fasterxml.jackson.databind.ObjectMapper
import com.github.tminglei.slickpg._
import com.github.tminglei.slickpg.geom.PgPostGISExtensions
import org.locationtech.jts.geom.{Geometry, LineString, MultiPolygon, Point}
import org.n52.jackson.datatype.jts.JtsModule
import play.api.libs.functional.syntax.{toFunctionalBuilderOps, unlift}
import play.api.libs.json._

trait MyPostgresProfile
    extends ExPostgresProfile
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

  // Add back `capabilities.insertOrUpdate` to enable native `upsert` support; for postgres 9.5+.
  // https://github.com/tminglei/slick-pg/tree/1c9fe0e069c91e3b64ee824fff1b6f925ea53bbd
  override protected def computeCapabilities: Set[slick.basic.Capability] =
    super.computeCapabilities + slick.jdbc.JdbcCapabilities.insertOrUpdate

  override val api = MyAPI

  object MyAPI
      extends ExtPostgresAPI
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
    implicit val lineStringWrites: Writes[LineString]     = geometryWrites.contramap(identity)
    implicit val pointWrites: Writes[Point]               = geometryWrites.contramap(identity)

    // New mapper for Seq[ExcludedTag] stored as JSONB.
    import models.utils.ExcludedTag._
    implicit val excludedTagListMapper: DriverJdbcType[Seq[ExcludedTag]] =
      new GenericJdbcType[Seq[ExcludedTag]](
        pgjson,
        s => if (s == null) List.empty[ExcludedTag] else Json.parse(s).as[Seq[ExcludedTag]],
        v => Json.stringify(Json.toJson(v))
      )
  }
}

// Define ExcludedTag and it's formatter. Stored in the database as JSONB.
case class ExcludedTag(labelType: String, tag: String)
object ExcludedTag {
  implicit val excludedTagFormat: Format[ExcludedTag] = {
    val reads: Reads[ExcludedTag] = (
      (__ \ "label_type").read[String] and
        (__ \ "tag").read[String]
    )(ExcludedTag.apply _)

    val writes: Writes[ExcludedTag] = (
      (__ \ "label_type").write[String] and
        (__ \ "tag").write[String]
    )(unlift(ExcludedTag.unapply))

    Format(reads, writes)
  }
}

object MyPostgresProfile extends MyPostgresProfile
