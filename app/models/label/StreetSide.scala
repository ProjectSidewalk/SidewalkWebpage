package models.label

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Which side of its street a label sits on, backing the `street_side` Postgres enum type (#2886).
 *
 * Relative to the digitized direction of the label's `street_edge_id`, not cardinal: `Left` is to the left when
 * walking the edge start to end. Derived in the DB from `label_point.centerline_offset_m` with a 1 m floor, so a label
 * within a metre of the centerline, or without a position, has no side; the column is GENERATED and never written
 * from Scala. The floor is measured across the street rather than along it, so a label sitting past the end of its
 * edge with barely any lateral offset has no side either, however far off the end it is (377.sql).
 *
 * NOTE: if changing these values, update the `street_side` Postgres enum type as well (see 377.sql).
 */
enum StreetSide(val name: String) extends NamedEnum {
  case Left  extends StreetSide("left")
  case Right extends StreetSide("right")
}

object StreetSide extends PgEnumCompanion[StreetSide]("street_side")
