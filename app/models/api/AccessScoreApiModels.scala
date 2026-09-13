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

import models.label.LabelTypeEnum
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

  /** The scored label types in canonical order, so output columns stay stable. */
  val orderedTypes: Seq[String] = AccessScoreCalculator.orderedScoredTypes

  /**
   * Short code for a label type's shapefile columns, since DBF cuts column names off at 10 characters. Covers every
   * type, not just the scored ones, so the compiler flags a newly added type that has no code.
   *
   * @param labelType A label type name (e.g. "NoCurbRamp").
   * @return          Its short code (e.g. "NoCRamp").
   */
  def shapefileTypeCode(labelType: String): String = LabelTypeEnum.withName(labelType) match {
    case LabelTypeEnum.CurbRamp       => "CRamp"
    case LabelTypeEnum.NoCurbRamp     => "NoCRamp"
    case LabelTypeEnum.Obstacle       => "Obst"
    case LabelTypeEnum.SurfaceProblem => "Surf"
    case LabelTypeEnum.Crosswalk      => "Xwalk"
    case LabelTypeEnum.Signal         => "Signal"
    case LabelTypeEnum.NoSidewalk     => "NoSwk"
    case LabelTypeEnum.Occlusion      => "Occl"
    case LabelTypeEnum.Other          => "Other"
  }

  /** The rating buckets a cluster can fall into, in column order. */
  val severityBuckets: Seq[String] = AccessScoreCalculator.severityBuckets

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

  /** Every (type, bucket) pair in column order: types outermost, so a type's buckets sit together. */
  val typeBucketColumns: Seq[(String, String)] = typeBucketColumnsFor(orderedTypes)

  /** The (type, bucket) pairs of an intersection's per-type columns, in column order. */
  val intersectionTypeBucketColumns: Seq[(String, String)] = typeBucketColumnsFor(orderedIntersectionTypes)

  private def typeBucketColumnsFor(types: Seq[String]): Seq[(String, String)] =
    for {
      t <- types
      b <- severityBuckets
    } yield (t, b)

  /**
   * The four per-type blocks as fields, for any record that carries them.
   *
   * @param types The label types to emit columns for, in order.
   * @return The fields, sparse entries filled with the block's zero value.
   */
  private[api] def perTypeFields[T](
      types: Seq[String],
      clusterCounts: T => Map[String, Int],
      subScores: T => Map[String, Double],
      severityCounts: T => Map[String, Map[String, Int]],
      tagAdjustments: T => Map[String, Double]
  ): Seq[ApiField[T]] = {
    import ApiFields.field
    types.map(t => field[T, Int](s"cluster_counts.$t")(r => clusterCounts(r).getOrElse(t, 0))) ++
      types.map(t => field[T, Double](s"sub_scores.$t")(r => subScores(r).getOrElse(t, 0.0))) ++
      typeBucketColumnsFor(types).map { case (t, b) =>
        field[T, Int](s"severity_counts.$t.$b") { r =>
          severityCounts(r).getOrElse(t, Map.empty[String, Int]).getOrElse(b, 0)
        }
      } ++
      types.map(t => field[T, Double](s"tag_adjustments.$t")(r => tagAdjustments(r).getOrElse(t, 0.0)))
  }
}

/**
 * AccessScore for a single street, for the v3 API.
 *
 * The street's own clusters score its **segment**; its two end intersections are scored from every cluster pooled on
 * them (#5095); the headline `score` is the mean of whichever of the three exist.
 *
 * @param streetEdgeId           Project Sidewalk street segment identifier.
 * @param osmWayId               OpenStreetMap way identifier.
 * @param streetName             The street's name from its OpenStreetMap way's `name` tag, if it has one.
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
    streetName: Option[String],
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
      "properties" -> StreetAccessScoreForApi.toJson(this)
    )
  }

  override def toCsvRow: String = StreetAccessScoreForApi.toCsvRow(this)
}

object StreetAccessScoreForApi extends ApiFields[StreetAccessScoreForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[StreetAccessScoreForApi]] = Seq[ApiField[StreetAccessScoreForApi]](
    field("street_edge_id")(_.streetEdgeId),
    field("osm_way_id")(_.osmWayId),
    field("street_name")(_.streetName),
    field("region_id")(_.regionId),
    field("score")(_.score),
    field("segment_score")(_.segmentScore),
    field("start_intersection_id")(_.startIntersectionId),
    field("end_intersection_id")(_.endIntersectionId),
    field("start_intersection_score")(_.startIntersectionScore),
    field("end_intersection_score")(_.endIntersectionScore),
    field("audit_count")(_.auditCount),
    field("length_meters")(_.lengthMeters),
    field("label_count")(_.labelCount)
  ) ++ AccessScoreApiModels.perTypeFields[StreetAccessScoreForApi](
    AccessScoreApiModels.orderedTypes, _.clusterCounts, _.subScores, _.severityCounts, _.tagAdjustments
  )

  override val csvOnlyFields: Seq[ApiField[StreetAccessScoreForApi]] = Seq(
    field("start_point")(s => s"${s.geometry.getStartPoint.getX},${s.geometry.getStartPoint.getY}"),
    field("end_point")(s => s"${s.geometry.getEndPoint.getX},${s.geometry.getEndPoint.getY}")
  )

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
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> geometry,
      "properties" -> IntersectionAccessScoreForApi.toJson(this)
    )
  }

  override def toCsvRow: String = IntersectionAccessScoreForApi.toCsvRow(this)
}

object IntersectionAccessScoreForApi extends ApiFields[IntersectionAccessScoreForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[IntersectionAccessScoreForApi]] = Seq[ApiField[IntersectionAccessScoreForApi]](
    field("intersection_id")(_.intersectionId),
    field("region_id")(_.regionId),
    field("degree")(_.degree),
    field("grade_separated")(_.gradeSeparated),
    field("street_edge_ids")(_.streetEdgeIds),
    field("audit_count")(_.auditCount),
    field("score")(_.score),
    field("label_count")(_.labelCount)
  ) ++ AccessScoreApiModels.perTypeFields[IntersectionAccessScoreForApi](
    AccessScoreApiModels.orderedIntersectionTypes, _.clusterCounts, _.subScores, _.severityCounts, _.tagAdjustments
  )

  override val csvOnlyFields: Seq[ApiField[IntersectionAccessScoreForApi]] = Seq(
    field("lat")(_.geometry.getY),
    field("lng")(_.geometry.getX)
  )

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
      "properties" -> RegionAccessScoreForApi.toJson(this)
    )
  }

  override def toCsvRow: String = RegionAccessScoreForApi.toCsvRow(this)
}

object RegionAccessScoreForApi extends ApiFields[RegionAccessScoreForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[RegionAccessScoreForApi]] = Seq[ApiField[RegionAccessScoreForApi]](
    field("region_id")(_.regionId),
    field("name")(_.name),
    field("score")(_.score),
    field("coverage")(_.coverage),
    field("audited_street_count")(_.auditedStreetCount),
    field("total_street_count")(_.totalStreetCount),
    field("intersection_score")(_.intersectionScore),
    field("intersection_count")(_.intersectionCount),
    field("scored_intersection_count")(_.scoredIntersectionCount)
  ) ++ AccessScoreApiModels.orderedTypes.map { labelType =>
    field(s"avg_cluster_counts.$labelType")(_.avgClusterCounts.getOrElse(labelType, 0.0))
  }

  override val csvOnlyFields: Seq[ApiField[RegionAccessScoreForApi]] = Seq(
    field("center_point")(r => s"${r.geometry.getCentroid.getX},${r.geometry.getCentroid.getY}")
  )

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
