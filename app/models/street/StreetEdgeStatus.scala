package models.street

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Enumeration of a street edge's intrinsic availability, backing the `street_edge_status` Postgres enum type.
 *
 * A street is live/auditable only when its status is `Open`. The values are:
 *   - `open`       the street is usable (has imagery, is in an opened region, and is not manually disabled)
 *   - `no_imagery` no street-view imagery is available, so the street can't be audited
 *   - `closed`     the street's region has not been opened to the public (mirrors `region.deleted`; kept in sync by
 *                  db/scripts/reveal-or-hide-regions.sh, which flips streets between `open` and `closed`)
 *   - `disabled`   manually hidden for some other reason (e.g. OSM miscategorized a highway as a road); the catch-all
 *
 * NOTE: if changing these values, update the `street_edge_status` Postgres enum type as well (see 325.sql). The
 * string values are emitted directly in the `/v3/api/streets` responses.
 */
enum StreetEdgeStatus(val name: String) extends NamedEnum {
  case Open      extends StreetEdgeStatus("open")
  case NoImagery extends StreetEdgeStatus("no_imagery")
  case Closed    extends StreetEdgeStatus("closed")
  case Disabled  extends StreetEdgeStatus("disabled")
}

object StreetEdgeStatus extends PgEnumCompanion[StreetEdgeStatus]("street_edge_status")
