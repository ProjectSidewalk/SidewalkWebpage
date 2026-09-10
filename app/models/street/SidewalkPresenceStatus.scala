package models.street

/**
 * Whether a block face (one side of one street) has a sidewalk, as inferred from labels, backing the
 * `sidewalk_presence_status` Postgres enum type (#5279).
 *
 * `Absent` and `Present` are calls the labels support; `Unknown` means the street has never been audited, so its
 * faces have had no chance to be labeled and silence says nothing. [[SidewalkPresenceBasis]] says which evidence
 * produced the call.
 *
 * NOTE: if changing these values, update the `sidewalk_presence_status` Postgres enum type as well (see 383.sql).
 */
object SidewalkPresenceStatus extends Enumeration {
  type SidewalkPresenceStatus = Value
  val Present: Value = Value("present")
  val Absent: Value  = Value("absent")
  val Unknown: Value = Value("unknown")

  /** Parses a string into a status, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
