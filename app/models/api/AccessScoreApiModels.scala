/**
 * Models for the Project Sidewalk AccessScore API (v3, #3855).
 *
 * Holds the streaming DTOs returned by `/v3/api/accessScoreStreets`, `/v3/api/accessScoreIntersections` (#5095), and
 * `/v3/api/accessScoreRegions`, the engine configuration returned by `/v3/api/accessScoreConfig`, and the parsed filter
 * object. The scoring math itself lives in
 * `service.AccessScoreCalculator`; these types only carry and serialize the computed results and the constants behind
 * them. Per the v3 conventions (#3871) all output field names are snake_case; the dynamic per-type
 * breakdown objects are keyed by the canonical label-type names (e.g. "CurbRamp"), matching `/v3/api/labelTypes`.
 */
package models.api

import models.api.ApiModelUtils.escapeCsvField
import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.{LineString, MultiPolygon, Point}
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

  /** The intersection (corner-feature) types in stable column order: the per-type columns of an intersection. */
  val orderedIntersectionTypes: Seq[String] = AccessScoreCalculator.orderedIntersectionTypes

  /**
   * Builds a JSON object keyed by canonical label-type name from a (possibly sparse) per-type map, defaulting to
   * `default`, over `types` (every scored type for a street or region, the intersection types for an intersection).
   */
  private[api] def perTypeJson[T](values: Map[String, T], default: T, types: Seq[String] = orderedTypes)(implicit
      w: Writes[T]
  ): JsObject =
    JsObject(types.map(t => t -> Json.toJson(values.getOrElse(t, default))))

  /** Builds the dense `type → bucket → count` JSON object from a (possibly sparse) map, defaulting to 0. */
  private[api] def perTypeBucketJson(
      values: Map[String, Map[String, Int]],
      types: Seq[String] = orderedTypes
  ): JsObject =
    JsObject(types.map { t =>
      val byBucket: Map[String, Int] = values.getOrElse(t, Map.empty)
      t -> JsObject(severityBuckets.map(b => b -> Json.toJson(byBucket.getOrElse(b, 0))))
    })

  /** Every (type, bucket) pair in column order: types outermost, so a type's buckets sit together. */
  val typeBucketColumns: Seq[(String, String)] = typeBucketColumnsFor(orderedTypes)

  /** The (type, bucket) pairs of an intersection's per-type columns, in column order. */
  val intersectionTypeBucketColumns: Seq[(String, String)] = typeBucketColumnsFor(orderedIntersectionTypes)

  private def typeBucketColumnsFor(types: Seq[String]): Seq[(String, String)] =
    for {
      t <- types
      b <- severityBuckets
    } yield (t, b)

  /** The per-type CSV columns for `types`: `n_*`, then `score_*`, then the `n_*_sev*` buckets, then `tag_adj_*`. */
  private[api] def perTypeCsvColumns(types: Seq[String]): Seq[String] = {
    val countCols    = types.map(t => s"n_${snakeType(t)}")
    val subScoreCols = types.map(t => s"score_${snakeType(t)}")
    val bucketCols   = typeBucketColumnsFor(types).map { case (t, b) => s"n_${snakeType(t)}_${bucketSuffix(b)}" }
    val tagCols      = types.map(t => s"tag_adj_${snakeType(t)}")
    countCols ++ subScoreCols ++ bucketCols ++ tagCols
  }

  private[api] def perTypeCsvFields(
      types: Seq[String],
      clusterCounts: Map[String, Int],
      subScores: Map[String, Double],
      severityCounts: Map[String, Map[String, Int]],
      tagAdjustments: Map[String, Double]
  ): Seq[String] = {
    val countFields    = types.map(t => clusterCounts.getOrElse(t, 0).toString)
    val subScoreFields = types.map(t => subScores.getOrElse(t, 0.0).toString)
    val bucketFields   = typeBucketColumnsFor(types).map { case (t, b) =>
      severityCounts.getOrElse(t, Map.empty[String, Int]).getOrElse(b, 0).toString
    }
    val tagFields = types.map(t => tagAdjustments.getOrElse(t, 0.0).toString)
    countFields ++ subScoreFields ++ bucketFields ++ tagFields
  }

  private[api] def optCsv[T](value: Option[T]): String = value.map(_.toString).getOrElse("")
}

