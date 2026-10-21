/**
 * Models for the Project Sidewalk Streets API.
 *
 * This file contains the data structures used for API requests, responses, and error handling related to streets.
 */
package models.api

import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api.given
import org.locationtech.jts.geom.LineString
import play.api.libs.json.{JsObject, JsPath, Json, OFormat, Reads, Writes}
import play.api.libs.functional.syntax.*

import java.time.OffsetDateTime

/**
 * One OpenStreetMap way a street lies on and the stretch they share (#5741); the positions are null when unrecorded.
 *
 * @param osmWayId       The OSM way.
 * @param streetFromFrac Where along the street (0 at its first coordinate, 1 at its last) the way starts covering it.
 * @param streetToFrac   Where along the street the coverage ends.
 * @param wayFromFrac    Where along the way, in its drawn direction, the shared stretch starts.
 * @param wayToFrac      Where along the way it ends.
 * @param sameDirection  Whether the street runs the way in its drawn direction; when false, the street's left side is
 *                       the way's `:right`.
 */
case class OsmWayLinkForApi(
    osmWayId: Long,
    streetFromFrac: Option[Double],
    streetToFrac: Option[Double],
    wayFromFrac: Option[Double],
    wayToFrac: Option[Double],
    sameDirection: Option[Boolean]
) {

  /**
   * This link seen from one side of the street: the way's side that face is, flipped where the two run opposite ways
   * and unknown without a position.
   *
   * @param streetSide `left` or `right` of the street's digitized direction.
   */
  def withOsmSide(streetSide: String): OsmWaySideForApi = OsmWaySideForApi(
    osmWayId,
    streetFromFrac,
    streetToFrac,
    wayFromFrac,
    wayToFrac,
    sameDirection.map(same => if (same) streetSide else if (streetSide == "left") "right" else "left")
  )

  /**
   * The link as a shapefile cell, which holds 254 bytes, too few for the JSON list: `way:from-to:+` (`-` where the
   * way runs the other direction), the street's stretch to three places, or the bare way id without a position.
   */
  def shapefileText: String =
    OsmWayLinkForApi.shapefileText(osmWayId, streetFromFrac, streetToFrac, sameDirection.map(if (_) "+" else "-"))
}

object OsmWayLinkForApi {

  /** `way:from-to:tail`, or `way` alone without a position; `tail` is the direction or side mark. */
  def shapefileText(
      osmWayId: Long,
      streetFromFrac: Option[Double],
      streetToFrac: Option[Double],
      tail: Option[String]
  ): String = (streetFromFrac, streetToFrac, tail) match {
    case (Some(from), Some(to), Some(mark)) => f"$osmWayId:$from%.3f-$to%.3f:$mark"
    case _                                  => osmWayId.toString
  }

  /** The field names, shared by the JSON written out and the JSON the queries aggregate in SQL. */
  given osmWayLinkWrites: Writes[OsmWayLinkForApi] = (link: OsmWayLinkForApi) =>
    Json.obj(
      "osm_way_id"       -> link.osmWayId,
      "street_from_frac" -> link.streetFromFrac,
      "street_to_frac"   -> link.streetToFrac,
      "way_from_frac"    -> link.wayFromFrac,
      "way_to_frac"      -> link.wayToFrac,
      "same_direction"   -> link.sameDirection
    )

  given osmWayLinkReads: Reads[OsmWayLinkForApi] = (
    (JsPath \ "osm_way_id").read[Long] and
      (JsPath \ "street_from_frac").readNullable[Double] and
      (JsPath \ "street_to_frac").readNullable[Double] and
      (JsPath \ "way_from_frac").readNullable[Double] and
      (JsPath \ "way_to_frac").readNullable[Double] and
      (JsPath \ "same_direction").readNullable[Boolean]
  )(OsmWayLinkForApi.apply)

  /**
   * A SQL scalar subquery giving one street's ways as a JSON array text, in street order, for a query to select
   * beside its other columns and `parseJsonList` to read. The Infra3d placeholder way -1 names no way and is left out.
   *
   * @param streetEdgeIdSql The SQL expression for the street's id in the enclosing query.
   */
  def jsonListSql(streetEdgeIdSql: String): String =
    s"""(SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'osm_way_id', osm_way_street_edge.osm_way_id,
             'street_from_frac', osm_way_street_edge.street_from_frac,
             'street_to_frac', osm_way_street_edge.street_to_frac,
             'way_from_frac', osm_way_street_edge.way_from_frac,
             'way_to_frac', osm_way_street_edge.way_to_frac,
             'same_direction', osm_way_street_edge.same_direction
           ) ORDER BY osm_way_street_edge.street_from_frac NULLS LAST, osm_way_street_edge.osm_way_id),
           '[]'::jsonb)::text
       FROM osm_way_street_edge
       WHERE osm_way_street_edge.street_edge_id = $streetEdgeIdSql AND osm_way_street_edge.osm_way_id <> -1)"""

  def parseJsonList(json: String): Seq[OsmWayLinkForApi] = Json.parse(json).as[Seq[OsmWayLinkForApi]]
}

/**
 * An [[OsmWayLinkForApi]] seen from one side of the street, for the Sidewalk Presence API.
 *
 * @param osmSide The way's side the face is on, `left` or `right` of the way's drawn direction, which is what an OSM
 *                `sidewalk:left` / `sidewalk:right` tag refers to; None when the link has no position.
 */
