/**
 * Models for the Project Sidewalk AccessScore API (v3, #3855).
 *
 * Holds the streaming DTOs returned by `/v3/api/accessScoreStreets` and `/v3/api/accessScoreRegions`, plus the parsed
 * filter object. The scoring math itself lives in `service.AccessScoreCalculator`; these types only carry and serialize
 * the computed results. Per the v3 conventions (#3871) all output field names are snake_case; the dynamic per-type
 * breakdown objects are keyed by the canonical label-type names (e.g. "CurbRamp"), matching `/v3/api/labelTypes`.
 */
package models.api

import models.api.ApiModelUtils.escapeCsvField
import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.{LineString, MultiPolygon}
import play.api.libs.json.{JsObject, Json, Writes}
import service.AccessScoreCalculator

/**
 * Shared helpers for the AccessScore DTOs: the per-label-type column names used across CSV, GeoJSON, and shapefile
 * output. Centralized so the street and region DTOs (and the shapefile creator) stay in lockstep with the set of scored
 * types defined in [[service.AccessScoreCalculator]].
 */
object AccessScoreApiModels {

  /** The scored label types in stable column order (by label-type id). */
  val orderedTypes: Seq[String] = AccessScoreCalculator.orderedScoredTypes

  /** Converts a CamelCase label-type name to snake_case for flat CSV column names (e.g. "NoCurbRamp" → "no_curb_ramp"). */
  def snakeType(labelType: String): String =
    labelType.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase

  /**
   * Short (<= 10 char) column codes for the per-type fields in shapefile output, where the DBF format truncates column
   * names at 10 characters. GeoJSON/CSV/GeoPackage use the full names instead.
   */
  val shapefileTypeCode: Map[String, String] = Map(
    "CurbRamp"       -> "CRamp",
    "NoCurbRamp"     -> "NoCRamp",
    "Obstacle"       -> "Obst",
    "SurfaceProblem" -> "Surf",
    "NoSidewalk"     -> "NoSwk",
    "Crosswalk"      -> "Xwalk",
    "Signal"         -> "Signal"
  )

  /** Builds a JSON object keyed by canonical label-type name from a (possibly sparse) per-type map, defaulting to 0. */
  private[api] def perTypeJson[T](values: Map[String, T], default: T)(implicit w: Writes[T]): JsObject =
    JsObject(orderedTypes.map(t => t -> Json.toJson(values.getOrElse(t, default))))
}

/**
 * AccessScore for a single street segment, for the v3 API.
 *
 * @param streetEdgeId        Project Sidewalk street segment identifier.
 * @param osmWayId            OpenStreetMap way identifier.
 * @param regionId            Region (neighborhood) the street belongs to.
 * @param score               Access score in (0, 1), or None if the street has not been audited.
 * @param auditCount          Number of completed (high-quality) audits of this street.
 * @param lengthMeters        Street length in meters (UTM-projected; used to length-weight region scores).
 * @param labelCount          Number of labels contributing to this street's clusters.
 * @param clusterCounts       Per-label-type count of scored clusters on the street.
 * @param subScores           Per-label-type summed contribution to the pre-sigmoid score (explains the score).
 * @param geometry            The LineString geometry of the street.
 */
case class StreetAccessScoreForApi(
    streetEdgeId: Int,
    osmWayId: Long,
    regionId: Int,
    score: Option[Double],
    auditCount: Int,
    lengthMeters: Double,
    labelCount: Int,
    clusterCounts: Map[String, Int],
    subScores: Map[String, Double],
    geometry: LineString
) extends StreamingApiType {

  /** Converts this street access score to a GeoJSON Feature with a LineString geometry. */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> Json.obj(
        "street_edge_id" -> streetEdgeId,
        "osm_way_id"     -> osmWayId,
        "region_id"      -> regionId,
        "score"          -> score,
        "audit_count"    -> auditCount,
        "length_meters"  -> lengthMeters,
        "label_count"    -> labelCount,
        "cluster_counts" -> AccessScoreApiModels.perTypeJson(clusterCounts, 0),
        "sub_scores"     -> AccessScoreApiModels.perTypeJson(subScores, 0.0)
      )
    )
  }

  /** Converts this street access score to a CSV row matching [[StreetAccessScoreForApi.csvHeader]]. */
  override def toCsvRow: String = {
    val baseFields = Seq(
      streetEdgeId.toString,
      osmWayId.toString,
      regionId.toString,
      score.map(_.toString).getOrElse(""),
      auditCount.toString,
      lengthMeters.toString,
      labelCount.toString
    )
    val countFields    = AccessScoreApiModels.orderedTypes.map(t => clusterCounts.getOrElse(t, 0).toString)
    val subScoreFields = AccessScoreApiModels.orderedTypes.map(t => subScores.getOrElse(t, 0.0).toString)
    val tailFields     = Seq(
      escapeCsvField(s"${geometry.getStartPoint.getX},${geometry.getStartPoint.getY}"),
      escapeCsvField(s"${geometry.getEndPoint.getX},${geometry.getEndPoint.getY}")
    )
    (baseFields ++ countFields ++ subScoreFields ++ tailFields).mkString(",")
  }
}