/**
 * AccessScore for a single street, for the v3 API.
 *
 * The street's own clusters score its **segment**; its two end intersections are scored from every cluster pooled on
 * them (#5095); the headline `score` is the mean of whichever of the three exist.
 *
 * @param streetEdgeId           Project Sidewalk street segment identifier.
 * @param osmWayId               OpenStreetMap way identifier.
 * @param regionId               Region (neighborhood) the street belongs to.
 * @param score                  Headline access score in (0, 1): the mean of `segmentScore` and the end intersections'
 *                               scores, over those that exist. None if the street has not been audited and neither
 *                               end is scored.
 * @param segmentScore           The segment's own score in (0, 1), or None if the street has not been audited.
 * @param startIntersectionId    The intersection at the start of the street's geometry, if there is one.
 * @param endIntersectionId      The intersection at the end of the street's geometry, if there is one.
 * @param startIntersectionScore That intersection's score, or None if it is unscored or absent.
 * @param endIntersectionScore   That intersection's score, or None if it is unscored or absent.
 * @param auditCount             Number of completed (high-quality) audits of this street.
 * @param lengthMeters           Street length in meters (geodesic; length-weights region scores and normalizes the
 *                               along-length terms).
 * @param labelCount             Number of labels contributing to this street's segment clusters.
 * @param clusterCounts          Per-label-type count of clusters scoring the segment: the along-length types, plus
 *                               any corner-type cluster not attributed to an intersection.
 * @param subScores              Per-label-type summed contribution to the segment's pre-sigmoid score.
 * @param severityCounts         Per-label-type cluster count per rating bucket ("1", "2", "3", "null"): with
 *                               `tagAdjustments` and `lengthMeters`, enough to recompute the segment score under
 *                               different weights.
 * @param tagAdjustments         Per-label-type summed active tag adjustment (the part of `subScores` no weight
 *                               scales, before length normalization).
 * @param geometry               The LineString geometry of the street.
 */
case class StreetAccessScoreForApi(
    streetEdgeId: Int,
    osmWayId: Long,
    regionId: Int,
    score: Option[Double],
    segmentScore: Option[Double],
    startIntersectionId: Option[Int],
    endIntersectionId: Option[Int],
    startIntersectionScore: Option[Double],
    endIntersectionScore: Option[Double],
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
        "street_edge_id"           -> streetEdgeId,
        "osm_way_id"               -> osmWayId,
        "region_id"                -> regionId,
        "score"                    -> score,
        "segment_score"            -> segmentScore,
        "start_intersection_id"    -> startIntersectionId,
        "end_intersection_id"      -> endIntersectionId,
        "start_intersection_score" -> startIntersectionScore,
        "end_intersection_score"   -> endIntersectionScore,
        "audit_count"              -> auditCount,
        "length_meters"            -> lengthMeters,
        "label_count"              -> labelCount,
        "cluster_counts"           -> AccessScoreApiModels.perTypeJson(clusterCounts, 0),
        "sub_scores"               -> AccessScoreApiModels.perTypeJson(subScores, 0.0),
        "severity_counts"          -> AccessScoreApiModels.perTypeBucketJson(severityCounts),
        "tag_adjustments"          -> AccessScoreApiModels.perTypeJson(tagAdjustments, 0.0)
      )
    )
  }

  /** Converts this street access score to a CSV row matching [[StreetAccessScoreForApi.csvHeader]]. */
  override def toCsvRow: String = {
    import AccessScoreApiModels.optCsv
    val baseFields = Seq(
      streetEdgeId.toString, osmWayId.toString, regionId.toString, optCsv(score), optCsv(segmentScore),
      optCsv(startIntersectionId), optCsv(endIntersectionId), optCsv(startIntersectionScore),
      optCsv(endIntersectionScore), auditCount.toString, lengthMeters.toString, labelCount.toString
    )
    val typeFields = AccessScoreApiModels.perTypeCsvFields(
      AccessScoreApiModels.orderedTypes, clusterCounts, subScores, severityCounts, tagAdjustments
    )
    val tailFields = Seq(
      escapeCsvField(s"${geometry.getStartPoint.getX},${geometry.getStartPoint.getY}"),
      escapeCsvField(s"${geometry.getEndPoint.getX},${geometry.getEndPoint.getY}")
    )
    (baseFields ++ typeFields ++ tailFields).mkString(",")
  }
}

/** Companion holding the CSV header for [[StreetAccessScoreForApi]], generated from the scored-type set. */
object StreetAccessScoreForApi {
  val csvHeader: String = {
    val baseCols = Seq(
      "street_edge_id", "osm_way_id", "region_id", "score", "segment_score", "start_intersection_id",
      "end_intersection_id", "start_intersection_score", "end_intersection_score", "audit_count", "length_meters",
      "label_count"
    )
    (baseCols ++ AccessScoreApiModels.perTypeCsvColumns(AccessScoreApiModels.orderedTypes) ++
      Seq("start_point", "end_point")).mkString(",") + "\n"
  }

  implicit val writes: Writes[StreetAccessScoreForApi] = (s: StreetAccessScoreForApi) => s.toJson
}

