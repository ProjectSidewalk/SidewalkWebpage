/**
 * Models for the Project Sidewalk AccessScore API (v3, #3855).
 *
 * Holds the streaming DTOs returned by `/v3/api/accessScoreStreets` and `/v3/api/accessScoreRegions`, the engine
 * configuration returned by `/v3/api/accessScoreConfig`, and the parsed filter object. The scoring math itself lives in
 * `service.AccessScoreCalculator`; these types only carry and serialize the computed results and the constants behind
 * them. Per the v3 conventions (#3871) all output field names are snake_case; the dynamic per-type
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

  /** The rating buckets a cluster can fall into, in column order. */
  val severityBuckets: Seq[String] = AccessScoreCalculator.severityBuckets

  /**
   * The CSV/GeoPackage column suffix for a rating bucket: `sev1`..`sev3`, or `sev_null` for unrated clusters.
   *
   * @param bucket One of [[severityBuckets]].
   * @return       The suffix.
   */
  def bucketSuffix(bucket: String): String =
    if (bucket == AccessScoreCalculator.nullSeverityBucket) "sev_null" else s"sev$bucket"

  /**
   * The shapefile column prefix for a rating bucket's cluster count: `n1`..`n3`, or `n0` for unrated clusters, so the
   * per-type code that follows keeps the column under DBF's 10 characters.
   *
   * @param bucket One of [[severityBuckets]].
   * @return       The prefix.
   */
  def shapefileBucketPrefix(bucket: String): String =
    if (bucket == AccessScoreCalculator.nullSeverityBucket) "n0" else s"n$bucket"

  /** Builds a JSON object keyed by canonical label-type name from a (possibly sparse) per-type map, defaulting to 0. */
  private[api] def perTypeJson[T](values: Map[String, T], default: T)(implicit w: Writes[T]): JsObject =
    JsObject(orderedTypes.map(t => t -> Json.toJson(values.getOrElse(t, default))))

  /** Builds the dense `type → bucket → count` JSON object from a (possibly sparse) map, defaulting to 0. */
  private[api] def perTypeBucketJson(values: Map[String, Map[String, Int]]): JsObject =
    JsObject(orderedTypes.map { t =>
      val byBucket: Map[String, Int] = values.getOrElse(t, Map.empty)
      t -> JsObject(severityBuckets.map(b => b -> Json.toJson(byBucket.getOrElse(b, 0))))
    })

  /** Every (type, bucket) pair in column order: types outermost, so a type's buckets sit together. */
  val typeBucketColumns: Seq[(String, String)] =
    for {
      t <- orderedTypes
      b <- severityBuckets
    } yield (t, b)
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
 * @param severityCounts      Per-label-type cluster count per rating bucket ("1", "2", "3", "null"): with
 *                            `tagAdjustments`, enough to recompute the score under different weights.
 * @param tagAdjustments      Per-label-type summed active tag adjustment (the part of `subScores` no weight scales).
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
    severityCounts: Map[String, Map[String, Int]],
    tagAdjustments: Map[String, Double],
    geometry: LineString
) extends StreamingApiType {

  /** Converts this street access score to a GeoJSON Feature with a LineString geometry. */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> Json.obj(
        "street_edge_id"  -> streetEdgeId,
        "osm_way_id"      -> osmWayId,
        "region_id"       -> regionId,
        "score"           -> score,
        "audit_count"     -> auditCount,
        "length_meters"   -> lengthMeters,
        "label_count"     -> labelCount,
        "cluster_counts"  -> AccessScoreApiModels.perTypeJson(clusterCounts, 0),
        "sub_scores"      -> AccessScoreApiModels.perTypeJson(subScores, 0.0),
        "severity_counts" -> AccessScoreApiModels.perTypeBucketJson(severityCounts),
        "tag_adjustments" -> AccessScoreApiModels.perTypeJson(tagAdjustments, 0.0)
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
    val bucketFields   = AccessScoreApiModels.typeBucketColumns.map { case (t, b) =>
      severityCounts.getOrElse(t, Map.empty[String, Int]).getOrElse(b, 0).toString
    }
    val tagFields  = AccessScoreApiModels.orderedTypes.map(t => tagAdjustments.getOrElse(t, 0.0).toString)
    val tailFields = Seq(
      escapeCsvField(s"${geometry.getStartPoint.getX},${geometry.getStartPoint.getY}"),
      escapeCsvField(s"${geometry.getEndPoint.getX},${geometry.getEndPoint.getY}")
    )
    (baseFields ++ countFields ++ subScoreFields ++ bucketFields ++ tagFields ++ tailFields).mkString(",")
  }
}

