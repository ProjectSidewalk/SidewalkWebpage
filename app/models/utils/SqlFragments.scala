package models.utils

import models.utils.MyPostgresProfile.api._
import slick.dbio.{DBIOAction, Effect, NoStream}
import slick.jdbc.{SQLActionBuilder, SetParameter}

import java.sql.Types

/**
 * Glue for raw SQL built from optional pieces, such as an API's filters. Each piece is a `sql"..."` fragment, so a
 * value from the request goes in as `$value` and is sent to Postgres separately from the query text, never pasted
 * into it. Slick can already append one fragment to another (`concat`); this adds joining a whole list.
 */
object SqlFragments {

  /** An empty fragment, for an optional piece that was left out. */
  val empty: SQLActionBuilder = sql""

  /**
   * Joins fragments with a separator, keeping each fragment's values in order.
   *
   * @param fragments The pieces to join.
   * @param separator Trusted SQL between each pair, such as `" OR "`.
   * @return The joined fragment, or an empty one when there are no pieces.
   */
  def join(fragments: Seq[SQLActionBuilder], separator: String): SQLActionBuilder =
    fragments.reduceOption((a, b) => a.concat(sql"#$separator").concat(b)).getOrElse(empty)

  /**
   * ANDs conditions together for a `WHERE` clause.
   *
   * @param conditions The conditions a row must all meet.
   * @return The combined condition; `TRUE` when there are none, so `WHERE` is still valid.
   */
  def allOf(conditions: Seq[SQLActionBuilder]): SQLActionBuilder =
    if (conditions.isEmpty) sql"TRUE" else join(conditions, " AND ")

  /**
   * Whether a geometry touches the bounding box.
   *
   * @param geomColumn A geometry column, written in code.
   * @return An `ST_Intersects` condition with the box's corners bound.
   */
  def intersectsBBox(geomColumn: String, bbox: LatLngBBox): SQLActionBuilder =
    sql"ST_Intersects(#$geomColumn, ".concat(envelope(bbox)).concat(sql")")

  /**
   * Whether a geometry's own bounding box overlaps this one: the cheap, index-only version of [[intersectsBBox]].
   *
   * @param geomColumn A geometry column, written in code.
   * @return A `&&` condition with the box's corners bound.
   */
  def overlapsBBox(geomColumn: String, bbox: LatLngBBox): SQLActionBuilder =
    sql"#$geomColumn && ".concat(envelope(bbox))

  /**
   * Whether a geometry lies entirely inside the bounding box.
   *
   * @param geomColumn A geometry column, written in code.
   * @return An `ST_Within` condition with the box's corners bound.
   */
  def withinBBox(geomColumn: String, bbox: LatLngBBox): SQLActionBuilder =
    sql"ST_Within(#$geomColumn, ".concat(envelope(bbox)).concat(sql")")

  /** The bounding box as a PostGIS rectangle in lat/lng, corners bound in the order ST_MakeEnvelope takes them. */
  private def envelope(bbox: LatLngBBox): SQLActionBuilder =
    sql"ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)"

  /**
   * Stops a query from being built with a name that isn't a plain lowercase identifier. Postgres can't take a schema
   * or table name as a bound value, so those are pasted into the SQL text, and this is what makes that safe.
   *
   * @param names Schema or table names about to be pasted into SQL.
   */
  def requireSafeIdentifiers(names: Iterable[String]): Unit = {
    val unsafe = names.filterNot(_.matches("^[a-z_][a-z0-9_]*$"))
    require(unsafe.isEmpty, s"Refusing to build SQL with non-identifier names: ${unsafe.mkString(", ")}")
  }

  /**
   * Runs `action` in a transaction with a Postgres setting changed for that transaction only (`SET LOCAL`).
   *
   * @param name  The setting, written in code.
   * @param value Its value, written in code.
   * @return The same action, wrapped in a transaction that applies the setting first.
   */
  def withLocalSetting[R, S <: NoStream, E <: Effect](name: String, value: String)(
      action: DBIOAction[R, S, E]
  ): DBIOAction[R, S, E with Effect.Transactional] =
    (sqlu"SET LOCAL #$name = #$value" >> action).transactionally

  /**
   * Runs `action` with Postgres's JIT compiler off, as a workaround for #4376 until JIT is disabled in the DB config.
   *
   * The projectsidewalk/db image ships a broken JIT (PostGIS bitcode built with LLVM 16, runtime llvmjit linked against
   * LLVM 11). A query expensive enough to JIT-inline PostGIS functions such as ST_Length crashes its backend, which
   * drops the connection (SQLSTATE 08006) and forces Postgres into crash recovery: a site-wide 502 (#4545).
   *
   * @return The same action, run in a transaction with JIT off.
   */
  def withJitOff[R, S <: NoStream, E <: Effect](
      action: DBIOAction[R, S, E]
  ): DBIOAction[R, S, E with Effect.Transactional] =
    withLocalSetting("jit", "off")(action)

  /**
   * A list of values for an enum column, written `= ANY(${SqlFragments.enumList(values)}::label_type[])`.
   *
   * A plain `Seq[String]` reaches Postgres as a text list, and converting that to an enum list hides the values from
   * its row estimates: `labelType=Signal` was planned for 220k rows instead of 4.6k on Seattle. Sent without a type,
   * the list is read straight as the enum, so Postgres estimates from the real values.
   *
   * @return The values, ready to bind.
   */
  def enumList(values: Iterable[String]): EnumList = EnumList(values.toSeq)

  /** Enum values bound as one untyped Postgres array; see [[enumList]]. */
  final case class EnumList(values: Seq[String])

  object EnumList {
    // Quotes every element so a comma or quote in a value stays inside it.
    implicit val setEnumList: SetParameter[EnumList] = SetParameter { (list, pp) =>
      val elements = list.values.map(v => "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
      pp.setObject(elements.mkString("{", ",", "}"), Types.OTHER)
    }
  }
}
