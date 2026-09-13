/**
 * Models for the Project Sidewalk Sidewalk Presence API (#5279): one record per block face.
 */
package models.api

import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.libs.json.{JsObject, Json, Writes}

import java.time.OffsetDateTime

/**
 * One block face (one side of one street) and what the labels say about its sidewalk. A street yields two of these,
 * sharing its geometry; `streetSide` tells them apart.
 *
 * @param streetEdgeId              Project Sidewalk's street segment identifier
 * @param streetSide                `left` or `right` of the street's digitized direction (its coordinate order)
 * @param osmWayId                  OpenStreetMap way identifier
 * @param regionId                  Region ID where the street is located
 * @param regionName                Name of the region where the street is located
 * @param wayType                   Type of way (e.g., "residential", "primary", etc.)
 * @param status                    The street's availability: `open`, `no_imagery`, `closed`, or `disabled`
 * @param presence                  `present`, `absent`, or `unknown`
 * @param presenceBasis             The evidence behind the call: `no_sidewalk_labels`, `other_side_tag`,
 *                                  `audited_no_labels`, or `unaudited`
 * @param noSidewalkLabelCount      Sided NoSidewalk labels on this face; the confidence behind an `absent` call
 * @param noSidewalkUserCount       Distinct users who placed those labels
 * @param labelCount                All sided labels on this face, of any type
 * @param auditCount                Completed audits of the street
 * @param firstNoSidewalkLabelDate  When the first NoSidewalk label on this face was placed, if any
 * @param lastNoSidewalkLabelDate   When the most recent one was, if any
 * @param geometry                  The street's LineString geometry, shared by both faces
 */
case class SidewalkPresenceForApi(
    streetEdgeId: Int,
    streetSide: String,
    osmWayId: Long,
    regionId: Int,
    regionName: String,
    wayType: String,
    status: String,
    presence: String,
    presenceBasis: String,
    noSidewalkLabelCount: Int,
    noSidewalkUserCount: Int,
    labelCount: Int,
    auditCount: Int,
    firstNoSidewalkLabelDate: Option[OffsetDateTime] = None,
    lastNoSidewalkLabelDate: Option[OffsetDateTime] = None,
    geometry: LineString
) extends StreamingApiType {

  override def toJson: JsObject = Json.obj(
    "type"       -> "Feature",
    "geometry"   -> geometry,
    "properties" -> SidewalkPresenceForApi.toJson(this)
  )

  override def toCsvRow: String = SidewalkPresenceForApi.toCsvRow(this)
}

object SidewalkPresenceForApi extends ApiFields[SidewalkPresenceForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[SidewalkPresenceForApi]] = Seq(
    field("street_edge_id")(_.streetEdgeId),
    field("street_side")(_.streetSide),
    field("osm_way_id")(_.osmWayId),
    field("region_id")(_.regionId),
    field("region_name")(_.regionName),
    field("way_type")(_.wayType),
    field("status")(_.status),
    field("presence")(_.presence),
    field("presence_basis")(_.presenceBasis),
    field("no_sidewalk_label_count")(_.noSidewalkLabelCount),
    field("no_sidewalk_user_count")(_.noSidewalkUserCount),
    field("label_count")(_.labelCount),
    field("audit_count")(_.auditCount),
    field("first_no_sidewalk_label_date")(_.firstNoSidewalkLabelDate.map(_.toString)),
    field("last_no_sidewalk_label_date")(_.lastNoSidewalkLabelDate.map(_.toString))
  )

  override val csvOnlyFields: Seq[ApiField[SidewalkPresenceForApi]] = Seq(
    field("start_point")(f => s"${f.geometry.getStartPoint.getX},${f.geometry.getStartPoint.getY}"),
    field("end_point")(f => s"${f.geometry.getEndPoint.getX},${f.geometry.getEndPoint.getY}")
  )

  implicit val sidewalkPresenceWrites: Writes[SidewalkPresenceForApi] = (face: SidewalkPresenceForApi) => face.toJson
}

/**
 * Filter criteria for the Sidewalk Presence API (v3).
 *
 * @param bbox                Optional bounding box to filter faces by their street's location
 * @param regionId            Optional region ID to filter by geographic region
 * @param regionName          Optional region name to filter by geographic region
 * @param presence            Optional verdicts to keep (`present`, `absent`, `unknown`); all three by default
 * @param statuses            Optional street statuses to keep (`open`, `no_imagery`, `closed`, `disabled`); all by
 *                            default, as on the Streets API
 * @param minNoSidewalkLabels Optional minimum NoSidewalk label count, the confidence dial for `absent` calls
 * @param minAuditCount       Optional minimum number of completed audits of the street
 * @param wayTypes            Optional list of way types to include (e.g., "residential", "primary")
 */
case class SidewalkPresenceFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None,
    presence: Option[Seq[String]] = None,
    statuses: Option[Seq[String]] = None,
    minNoSidewalkLabels: Option[Int] = None,
    minAuditCount: Option[Int] = None,
    wayTypes: Option[Seq[String]] = None
)
