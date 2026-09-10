/**
 * Models for the Project Sidewalk Streets API.
 *
 * This file contains the data structures used for API requests, responses, and error handling related to streets.
 */
package models.api

import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.libs.json.{JsObject, Json, OFormat, Writes}

import java.time.OffsetDateTime

/**
 * Represents a street segment with associated metadata for the Streets API.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier
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

  /** @return This street as an RFC 7946 GeoJSON Feature. */
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
    field("last_label_date")(_.lastLabelDate.map(_.toString))
  )

  // The GeoJSON holds the full LineString; the CSV can only summarize it as its two endpoints.
  override val csvOnlyFields: Seq[ApiField[StreetDataForApi]] = Seq(
    field("start_point")(s => s"${s.geometry.getStartPoint.getX},${s.geometry.getStartPoint.getY}"),
    field("end_point")(s => s"${s.geometry.getEndPoint.getX},${s.geometry.getEndPoint.getY}")
  )

  /**
   * Implicit JSON writer for StreetDataForApi that uses the toJson method.
   */
  implicit val streetDataWrites: Writes[StreetDataForApi] = (street: StreetDataForApi) => street.toJson
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
  implicit val format: OFormat[StreetTypeForApi] = Json.format[StreetTypeForApi]
}
