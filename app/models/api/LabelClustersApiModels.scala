/**
 * Models for the Project Sidewalk Label Clusters API.
 *
 * This file contains the data structures used for API requests, responses,
 * and error handling related to sidewalk accessibility label clusters.
 */
package models.api

import models.computation.StreamingApiType
import models.utils.LatLngBBox
import play.api.libs.json.{JsObject, Json, Writes}

import java.time.OffsetDateTime

/**
 * Represents filter criteria for the Label Clusters API (v3).
 *
 * @param bbox Optional bounding box to filter clusters by geographic location
 * @param labelTypes Optional list of label types to include (e.g., "CurbRamp", "NoCurbRamp")
 * @param regionId Optional region ID to filter clusters by geographic region
 * @param regionName Optional region name to filter clusters by geographic region
 * @param includeRawLabels Whether to include raw label data within each cluster
 * @param minClusterSize Optional minimum cluster size to include
 * @param minAvgImageCaptureDate Optional minimum average image capture date to filter by
 * @param minAvgLabelDate Optional minimum average label date to filter by
 * @param minSeverity Optional minimum severity score (1-5 scale)
 * @param maxSeverity Optional maximum severity score (1-5 scale)
 */
case class LabelClusterFiltersForApi(
  bbox: Option[LatLngBBox] = None,
  labelTypes: Option[Seq[String]] = None,
  regionId: Option[Int] = None,
  regionName: Option[String] = None,
  includeRawLabels: Boolean = false,
  minClusterSize: Option[Int] = None,
  minAvgImageCaptureDate: Option[OffsetDateTime] = None,
  minAvgLabelDate: Option[OffsetDateTime] = None,
  minSeverity: Option[Int] = None,
  maxSeverity: Option[Int] = None
)

/**
 * Represents a raw label within a label cluster. This is a simplified version of the label data used in clusters.
 *
 * @param labelId Unique identifier for the label
 * @param userId Anonymized identifier of the user who created the label
 * @param gsvPanoramaId Google Street View panorama identifier where the label was placed
 * @param severity Optional severity rating (1-5 scale)
 * @param timeCreated Timestamp when the label was created
 * @param latitude Geographic latitude coordinate
 * @param longitude Geographic longitude coordinate
 * @param correct Option indicating consensus validation status
 * @param imageCaptureDate Optional date when the Street View image was captured
 */
case class RawLabelInClusterDataForApi(
  labelId: Int,
  userId: String,
  gsvPanoramaId: String,
  severity: Option[Int],
  timeCreated: OffsetDateTime,
  latitude: Double,
  longitude: Double,
  correct: Option[Boolean],
  imageCaptureDate: Option[String]
)

/**
 * Companion object for RawLabelInClusterDataForApi containing JSON formatter.
 */
object RawLabelInClusterDataForApi {
  implicit val clusterLabelDataWrites: Writes[RawLabelInClusterDataForApi] = Json.writes[RawLabelInClusterDataForApi]
}

/**
 * Primary data structure representing a label cluster (aggregated labels).
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param labelClusterId Unique identifier for the label cluster
 * @param labelType Type of accessibility issue (e.g., "CurbRamp", "SurfaceProblem")
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmStreetId OpenStreetMap street identifier
 * @param regionId Region ID where the cluster is located
 * @param regionName Name of the region where the cluster is located
 * @param avgImageCaptureDate Average date when the Street View images were captured
 * @param avgLabelDate Average date when the labels were created
 * @param agreeCount Total number of users who agreed with labels in this cluster
 * @param disagreeCount Total number of users who disagreed with labels in this cluster
 * @param unsureCount Total number of users who were unsure about labels in this cluster
 * @param clusterSize Number of labels in this cluster
 * @param userIds List of user IDs who contributed labels to this cluster
 * @param labels Optional list of raw labels in this cluster (only included if requested)
 * @param avgLatitude The geographic latitude coordinate of the cluster center (centroid)
 * @param avgLongitude The geographic longitude coordinate of the cluster center (centroid)
 */
