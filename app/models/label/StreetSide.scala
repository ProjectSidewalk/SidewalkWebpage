package models.label

/**
 * Which side of its street a label sits on, backing the `street_side` Postgres enum type (#2886).
 *
 * Relative to the digitized direction of the label's `street_edge_id`, not cardinal: `Left` is to the left when
 * walking the edge start to end. Derived in the DB from `label_point.centerline_offset_m` with a 1 m floor, so a label
 * within a metre of the centerline, or without a position, has no side; the column is GENERATED and never written
 * from Scala.
 *
 * NOTE: if changing these values, update the `street_side` Postgres enum type as well (see 374.sql).
 */
object StreetSide extends Enumeration {
  type StreetSide = Value
  val Left: Value  = Value("left")
  val Right: Value = Value("right")

  /** Parses a string into a street side, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