/**
 * AccessScore for an intersection, for the v3 API (#5095).
 *
 * Scored from the corner-type clusters (CurbRamp, NoCurbRamp, Crosswalk, Signal) attributed to it, pooled across every
 * street meeting there.
 *
 * @param intersectionId Project Sidewalk intersection identifier.
 * @param regionId       Region (neighborhood) most of the intersection's streets are in, or None.
 * @param degree         How many streets meet here.
 * @param gradeSeparated Whether this is a bridge or tunnel crossing rather than a place to cross: such a node is never
 *                       scored and holds no clusters.
 * @param streetEdgeIds  Every street meeting here.
 * @param auditCount     Completed (high-quality) audits summed over those streets.
 * @param score          Access score in (0, 1), or None if none of its streets has been audited or it is grade-separated.
 * @param labelCount     Number of labels contributing to this intersection's clusters.
 * @param clusterCounts  Per-label-type count of clusters attributed here, over the intersection types only.
 * @param subScores      Per-label-type summed contribution to the pre-sigmoid score.
 * @param severityCounts Per-label-type cluster count per rating bucket, over the intersection types only.
 * @param tagAdjustments Per-label-type summed active tag adjustment.
 * @param geometry       The Point geometry of the intersection.
 */
case class IntersectionAccessScoreForApi(
    intersectionId: Int,
    regionId: Option[Int],
    degree: Int,
    gradeSeparated: Boolean,
    streetEdgeIds: Seq[Int],
    auditCount: Int,
    score: Option[Double],
    labelCount: Int,
    clusterCounts: Map[String, Int],
    subScores: Map[String, Double],
    severityCounts: Map[String, Map[String, Int]],
    tagAdjustments: Map[String, Double],
    geometry: Point
) extends StreamingApiType {

  /** Converts this intersection access score to a GeoJSON Feature with a Point geometry. */
  override def toJson: JsObject = {
    val types: Seq[String] = AccessScoreApiModels.orderedIntersectionTypes
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> Json.obj(
        "intersection_id" -> intersectionId,
        "region_id"       -> regionId,
        "degree"          -> degree,
        "grade_separated" -> gradeSeparated,
        "street_edge_ids" -> streetEdgeIds,
        "audit_count"     -> auditCount,
        "score"           -> score,
        "label_count"     -> labelCount,
        "cluster_counts"  -> AccessScoreApiModels.perTypeJson(clusterCounts, 0, types),
        "sub_scores"      -> AccessScoreApiModels.perTypeJson(subScores, 0.0, types),
        "severity_counts" -> AccessScoreApiModels.perTypeBucketJson(severityCounts, types),
        "tag_adjustments" -> AccessScoreApiModels.perTypeJson(tagAdjustments, 0.0, types)
      )
    )
  }

  /** Converts this intersection access score to a CSV row matching [[IntersectionAccessScoreForApi.csvHeader]]. */
  override def toCsvRow: String = {
    import AccessScoreApiModels.optCsv
    val baseFields = Seq(
      intersectionId.toString,
      optCsv(regionId),
      degree.toString,
      gradeSeparated.toString,
      escapeCsvField(streetEdgeIds.mkString("[", ",", "]")),
      auditCount.toString,
      optCsv(score),
      labelCount.toString
    )
    val typeFields = AccessScoreApiModels.perTypeCsvFields(
      AccessScoreApiModels.orderedIntersectionTypes, clusterCounts, subScores, severityCounts, tagAdjustments
    )
    val tailFields = Seq(geometry.getY.toString, geometry.getX.toString)
    (baseFields ++ typeFields ++ tailFields).mkString(",")
  }
}

/** Companion holding the CSV header for [[IntersectionAccessScoreForApi]], generated from the intersection-type set. */
object IntersectionAccessScoreForApi {
  val csvHeader: String = {
    val baseCols = Seq(
      "intersection_id", "region_id", "degree", "grade_separated", "street_edge_ids", "audit_count", "score",
      "label_count"
    )
    (baseCols ++ AccessScoreApiModels.perTypeCsvColumns(AccessScoreApiModels.orderedIntersectionTypes) ++
      Seq("lat", "lng")).mkString(",") + "\n"
  }

  implicit val writes: Writes[IntersectionAccessScoreForApi] = (i: IntersectionAccessScoreForApi) => i.toJson
}

