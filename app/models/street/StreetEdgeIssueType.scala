package models.street

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Enumeration of the issues users can report for a street, backing the `street_edge_issue_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `street_edge_issue_type` Postgres enum type as well (see 342.sql).
 */
enum StreetEdgeIssueType(val name: String) extends NamedEnum {
  case PanoNotAvailable extends StreetEdgeIssueType("PanoNotAvailable")
}

object StreetEdgeIssueType extends PgEnumCompanion[StreetEdgeIssueType]("street_edge_issue_type")
