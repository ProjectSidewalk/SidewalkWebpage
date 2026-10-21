package models.street

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * The evidence behind a block face's [[SidewalkPresenceStatus]], backing the `sidewalk_presence_basis` Postgres enum
 * type (#5279). Listed in the order the derivation tries them; the first that applies wins.
 *
 *   - `NoSidewalkLabels`: the face carries at least one NoSidewalk label (verdict `absent`). The label count is the
 *     confidence: measured against Seattle's sidewalk inventory, one label is right 69% of the time, two 80%, three
 *     or more 84%.
 *   - `OtherSideTag`: the face has no NoSidewalk label of its own, but the opposite face has one tagged
 *     "street has no sidewalks" (verdict `absent`, 78%).
 *   - `AuditedNoLabels`: the street has a completed audit and nobody placed a NoSidewalk label on this face
 *     (verdict `present`, 96%).
 *   - `Unaudited`: no completed audit, so nothing can be said (verdict `unknown`).
 *
 * NOTE: if changing these values, update the `sidewalk_presence_basis` Postgres enum type as well (see 383.sql).
 */
enum SidewalkPresenceBasis(val name: String) extends NamedEnum {
  case NoSidewalkLabels extends SidewalkPresenceBasis("no_sidewalk_labels")
  case OtherSideTag     extends SidewalkPresenceBasis("other_side_tag")
  case AuditedNoLabels  extends SidewalkPresenceBasis("audited_no_labels")
  case Unaudited        extends SidewalkPresenceBasis("unaudited")
}

object SidewalkPresenceBasis extends PgEnumCompanion[SidewalkPresenceBasis]("sidewalk_presence_basis")
