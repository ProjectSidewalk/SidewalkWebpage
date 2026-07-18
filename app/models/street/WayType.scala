package models.street

/**
 * Enumeration of the OSM way types we import streets for, backing the `way_type` Postgres enum type.
 *
 * The set is closed by our city-import whitelist (db/scripts/fill-new-schema.sh casts the imported column to the
 * enum, so an out-of-whitelist value fails the import loudly), not by OSM's much larger `highway` value set.
 * `Unknown` is for streets from non-OSM imports (e.g. Infra3d cities), which carry no OSM way type.
 *
 * NOTE: if changing these values, update the `way_type` Postgres enum type as well (see 342.sql). The string values
 * are emitted directly in the `/v3/api/streets` responses.
 */
object WayType extends Enumeration {
  type WayType = Value
  val Trunk: Value        = Value("trunk")
  val Primary: Value      = Value("primary")
  val Secondary: Value    = Value("secondary")
  val Tertiary: Value     = Value("tertiary")
  val Residential: Value  = Value("residential")
  val Unclassified: Value = Value("unclassified")
  val Pedestrian: Value   = Value("pedestrian")
  val LivingStreet: Value = Value("living_street")
  val Service: Value      = Value("service")
  val Unknown: Value      = Value("unknown")

  /** Parses a string into a way type, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