/** Companion holding the CSV header for [[StreetAccessScoreForApi]], generated from the scored-type set. */
object StreetAccessScoreForApi {
  val csvHeader: String = {
    val countCols    = AccessScoreApiModels.orderedTypes.map(t => s"n_${AccessScoreApiModels.snakeType(t)}")
    val subScoreCols = AccessScoreApiModels.orderedTypes.map(t => s"score_${AccessScoreApiModels.snakeType(t)}")
    val bucketCols   = AccessScoreApiModels.typeBucketColumns.map { case (t, b) =>
      s"n_${AccessScoreApiModels.snakeType(t)}_${AccessScoreApiModels.bucketSuffix(b)}"
    }
    val tagCols = AccessScoreApiModels.orderedTypes.map(t => s"tag_adj_${AccessScoreApiModels.snakeType(t)}")
    (Seq("street_edge_id", "osm_way_id", "region_id", "score", "audit_count", "length_meters", "label_count") ++
      countCols ++ subScoreCols ++ bucketCols ++ tagCols ++ Seq("start_point", "end_point")).mkString(",") + "\n"
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
 * One label type's scoring configuration, for `/v3/api/accessScoreConfig`.
 *
 * @param baseWeight Signed base weight.
 * @param scoring    The scoring mode's API name: `presence_only`, `positive_quality`, `negative_severity`, or
 *                   `street_condition`.
 */
case class TypeWeightForApi(baseWeight: Double, scoring: String)

/**
 * One tag's adjustment to its label type's contribution, for `/v3/api/accessScoreConfig`.
 *
 * @param labelType The label type the tag belongs to.
 * @param tag       The tag.
 * @param delta     The signed adjustment added when the tag is active.
 */
case class TagAdjustmentForApi(labelType: String, tag: String, delta: Double)

/**
 * The AccessScore engine's configuration, published so a client can recompute a street's score from the counts the
 * streets endpoint carries — under the engine's weights or its own — without re-declaring any of it (#3855).
 *
 * @param scoredTypes                   The scored label types, in the order every per-type output uses.
 * @param severityBuckets               The rating buckets of `severity_counts`, in order.
 * @param typeWeights                   Per type, its base weight and scoring mode.
 * @param qualityMultiplier             Per bucket, the multiplier for `positive_quality` types.
 * @param severityMultiplier            Per bucket, the multiplier for `negative_severity` types.
 * @param streetConditionSaturationCount The cluster count at which a `street_condition` type's extent factor reaches 1.
 * @param tagAdjustments                Every tag adjustment the engine applies.
 * @param streetConditionPointTags      The (type, tag) pairs judged per cluster rather than over a street's pooled labels.
 * @param tagActiveThreshold            The fraction of labels a tag must cover to be active.
 * @param presetOrder                   The preset ids in display order.
 * @param presets                       Per preset id, a weight magnitude per scored type.
 */
case class AccessScoreConfigForApi(
    scoredTypes: Seq[String],
    severityBuckets: Seq[String],
    typeWeights: Map[String, TypeWeightForApi],
    qualityMultiplier: Map[String, Double],
    severityMultiplier: Map[String, Double],
    streetConditionSaturationCount: Int,
    tagAdjustments: Seq[TagAdjustmentForApi],
    streetConditionPointTags: Seq[(String, String)],
    tagActiveThreshold: Double,
    presetOrder: Seq[String],
    presets: Map[String, Map[String, Double]]
) {

  /** Serializes the configuration with snake_case keys; per-type and per-bucket objects keep the engine's order. */
  def toJson: JsObject = {
    val orderedBuckets: Map[String, Double] => JsObject =
      m => JsObject(severityBuckets.map(b => b -> Json.toJson(m(b))))
    val orderedWeights: Map[String, Double] => JsObject =
      m => JsObject(scoredTypes.map(t => t -> Json.toJson(m.getOrElse(t, 0.0))))
    Json.obj(
      "scored_types"     -> scoredTypes,
      "severity_buckets" -> severityBuckets,
      "type_weights"     -> JsObject(scoredTypes.map { t =>
        t -> Json.obj("base_weight" -> typeWeights(t).baseWeight, "scoring" -> typeWeights(t).scoring)
      }),
      "quality_multiplier"                -> orderedBuckets(qualityMultiplier),
      "severity_multiplier"               -> orderedBuckets(severityMultiplier),
      "street_condition_saturation_count" -> streetConditionSaturationCount,
      "tag_adjustments"                   -> tagAdjustments.map { a =>
        Json.obj("label_type" -> a.labelType, "tag" -> a.tag, "delta" -> a.delta)
      },
      "street_condition_point_tags" -> streetConditionPointTags.map { case (t, tag) =>
        Json.obj("label_type" -> t, "tag" -> tag)
      },
      "tag_active_threshold" -> tagActiveThreshold,
      "preset_order"         -> presetOrder,
      "presets"              -> JsObject(presetOrder.map(id => id -> orderedWeights(presets(id))))
    )
  }
}

/** Builds the config DTO from the engine, so the API can only ever publish what it computes with. */
object AccessScoreConfigForApi {

  /** The engine's current configuration. */
  def current: AccessScoreConfigForApi = {
    val types: Seq[String] = AccessScoreCalculator.orderedScoredTypes
    AccessScoreConfigForApi(
      scoredTypes = types,
      severityBuckets = AccessScoreCalculator.severityBuckets,
      typeWeights = AccessScoreCalculator.typeWeights.map { case (t, tw) =>
        t -> TypeWeightForApi(tw.baseWeight, AccessScoreCalculator.scoringName(tw.scoring))
      },
      qualityMultiplier = AccessScoreCalculator.qualityMultiplierByBucket,
      severityMultiplier = AccessScoreCalculator.severityMultiplierByBucket,
      streetConditionSaturationCount = AccessScoreCalculator.streetConditionSaturationCount,
      // Type order first, then tag name, so the listing is stable across JVMs (the source map is unordered).
      tagAdjustments = AccessScoreCalculator.tagAdjustments.toSeq
        .map { case ((t, tag), delta) => TagAdjustmentForApi(t, tag, delta) }
        .sortBy(a => (types.indexOf(a.labelType), a.tag)),
      streetConditionPointTags = AccessScoreCalculator.streetConditionPointTags.toSeq.sorted,
      tagActiveThreshold = AccessScoreCalculator.tagActiveThreshold,
      presetOrder = AccessScoreCalculator.presetOrder,
      presets = AccessScoreCalculator.presets
    )
  }

  implicit val writes: Writes[AccessScoreConfigForApi] = (c: AccessScoreConfigForApi) => c.toJson
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
