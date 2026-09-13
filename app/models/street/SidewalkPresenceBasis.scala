package models.street

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
object SidewalkPresenceBasis extends Enumeration {
  type SidewalkPresenceBasis = Value
  val NoSidewalkLabels: Value = Value("no_sidewalk_labels")
  val OtherSideTag: Value     = Value("other_side_tag")
  val AuditedNoLabels: Value  = Value("audited_no_labels")
  val Unaudited: Value        = Value("unaudited")

  /** Parses a string into a basis, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