/** Companion holding the CSV header for [[StreetAccessScoreForApi]], generated from the scored-type set. */
object StreetAccessScoreForApi {
  val csvHeader: String = {
    val countCols    = AccessScoreApiModels.orderedTypes.map(t => s"n_${AccessScoreApiModels.snakeType(t)}")
    val subScoreCols = AccessScoreApiModels.orderedTypes.map(t => s"score_${AccessScoreApiModels.snakeType(t)}")
    (Seq("street_edge_id", "osm_way_id", "region_id", "score", "audit_count", "length_meters", "label_count") ++
      countCols ++ subScoreCols ++ Seq("start_point", "end_point")).mkString(",") + "\n"
  }

  implicit val writes: Writes[StreetAccessScoreForApi] = (s: StreetAccessScoreForApi) => s.toJson
}

/**
 * AccessScore for a region (neighborhood), for the v3 API.
 *
 * @param regionId            Project Sidewalk region identifier.
 * @param name                Region name.
 * @param score               Street-length-weighted mean of audited street scores in (0, 1), or None if none audited.
 * @param coverage            Fraction of the region's streets that have been audited, in [0, 1].
 * @param auditedStreetCount  Number of audited streets in the region.
 * @param totalStreetCount    Total number of streets in the region.
 * @param avgClusterCounts    Per-label-type mean cluster count across the region's audited streets.
 * @param geometry            The MultiPolygon geometry of the region.
 */
case class RegionAccessScoreForApi(
    regionId: Int,
    name: String,
    score: Option[Double],
    coverage: Double,
    auditedStreetCount: Int,
    totalStreetCount: Int,
    avgClusterCounts: Map[String, Double],
    geometry: MultiPolygon
) extends StreamingApiType {

  /** Converts this region access score to a GeoJSON Feature with a MultiPolygon geometry. */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> Json.obj(
        "region_id"            -> regionId,
        "name"                 -> name,
        "score"                -> score,
        "coverage"             -> coverage,
        "audited_street_count" -> auditedStreetCount,
        "total_street_count"   -> totalStreetCount,
        "avg_cluster_counts"   -> AccessScoreApiModels.perTypeJson(avgClusterCounts, 0.0)
      )
    )
  }

  /** Converts this region access score to a CSV row matching [[RegionAccessScoreForApi.csvHeader]]. */
  override def toCsvRow: String = {
    val centroid   = geometry.getCentroid
    val baseFields = Seq(
      regionId.toString,
      escapeCsvField(name),
      score.map(_.toString).getOrElse(""),
      coverage.toString,
      auditedStreetCount.toString,
      totalStreetCount.toString
    )
    val countFields = AccessScoreApiModels.orderedTypes.map(t => avgClusterCounts.getOrElse(t, 0.0).toString)
    val tailFields  = Seq(escapeCsvField(s"${centroid.getX},${centroid.getY}"))
    (baseFields ++ countFields ++ tailFields).mkString(",")
  }
}

/** Companion holding the CSV header for [[RegionAccessScoreForApi]], generated from the scored-type set. */
object RegionAccessScoreForApi {
  val csvHeader: String = {
    val countCols = AccessScoreApiModels.orderedTypes.map(t => s"avg_n_${AccessScoreApiModels.snakeType(t)}")
    (Seq("region_id", "name", "score", "coverage", "audited_street_count", "total_street_count") ++
      countCols ++ Seq("center_point")).mkString(",") + "\n"
  }

  implicit val writes: Writes[RegionAccessScoreForApi] = (r: RegionAccessScoreForApi) => r.toJson
}

/**
 * Parsed geo-filters for the AccessScore endpoints. AccessScore is computed over a bbox; a region filter is resolved to
 * the region's bounding box upstream, with the resolved id retained to post-filter streets back to that region.
 *
 * @param bbox       Optional bounding box to score within.
 * @param regionId   Optional region id to score (resolved to its bbox by the controller).
 * @param regionName Optional region name to score (resolved to its bbox by the controller).
 */
case class AccessScoreFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None
)