/**
 * AccessScore for a region (neighborhood), for the v3 API.
 *
 * @param regionId            Project Sidewalk region identifier.
 * @param name                Region name.
 * @param score               Street-length-weighted mean of audited street scores in (0, 1), or None if none audited.
 * @param coverage            Fraction of the region's streets that have been audited, in [0, 1].
 * @param auditedStreetCount       Number of audited streets in the region.
 * @param totalStreetCount         Total number of streets in the region.
 * @param intersectionScore        Plain mean of the region's scored intersections' scores (#5095), or None if none.
 * @param intersectionCount        Number of intersections in the region, grade-separated crossings excluded.
 * @param scoredIntersectionCount  How many of those have a score (at least one of their streets audited).
 * @param avgClusterCounts         Per-label-type mean cluster count across the region's audited streets.
 * @param geometry                 The MultiPolygon geometry of the region.
 */
case class RegionAccessScoreForApi(
    regionId: Int,
    name: String,
    score: Option[Double],
    coverage: Double,
    auditedStreetCount: Int,
    totalStreetCount: Int,
    intersectionScore: Option[Double],
    intersectionCount: Int,
    scoredIntersectionCount: Int,
    avgClusterCounts: Map[String, Double],
    geometry: MultiPolygon
) extends StreamingApiType {

  /** Converts this region access score to a GeoJSON Feature with a MultiPolygon geometry. */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> Json.obj(
        "region_id"                 -> regionId,
        "name"                      -> name,
        "score"                     -> score,
        "coverage"                  -> coverage,
        "audited_street_count"      -> auditedStreetCount,
        "total_street_count"        -> totalStreetCount,
        "intersection_score"        -> intersectionScore,
        "intersection_count"        -> intersectionCount,
        "scored_intersection_count" -> scoredIntersectionCount,
        "avg_cluster_counts"        -> AccessScoreApiModels.perTypeJson(avgClusterCounts, 0.0)
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
      totalStreetCount.toString,
      AccessScoreApiModels.optCsv(intersectionScore),
      intersectionCount.toString,
      scoredIntersectionCount.toString
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
    (Seq(
      "region_id", "name", "score", "coverage", "audited_street_count", "total_street_count", "intersection_score",
      "intersection_count", "scored_intersection_count"
    ) ++ countCols ++ Seq("center_point")).mkString(",") + "\n"
  }

  implicit val writes: Writes[RegionAccessScoreForApi] = (r: RegionAccessScoreForApi) => r.toJson
}

/**
 * One label type's scoring configuration, for `/v3/api/accessScoreConfig`.
 *
 * @param baseWeight       Signed base weight.
 * @param scoring          The scoring mode's API name: `presence_only`, `positive_quality`, `negative_severity`, or
 *                         `street_condition`.
 * @param lengthNormalized Whether the type's segment term is scaled to a per-100 m density (#5095).
 */
case class TypeWeightForApi(baseWeight: Double, scoring: String, lengthNormalized: Boolean)

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
 * @param intersectionTypes             The scored types pooled on intersections (#5095), in that same order.
 * @param segmentTypes                  The scored types that describe a stretch of street, in that same order.
 * @param attributionRadiusMeters       How far from an intersection a corner-type cluster is still attributed to it.
 * @param lengthNormalizationPerMeters  The street length a length-normalized type's term is expressed per.
 * @param lengthMinMeters               The floor on a street's length in that normalization.
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
    intersectionTypes: Seq[String],
    segmentTypes: Seq[String],
    attributionRadiusMeters: Double,
    lengthNormalizationPerMeters: Double,
    lengthMinMeters: Double,
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
      "scored_types"              -> scoredTypes,
      "intersection_types"        -> intersectionTypes,
      "segment_types"             -> segmentTypes,
      "attribution_radius_meters" -> attributionRadiusMeters,
      "length_normalization"      -> Json.obj(
        "per_meters"        -> lengthNormalizationPerMeters,
        "min_length_meters" -> lengthMinMeters
      ),
      "severity_buckets" -> severityBuckets,
      "type_weights"     -> JsObject(scoredTypes.map { t =>
        t -> Json.obj(
          "base_weight"       -> typeWeights(t).baseWeight,
          "scoring"           -> typeWeights(t).scoring,
          "length_normalized" -> typeWeights(t).lengthNormalized
        )
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
      intersectionTypes = AccessScoreCalculator.orderedIntersectionTypes,
      segmentTypes = types.filter(AccessScoreCalculator.segmentTypeNames.contains),
      attributionRadiusMeters = AccessScoreCalculator.attributionRadiusMeters,
      lengthNormalizationPerMeters = AccessScoreCalculator.lengthNormalizationPerMeters,
      lengthMinMeters = AccessScoreCalculator.lengthMinMeters,
      severityBuckets = AccessScoreCalculator.severityBuckets,
      typeWeights = AccessScoreCalculator.typeWeights.map { case (t, tw) =>
        t -> TypeWeightForApi(tw.baseWeight, AccessScoreCalculator.scoringName(tw.scoring), tw.lengthNormalized)
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
