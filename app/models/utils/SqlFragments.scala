package models.utils

import models.utils.MyPostgresProfile.api._
import slick.jdbc.SQLActionBuilder

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
}
