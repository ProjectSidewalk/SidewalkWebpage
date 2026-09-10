/**
 * Models for the Project Sidewalk Regions API.
 *
 * This file contains the data structures used for API requests, responses, and error handling related to regions
 * (neighborhoods).
 */
package models.api

import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.MultiPolygon
import play.api.libs.json.{JsObject, Json, Writes}

import java.time.OffsetDateTime

/**
 * Represents a region (neighborhood) with associated metadata for the Regions API.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param regionId Project Sidewalk's region identifier
 * @param name Name of the region
 * @param labelCount Number of (non-tutorial, non-deleted) labels placed within this region
 * @param streetCount Number of (non-deleted) streets that belong to this region
 * @param userCount Number of unique users who have placed labels within this region
 * @param auditCount Number of completed audits of streets within this region
 * @param totalDistanceM Total length of all (non-tutorial) streets in this region, in meters
 * @param auditedDistanceM Length of this region's streets audited with current imagery, in meters. Sourced from
 *                         region_completion, so it counts only completion-worthy audits (high-quality, non-excluded
 *                         users; not low-quality/incomplete/stale) and is rebuilt nightly
 * @param outdatedDistanceM Length of this region's streets needing re-audit, in meters: streets audited before, but
 *                          whose completed audits all predate newer imagery (#4384). Counts *any* completed audit and
 *                          is computed live, so it is not an exact complement of auditedDistanceM -- a street audited
 *                          only by a low-quality user is in neither. For a strictly complementary pair, use
 *                          overallStats' kmExploreNoOverlap / kmNeedsReaudit
 * @param completionRate Fraction of the region's street distance audited with current imagery (0.0–1.0)
 * @param firstLabelDate Timestamp of the first label placed within this region (if any)
 * @param lastLabelDate Timestamp of the most recent label placed within this region (if any)
 * @param geometry The MultiPolygon geometry representing the region's boundary
 */
case class RegionDataForApi(
    regionId: Int,
    name: String,
    labelCount: Int,
    streetCount: Int,
    userCount: Int,
    auditCount: Int,
    totalDistanceM: Double,
    auditedDistanceM: Double,
    outdatedDistanceM: Double,
    completionRate: Double,
    firstLabelDate: Option[OffsetDateTime] = None,
    lastLabelDate: Option[OffsetDateTime] = None,
    geometry: MultiPolygon
) extends StreamingApiType {

  /**
   * Converts this RegionData object to a GeoJSON Feature object.
   *
   * The GeoJSON structure follows RFC 7946 and includes:
   * - A MultiPolygon geometry
   * - Properties containing all region metadata
   *
   * @return A JsObject containing the GeoJSON Feature representation
   */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> RegionDataForApi.toJson(this)
    )
  }

  override def toCsvRow: String = RegionDataForApi.toCsvRow(this)
}

object RegionDataForApi extends ApiFields[RegionDataForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[RegionDataForApi]] = Seq(
    field("region_id")(_.regionId),
    field("name")(_.name),
    field("label_count")(_.labelCount),
    field("street_count")(_.streetCount),
    field("user_count")(_.userCount),
    field("audit_count")(_.auditCount),
    field("total_distance_m")(_.totalDistanceM),
    field("audited_distance_m")(_.auditedDistanceM),
    field("outdated_distance_m")(_.outdatedDistanceM),
    field("completion_rate")(_.completionRate),
    field("first_label_date")(_.firstLabelDate.map(_.toString)),
    field("last_label_date")(_.lastLabelDate.map(_.toString))
  )

  // The GeoJSON holds the full polygon; the CSV can only summarize it as its centroid.
  override val csvOnlyFields: Seq[ApiField[RegionDataForApi]] = Seq(
    field("center_point")(r => s"${r.geometry.getCentroid.getX},${r.geometry.getCentroid.getY}")
  )

  /**
   * Implicit JSON writer for RegionDataForApi that uses the toJson method.
   */
  implicit val regionDataWrites: Writes[RegionDataForApi] = (region: RegionDataForApi) => region.toJson
}

/**
 * Represents filter criteria for the Regions API (v3).
 *
 * @param bbox Optional bounding box to filter regions by geographic location
 * @param regionId Optional region ID to filter for a single region
 * @param regionName Optional region name to filter for a single region
 * @param minLabelCount Optional minimum number of labels within the region
 */
case class RegionFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None,
    minLabelCount: Option[Int] = None
)
