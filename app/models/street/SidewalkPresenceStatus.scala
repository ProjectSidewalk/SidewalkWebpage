package models.street

import models.utils.{NamedEnum, PgEnumCompanion}

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
enum SidewalkPresenceStatus(val name: String) extends NamedEnum {
  case Present extends SidewalkPresenceStatus("present")
  case Absent  extends SidewalkPresenceStatus("absent")
  case Unknown extends SidewalkPresenceStatus("unknown")
}

object SidewalkPresenceStatus extends PgEnumCompanion[SidewalkPresenceStatus]("sidewalk_presence_status")
