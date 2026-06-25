/**
 * Models for the Project Sidewalk Regions API.
 *
 * This file contains the data structures used for API requests, responses, and error handling related to regions
 * (neighborhoods).
 */
package models.api

import models.api.ApiModelUtils.escapeCsvField
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
      "properties" -> Json.obj(
        "region_id"        -> regionId,
        "name"             -> name,
        "label_count"      -> labelCount,
        "street_count"     -> streetCount,
        "user_count"       -> userCount,
        "audit_count"      -> auditCount,
        "first_label_date" -> firstLabelDate.map(_.toString),
        "last_label_date"  -> lastLabelDate.map(_.toString)
      )
    )
  }

  /**
   * Converts this RegionData object to a CSV row string, ordered to match the header defined in the companion object.
   *
   * @return A comma-separated string representing this region's data
   */
  override def toCsvRow: String = {
    // The full polygon geometry is too complex for the tabular CSV format, so we provide the centroid as a simplified
    // representation. Use the GeoJSON format for the complete geometry.
    val centroid = geometry.getCentroid
    val fields   = Seq(
      regionId.toString,
      escapeCsvField(name),
      labelCount.toString,
      streetCount.toString,
      userCount.toString,
      auditCount.toString,
      firstLabelDate.map(_.toString).getOrElse(""),
      lastLabelDate.map(_.toString).getOrElse(""),
      escapeCsvField(s"${centroid.getX},${centroid.getY}")
    )
    fields.mkString(",")
  }
}

/**
 * Companion object for RegionDataForApi containing CSV header definition.
 */
object RegionDataForApi {

  /**
   * CSV header string with field names in the same order as the toCsvRow output.
   * This should be included as the first line when generating CSV output.
   */
  val csvHeader: String = "region_id,name,label_count,street_count,user_count,audit_count,first_label_date," +
    "last_label_date,center_point\n"

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
