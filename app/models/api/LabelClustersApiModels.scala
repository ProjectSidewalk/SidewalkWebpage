/**
 * Models for the Project Sidewalk Label Clusters API.
 *
 * This file contains the data structures used for API requests, responses,
 * and error handling related to sidewalk accessibility label clusters.
 */
package models.api

import models.api.ApiModelUtils.createGeoJsonPoint
import models.pano.PanoSource.PanoSource
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
 * @param minSeverity Optional minimum severity score (1-3 scale)
 * @param maxSeverity Optional maximum severity score (1-3 scale)
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
 * @param panoId Panorama identifier where the label was placed
 * @param panoSource Imagery provider the panorama came from (gsv, mapillary, panoramax, or infra3d); None when the pano has no
 *                   pano_data row (the cluster query LEFT JOINs pano_data, and no FK guarantees a row exists)
 * @param severity Optional severity rating (1-3 scale)
 * @param timeCreated Timestamp when the label was created
 * @param latitude Geographic latitude coordinate
 * @param longitude Geographic longitude coordinate
 * @param correct Option indicating consensus validation status
 * @param imageCaptureDate Optional date when the image was captured
 */
case class RawLabelInClusterDataForApi(
    labelId: Int,
    userId: String,
    panoId: String,
    panoSource: Option[PanoSource],
    severity: Option[Int],
    timeCreated: OffsetDateTime,
    latitude: Double,
    longitude: Double,
    correct: Option[Boolean],
    imageCaptureDate: Option[String]
)

/** These labels are written nested in a cluster's GeoJSON, or as their own CSV file via [[InCluster]]. */
private[api] object RawLabelFields extends ApiFields[RawLabelInClusterDataForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[RawLabelInClusterDataForApi]] = Seq(
    field("label_id")(_.labelId),
    field("user_id")(_.userId),
    field("pano_id")(_.panoId),
    field("pano_source")(_.panoSource),
    field("severity")(_.severity),
    field("time_created")(_.timeCreated),
    field("latitude")(_.latitude),
    field("longitude")(_.longitude),
    field("correct")(_.correct),
    field("image_capture_date")(_.imageCaptureDate)
  )

}

object RawLabelInClusterDataForApi {
  implicit val clusterLabelDataWrites: Writes[RawLabelInClusterDataForApi] = RawLabelFields.toJson _

  /** The same labels as their own CSV file, which names each label's parent cluster in a column of its own. */
  object InCluster extends ApiFields[(Int, RawLabelInClusterDataForApi)] {
    override val fields: Seq[ApiField[(Int, RawLabelInClusterDataForApi)]] =
      ApiFields.field[(Int, RawLabelInClusterDataForApi), Int]("label_cluster_id")(_._1) +:
        RawLabelFields.csvFields.map(_.on[(Int, RawLabelInClusterDataForApi)](_._2))
  }
}

/**
 * Primary data structure representing a label cluster (aggregated labels).
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 *
 * @param labelClusterId Unique identifier for the label cluster
 * @param labelType Type of accessibility issue (e.g., "CurbRamp", "SurfaceProblem")
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier
 * @param regionId Region ID where the cluster is located
 * @param regionName Name of the region where the cluster is located
 * @param avgImageCaptureDate Average date when the images were captured
 * @param avgLabelDate Average date when the labels were created
 * @param agreeCount Total number of users who agreed with labels in this cluster
 * @param disagreeCount Total number of users who disagreed with labels in this cluster
 * @param unsureCount Total number of users who were unsure about labels in this cluster
 * @param clusterSize Number of labels in this cluster
 * @param labelIds List of label IDs that make up this cluster
 * @param userIds List of user IDs who contributed labels to this cluster
 * @param tagCounts Map of tag names to the number of labels in the cluster with that tag
 * @param labels Optional list of raw labels in this cluster (only included if requested)
 * @param avgLatitude The geographic latitude coordinate of the cluster center (centroid)
 * @param avgLongitude The geographic longitude coordinate of the cluster center (centroid)
 */
case class LabelClusterForApi(
    labelClusterId: Int,
    labelType: String,
    streetEdgeId: Int,
    intersectionId: Option[Int],
    osmWayId: Long,
    regionId: Int,
    regionName: String,
    avgImageCaptureDate: Option[OffsetDateTime],
    avgLabelDate: Option[OffsetDateTime],
    medianSeverity: Option[Int],
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    clusterSize: Int,
    labelIds: Seq[Int],
    userIds: Seq[String],
    tagCounts: Map[String, Int],
    labels: Option[Seq[RawLabelInClusterDataForApi]],
    avgLatitude: Double,
    avgLongitude: Double
) extends StreamingApiType {

  /** @return This cluster as an RFC 7946 GeoJSON Feature, its centroid the Point geometry. */
  override def toJson: JsObject = {
    val properties: JsObject = LabelClusterForApi.toJson(this)

    // Only the GeoJSON carries the member labels; they can't fit in one cell, so the CSV gives them their own file.
    val propertiesWithLabels: JsObject =
      labels.map(labelsList => properties + ("labels" -> Json.toJson(labelsList))).getOrElse(properties)

    createGeoJsonPoint(avgLongitude, avgLatitude, propertiesWithLabels)
  }

  override def toCsvRow: String = LabelClusterForApi.toCsvRow(this)
}

object LabelClusterForApi extends ApiFields[LabelClusterForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[LabelClusterForApi]] = Seq(
    field("label_cluster_id")(_.labelClusterId),
    field("label_type")(_.labelType),
    field("street_edge_id")(_.streetEdgeId),
    field("intersection_id")(_.intersectionId),
    field("osm_way_id")(_.osmWayId),
    field("region_id")(_.regionId),
    field("region_name")(_.regionName),
    field("avg_image_capture_date")(_.avgImageCaptureDate.map(_.toString)),
    field("avg_label_date")(_.avgLabelDate.map(_.toString)),
    field("median_severity")(_.medianSeverity),
    field("agree_count")(_.agreeCount),
    field("disagree_count")(_.disagreeCount),
    field("unsure_count")(_.unsureCount),
    field("cluster_size")(_.clusterSize),
    field("label_ids")(_.labelIds),
    field("users")(_.userIds),
    field("tag_counts")(_.tagCounts)
  )

  override val csvOnlyFields: Seq[ApiField[LabelClusterForApi]] = Seq(
    field("avg_latitude")(_.avgLatitude),
    field("avg_longitude")(_.avgLongitude)
  )
}
