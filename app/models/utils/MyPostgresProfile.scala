package models.utils

import com.github.tminglei.slickpg.*
import com.github.tminglei.slickpg.geom.PgPostGISExtensions
import org.locationtech.jts.geom.{Coordinate, Geometry, LineString, MultiPolygon, Point, Polygon}
import play.api.libs.json.*
import slick.jdbc.{JdbcType, PositionedResult}
import slick.lifted.OptionMapperDSL

import java.math.RoundingMode
import scala.annotation.targetName

trait MyPostgresProfile
    extends ExPostgresProfile
    with PgArraySupport
    with PgDate2Support
    with PgPostGISExtensions
    with PgPlayJsonSupport
    with PgEnumSupport
    with PgPostGISSupport {

  override val pgjson = "jsonb"

  // Add back `capabilities.insertOrUpdate` to enable native `upsert` support; for postgres 9.5+.
  // https://github.com/tminglei/slick-pg/tree/1c9fe0e069c91e3b64ee824fff1b6f925ea53bbd
  override protected def computeCapabilities: Set[slick.basic.Capability] =
    super.computeCapabilities + slick.jdbc.JdbcCapabilities.insertOrUpdate

  override val api: MyAPI.type = MyAPI

  object MyAPI
      extends ExtPostgresAPI
      with PostGISImplicits
      with PostGISPlainImplicits
      with PostGISAssistants
      with ArrayImplicits
      with SimpleArrayPlainImplicits      // Plain for raw queries
      with Date2DateTimePlainImplicits    // Plain for raw queries
      with Date2DateTimeImplicitsDuration // For compiled queries
      with JsonImplicits {

    /** Postgres's `random()`, a fresh draw in [0, 1) per row, so `sortBy(_ => random)` shuffles a query's rows. */
    val random: Rep[Double] = SimpleFunction.nullary[Double]("random")

    // Postgres won't save plain text into an inet column, so the value is sent untyped and Postgres reads it as an IP.
    given ipAddressMapper: JdbcType[IpAddress] = GenericJdbcType[IpAddress]("inet", IpAddress(_), _.value)

    // Built once and shared, because slick-pg looks an array's element type up by `tag.repr`: a bare
    // `nextArray[T]()` rebuilds the tag and re-renders that string per row, ~0.3 µs inside the `GetResult`.
    private val stringElementTag: izumi.reflect.Tag[String] = izumi.reflect.Tag[String]
    private val intElementTag: izumi.reflect.Tag[Int]       = izumi.reflect.Tag[Int]

    /** Array readers for a raw query's row. Use these rather than `nextArray[T]()`, which is slower per row. */
    extension (r: PositionedResult) {
      def nextStringArray(): Seq[String] = r.nextArray[String]()(using stringElementTag)
      def nextIntArray(): Seq[Int]       = r.nextArray[Int]()(using intElementTag)
    }

    /** One coordinate value, rounded to 8 decimal places (about a millimeter) so responses stay small. */
    private def geoJsonNumber(value: Double): JsNumber =
      JsNumber(BigDecimal(java.math.BigDecimal(value).setScale(8, RoundingMode.HALF_UP).stripTrailingZeros))

    /** One GeoJSON position: `[lng, lat]`. */
    private def geoJsonPosition(coord: Coordinate): JsArray =
      JsArray(Seq(geoJsonNumber(coord.getX), geoJsonNumber(coord.getY)))

    private def geoJsonLine(line: LineString): JsArray = JsArray(line.getCoordinates.toSeq.map(geoJsonPosition))

    /** A polygon's rings: the outline first, then any holes. */
    private def geoJsonRings(polygon: Polygon): JsArray = {
      val holes: Seq[LineString] = (0 until polygon.getNumInteriorRing).map(polygon.getInteriorRingN)
      JsArray((polygon.getExteriorRing +: holes).map(geoJsonLine))
    }

    private def geoJson(geometryType: String, coordinates: JsArray): JsObject =
      Json.obj("type" -> geometryType, "coordinates" -> coordinates)

    // A geometry type can only go into JSON once it has a line here.
    given pointWrites: Writes[Point]           = Writes(point => geoJson("Point", geoJsonPosition(point.getCoordinate)))
    given lineStringWrites: Writes[LineString] = Writes(line => geoJson("LineString", geoJsonLine(line)))
    given multiPolygonWrites: Writes[MultiPolygon] = Writes { multiPolygon =>
      val polygons = (0 until multiPolygon.getNumGeometries).map(multiPolygon.getGeometryN(_).asInstanceOf[Polygon])
      geoJson("MultiPolygon", JsArray(polygons.map(geoJsonRings)))
    }

    /**
     * Spatial measurements that return Double, matching PostGIS's `double precision`, where slick-pg's return Float.
     * To add one, copy it from PgPostGISExtensions.scala and change Float to Double.
     */
    extension [G1 <: Geometry](c: Rep[G1]) {

      /**
       * Geodesic length in meters of a 4326 geometry, measured on the WGS84 spheroid via a `::geography` cast.
       *
       * This is the canonical measure for street distances (#4641): accurate worldwide, and consistent with the
       * frontend, which measures distances geodesically with turf.js. Never measure by projecting to a fixed CRS —
       * transverse Mercator distortion away from the zone's central meridian reaches +51% (Auckland through the
       * UTM zone 18N that all cities were once measured in).
       *
       * Only for non-nullable geometry columns: NULL would fail result conversion outside an aggregate.
       */
      def lengthGeodesic: Rep[Double] = SimpleExpression
        .unary[G1, Double] { (geomNode, queryBuilder) =>
          queryBuilder.sqlBuilder += "ST_Length(("
          queryBuilder.expr(geomNode)
          queryBuilder.sqlBuilder += ")::geography)"
          ()
        }
        .apply(c)

      def distanceSphereD[P2, R](geom: Rep[P2])(using om: OptionMapperDSL.arg[G1, G1]#to[Double, R]): Rep[R] =
        om.column(GeomLibrary.DistanceSphere, c.toNode, geom.toNode)

      def azimuthD[P2, R](geom: Rep[P2])(using om: OptionMapperDSL.arg[G1, G1]#to[Double, R]): Rep[R] =
        om.column(GeomLibrary.Azimuth, c.toNode, geom.toNode)
    }

    /** The same for a nullable geometry column, where the result is nullable too. */
    extension [G1 <: Geometry](c: Rep[Option[G1]]) {
      // Named apart because the JVM can't tell a nullable column from a plain one.
      @targetName("distanceSphereDNullable")
      def distanceSphereD[P2, R](geom: Rep[P2])(using om: OptionMapperDSL.arg[G1, Option[G1]]#to[Double, R]): Rep[R] =
        om.column(GeomLibrary.DistanceSphere, c.toNode, geom.toNode)
    }

    // New mapper for Seq[ExcludedTag] stored as JSONB.
    given excludedTagListMapper: DriverJdbcType[Seq[ExcludedTag]] =
      GenericJdbcType[Seq[ExcludedTag]](
        pgjson,
        s => if (s == null) List.empty[ExcludedTag] else Json.parse(s).as[Seq[ExcludedTag]],
        v => Json.stringify(Json.toJson(v))
      )

    // New mapper for Seq[AiTagConfidence] stored as JSONB.
    given aiTagConfidenceSeqMapper: DriverJdbcType[Seq[AiTagConfidence]] =
      GenericJdbcType[Seq[AiTagConfidence]](
        pgjson,
        s => if (s == null) List.empty[AiTagConfidence] else Json.parse(s).as[Seq[AiTagConfidence]],
        v => Json.stringify(Json.toJson(v))
      )

    // New mapper for Seq[ClusteringThreshold] stored as JSONB.
    given clusteringThresholdSeqMapper: DriverJdbcType[Seq[ClusteringThreshold]] =
      GenericJdbcType[Seq[ClusteringThreshold]](
        pgjson,
        s => if (s == null) List.empty[ClusteringThreshold] else Json.parse(s).as[Seq[ClusteringThreshold]],
        v => Json.stringify(Json.toJson(v))
      )
  }
}

/** A visitor's IP address, stored as `inet`. Prints as just the address, so it works in rate-limit keys. */
case class IpAddress(value: String) {
  override def toString: String = value
}

// Define ExcludedTag and it's formatter. Stored in the database as JSONB.
// Would like to use a composite type in the future once there is more support in Slick for them.
case class ExcludedTag(labelType: String, tag: String)
object ExcludedTag {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  given excludedTagFormat: Format[ExcludedTag] = Json.format[ExcludedTag]
}

// Define AiTag and it's formatter. Stored in the database as JSONB.
// Would like to use a composite type in the future once there is more support in Slick for them.
case class AiTagConfidence(tag: String, confidence: Double)
object AiTagConfidence {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  given aiTagConfidenceFormat: Format[AiTagConfidence] = Json.format[AiTagConfidence]
}

// Define ClusteringThreshold and it's formatter. Stored in the database as JSONB.
// Would like to use a composite type in the future once there is more support in Slick for them.
case class ClusteringThreshold(labelType: String, threshold: Double)
object ClusteringThreshold {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  given clusteringThresholdFormat: Format[ClusteringThreshold] = Json.format[ClusteringThreshold]
}

object MyPostgresProfile extends MyPostgresProfile
