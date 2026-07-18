package models.street

/**
 * Enumeration of the OSM way types our imported streets carry, backing the `way_type` Postgres enum type.
 *
 * The set is the union of our usual city-import whitelist and the broader OSM highway set CDMX was imported with
 * (db/scripts/fill-new-schema.sh casts the imported column to the enum, so a value outside this set fails a future
 * import loudly). `Unknown` is for streets from non-OSM imports (e.g. Infra3d cities), which carry no OSM way type.
 *
 * NOTE: if changing these values, update the `way_type` Postgres enum type as well (see 342.sql). The string values
 * are emitted directly in the `/v3/api/streets` responses.
 */
object WayType extends Enumeration {
  type WayType = Value
  val Motorway: Value      = Value("motorway")
  val MotorwayLink: Value  = Value("motorway_link")
  val Trunk: Value         = Value("trunk")
  val TrunkLink: Value     = Value("trunk_link")
  val Primary: Value       = Value("primary")
  val PrimaryLink: Value   = Value("primary_link")
  val Secondary: Value     = Value("secondary")
  val SecondaryLink: Value = Value("secondary_link")
  val Tertiary: Value      = Value("tertiary")
  val TertiaryLink: Value  = Value("tertiary_link")
  val Unclassified: Value  = Value("unclassified")
  val Residential: Value   = Value("residential")
  val LivingStreet: Value  = Value("living_street")
  val Pedestrian: Value    = Value("pedestrian")
  val Service: Value       = Value("service")
  val Road: Value          = Value("road")
  val Track: Value         = Value("track")
  val Raceway: Value       = Value("raceway")
  val Footway: Value       = Value("footway")
  val Cycleway: Value      = Value("cycleway")
  val Path: Value          = Value("path")
  val Bridleway: Value     = Value("bridleway")
  val Steps: Value         = Value("steps")
  val Corridor: Value      = Value("corridor")
  val Crossing: Value      = Value("crossing")
  val Construction: Value  = Value("construction")
  val Border: Value        = Value("border")
  val Subway: Value        = Value("subway")
  val Unknown: Value       = Value("unknown")

  /** Parses a string into a way type, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
