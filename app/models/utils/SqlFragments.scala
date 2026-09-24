package models.utils

import models.utils.MyPostgresProfile.api._
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
