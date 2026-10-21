package models.street

import models.utils.{NamedEnum, PgEnumCompanion}

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
enum WayType(val name: String) extends NamedEnum {
  case Motorway      extends WayType("motorway")
  case MotorwayLink  extends WayType("motorway_link")
  case Trunk         extends WayType("trunk")
  case TrunkLink     extends WayType("trunk_link")
  case Primary       extends WayType("primary")
  case PrimaryLink   extends WayType("primary_link")
  case Secondary     extends WayType("secondary")
  case SecondaryLink extends WayType("secondary_link")
  case Tertiary      extends WayType("tertiary")
  case TertiaryLink  extends WayType("tertiary_link")
  case Unclassified  extends WayType("unclassified")
  case Residential   extends WayType("residential")
  case LivingStreet  extends WayType("living_street")
  case Pedestrian    extends WayType("pedestrian")
  case Service       extends WayType("service")
  case Road          extends WayType("road")
  case Track         extends WayType("track")
  case Raceway       extends WayType("raceway")
  case Footway       extends WayType("footway")
  case Cycleway      extends WayType("cycleway")
  case Path          extends WayType("path")
  case Bridleway     extends WayType("bridleway")
  case Steps         extends WayType("steps")
  case Corridor      extends WayType("corridor")
  case Crossing      extends WayType("crossing")
  case Construction  extends WayType("construction")
  case Border        extends WayType("border")
  case Subway        extends WayType("subway")
  case Unknown       extends WayType("unknown")
}

object WayType extends PgEnumCompanion[WayType]("way_type")