case class OsmWaySideForApi(
    osmWayId: Long,
    streetFromFrac: Option[Double],
    streetToFrac: Option[Double],
    wayFromFrac: Option[Double],
    wayToFrac: Option[Double],
    osmSide: Option[String]
) {

  /** The link as a shapefile cell, `way:from-to:left` or `:right`, or just the way id without a position. */
  def shapefileText: String = OsmWayLinkForApi.shapefileText(osmWayId, streetFromFrac, streetToFrac, osmSide)
}

object OsmWaySideForApi {
  given osmWaySideWrites: Writes[OsmWaySideForApi] = (link: OsmWaySideForApi) =>
    Json.obj(
      "osm_way_id"       -> link.osmWayId,
      "street_from_frac" -> link.streetFromFrac,
      "street_to_frac"   -> link.streetToFrac,
      "way_from_frac"    -> link.wayFromFrac,
      "way_to_frac"      -> link.wayToFrac,
      "osm_side"         -> link.osmSide
    )
}

/**
 * Represents a street segment with associated metadata for the Streets API.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier: the way covering most of the street
 * @param osmWays Every OpenStreetMap way the street lies on, with the stretch shared and the relative direction
 * @param regionId Region ID where the street is located
 * @param regionName Name of the region where the street is located
 * @param wayType Type of way (e.g., "residential", "primary", etc.)
 * @param maxSpeed Raw OSM maxspeed tag for the street's way (e.g., "25 mph", "30"); None when untagged or unknown
 * @param status Availability of the street: "open", "no_imagery", "closed", or "disabled"
 * @param userIds List of user IDs who have applied labels to this street
 * @param labelCount Number of labels applied to this street
 * @param auditCount Number of times this street has been audited
 * @param outdated Whether the street was audited before but every audit predates newer imagery (needs re-audit, #4384)
 * @param firstLabelDate Timestamp of the first label applied to this street (if any)
 * @param lastLabelDate Timestamp of the most recent label applied to this street (if any)
 * @param geometry The LineString geometry representing the street segment
 */
case class StreetDataForApi(
    streetEdgeId: Int,
    osmWayId: Long,
    osmWays: Seq[OsmWayLinkForApi],
    regionId: Int,
    regionName: String,
    wayType: String,
    maxSpeed: Option[String],
    status: String,
    userIds: Seq[String],
    labelCount: Int,
    auditCount: Int,
    outdated: Boolean,
    firstLabelDate: Option[OffsetDateTime] = None,
    lastLabelDate: Option[OffsetDateTime] = None,
    geometry: LineString
) extends StreamingApiType {

  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> StreetDataForApi.toJson(this)
    )
  }

  override def toCsvRow: String = StreetDataForApi.toCsvRow(this)
}

object StreetDataForApi extends ApiFields[StreetDataForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[StreetDataForApi]] = Seq(
    field("street_edge_id")(_.streetEdgeId),
    field("osm_way_id")(_.osmWayId),
    field("region_id")(_.regionId),
    field("region_name")(_.regionName),
    field("way_type")(_.wayType),
    field("max_speed")(_.maxSpeed),
    field("status")(_.status),
    field("user_ids")(_.userIds),
    field("label_count")(_.labelCount),
    field("audit_count")(_.auditCount),
    field("outdated")(_.outdated),
    field("user_count")(_.userIds.size),
    field("first_label_date")(_.firstLabelDate.map(_.toString)),
    field("last_label_date")(_.lastLabelDate.map(_.toString)),
    // Last, so a reader that goes by column position in the CSV or .dbf is only disturbed after it.
    field("osm_ways")(_.osmWays)
  )

  override val csvOnlyFields: Seq[ApiField[StreetDataForApi]] = Seq(
    field("start_point")(s => s"${s.geometry.getStartPoint.getX},${s.geometry.getStartPoint.getY}"),
    field("end_point")(s => s"${s.geometry.getEndPoint.getX},${s.geometry.getEndPoint.getY}")
  )

  /**
   * Implicit JSON writer for StreetDataForApi that uses the toJson method.
   */
  given streetDataWrites: Writes[StreetDataForApi] = (street: StreetDataForApi) => street.toJson
}

/**
 * Represents filter criteria for the Streets API (v3).
 *
 * @param bbox Optional bounding box to filter streets by geographic location
 * @param regionId Optional region ID to filter streets by geographic region
 * @param regionName Optional region name to filter streets by geographic region
 * @param minLabelCount Optional minimum number of labels on the street
 * @param minAuditCount Optional minimum number of audits for the street
 * @param minUserCount Optional minimum number of users who audited the street
 * @param wayTypes Optional list of way types to include (e.g., "residential", "primary")
 * @param statuses Optional list of street statuses to include (e.g., "open", "no_imagery", "disabled")
 */
case class StreetFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None,
    minLabelCount: Option[Int] = None,
    minAuditCount: Option[Int] = None,
    minUserCount: Option[Int] = None,
    wayTypes: Option[Seq[String]] = None,
    statuses: Option[Seq[String]] = None
)

/**
 * Represents complete information about a street type for API responses.
 *
 * @param name The string identifier for the way type (e.g., "residential", "primary")
 * @param description Human-readable description of this street type
 * @param count Number of streets of this type in the database
 */
case class StreetTypeForApi(
    name: String,
    description: String,
    count: Int
)

/**
 * Companion object for StreetTypeForApi containing JSON formatter
 */
object StreetTypeForApi {
  given format: OFormat[StreetTypeForApi] = Json.format[StreetTypeForApi]
}
