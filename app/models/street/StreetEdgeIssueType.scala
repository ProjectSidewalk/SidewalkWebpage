package models.street

/**
 * Enumeration of the issues users can report for a street, backing the `street_edge_issue_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `street_edge_issue_type` Postgres enum type as well (see 342.sql).
 */
object StreetEdgeIssueType extends Enumeration {
  type StreetEdgeIssueType = Value
  val PanoNotAvailable: Value = Value("PanoNotAvailable")

  /** Parses a string into a street edge issue type, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
