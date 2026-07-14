package models.street

/**
 * Enumeration of a street edge's intrinsic availability, backing the `street_edge_status` Postgres enum type.
 *
 * A street is live/auditable only when its status is `Open`. The values are:
 *   - `open`       the street is usable (has imagery, is in an opened region, and is not manually disabled)
 *   - `no_imagery` no street-view imagery is available, so the street can't be audited
 *   - `closed`     the street's region has not been opened to the public (mirrors `region.deleted`; kept in sync by
 *                  db/scripts/reveal-or-hide-neighborhoods.sh, which flips streets between `open` and `closed`)
 *   - `disabled`   manually hidden for some other reason (e.g. OSM miscategorized a highway as a road); the catch-all
 *
 * NOTE: if changing these values, update the `street_edge_status` Postgres enum type as well (see 325.sql). The
 * string values are emitted directly in the `/v3/api/streets` responses.
 */
object StreetEdgeStatus extends Enumeration {
  type StreetEdgeStatus = Value
  val Open: Value      = Value("open")
  val NoImagery: Value = Value("no_imagery")
  val Closed: Value    = Value("closed")
  val Disabled: Value  = Value("disabled")

  /** Parses a string into a street edge status, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