case class LabelClusterForApi(
  labelClusterId: Int,
  labelType: String,
  streetEdgeId: Int,
  osmStreetId: Long,
  regionId: Int,
  regionName: String,
  avgImageCaptureDate: Option[OffsetDateTime],
  avgLabelDate: Option[OffsetDateTime],
  medianSeverity: Option[Int],
  agreeCount: Int,
  disagreeCount: Int,
  unsureCount: Int,
  clusterSize: Int,
  userIds: Seq[String],
  labels: Option[Seq[RawLabelInClusterDataForApi]],
  avgLatitude: Double,
  avgLongitude: Double,
) extends StreamingApiType {

  /**
   * Converts this LabelClusterForApi object to a GeoJSON Feature object.
   * The GeoJSON structure follows RFC 7946 and includes:
   * - A Point geometry with [longitude, latitude] coordinates
   * - Properties containing all cluster metadata
   *
   * @return A JsObject containing the GeoJSON Feature representation
   */
  override def toJSON: JsObject = {
    val baseProperties = Json.obj(
      "label_cluster_id" -> labelClusterId,
      "label_type" -> labelType,
      "street_edge_id" -> streetEdgeId,
      "osm_street_id" -> osmStreetId,
      "regionId" -> regionId,
      "regionName" -> regionName,
      "avg_image_capture_date" -> avgImageCaptureDate.map(_.toString),
      "avg_label_date" -> avgLabelDate.map(_.toString),
      "median_severity" -> medianSeverity,
      "agree_count" -> agreeCount,
      "disagree_count" -> disagreeCount,
      "unsure_count" -> unsureCount,
      "cluster_size" -> clusterSize,
      "users" -> userIds
    )

    // Add labels to properties if they exist
    val propertiesWithLabels = labels match {
      case Some(labelsList) => baseProperties + ("labels" -> Json.toJson(labelsList))
      case None => baseProperties
    }

    Json.obj(
      "type" -> "Feature",
      "geometry" -> Json.obj(
        "type" -> "Point",
        "coordinates" -> Json.arr(avgLongitude, avgLatitude)
      ),
      "properties" -> propertiesWithLabels
    )
  }

  /**
   * Converts this LabelClusterForApi object to a CSV row string.
   * The fields are ordered to match the header defined in the companion object.
   * Complex fields like arrays are serialized as JSON strings.
   *
   * @return A comma-separated string representing this cluster's data
   */
  override def toCSVRow: String = {
    // Helper to safely quote CSV fields containing commas, quotes, or newlines
    def escapeCsv(field: String): String = {
      val needsQuotes = field.contains(",") || field.contains("\"") || field.contains("\n")
      val escapedField = field.replace("\"", "\"\"")
      if (needsQuotes) s""""$escapedField"""" else escapedField
    }

    val fields = Seq(
      labelClusterId.toString,
      escapeCsv(labelType),
      streetEdgeId.toString,
      osmStreetId.toString,
      regionId.toString,
      escapeCsv(regionName),
      avgImageCaptureDate.map(_.toString).getOrElse(""),
      avgLabelDate.map(_.toString).getOrElse(""),
      medianSeverity.map(_.toString).getOrElse(""),
      agreeCount.toString,
      disagreeCount.toString,
      unsureCount.toString,
      clusterSize.toString,
      s""""[${userIds.map(id => s"""\"${id.replace("\"", "\"\"")}\"""").mkString(",")}]"""",
      // We don't include the raw labels in CSV format as it would be too complex
      avgLatitude.toString,
      avgLongitude.toString
    )
    fields.mkString(",")
  }
}

/**
 * Companion object for LabelClusterForApi containing CSV header definition
 */
object LabelClusterForApi {
  /**
   * CSV header string with field names in the same order as the toCSVRow output.
   * This should be included as the first line when generating CSV output.
   */
  val csvHeader: String = "label_cluster_id,label_type,street_edge_id,osm_street_id,region_id,region_name," +
    "avg_image_capture_date,avg_label_date,median_severity,agree_count,disagree_count,unsure_count,cluster_size," +
    "users,avg_latitude,avg_longitude\n"
}
