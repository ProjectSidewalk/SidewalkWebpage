package service

import models.label.LabelTypeEnum

/**
 * Pure, DB-free scoring engine for the v3 AccessScore API (#3855).
 *
 * Implements the severity/quality- and tag-aware extension of Chu Li's Urban Access 2022 AccessScore. All weighting
 * lives here as tunable constants so the math can be unit-tested in isolation and adjusted without touching the DB layer
 * ([[AccessScoreService]]) or the controller. Nothing in this object performs IO.
 *
 * The model scores two kinds of unit (#5095): a street **segment** and an **intersection**.
 *   - A unit's pre-sigmoid sum is the sum of one term per scored label type ([[scoreByType]]).
 *   - For per-cluster types that term is the sum of each cluster's
 *     `contribution = base(type) * multiplier + tagAdjustments` ([[scoreCluster]]).
 *   - For a street-condition type (NoSidewalk, #5093) the street's clusters pool into a single term,
 *     `base(type) * extent(n) + pooledTagAdjustments`, so the penalty reflects the street's condition rather than how
 *     many pins a labeler dropped along it.
 *   - The intersection types ([[intersectionTypeNames]]: CurbRamp, NoCurbRamp, Crosswalk, Signal) are corner
 *     features. Their clusters are pooled on the intersection they sit at, across every street meeting there, and
 *     score it; a cluster too far from any intersection (a mid-block crosswalk, a driveway ramp) stays with its
 *     street and scores the segment as an ordinary point feature.
 *   - The along-length types ([[segmentTypeNames]]) score the segment. The [[lengthNormalized]] ones (Obstacle,
 *     SurfaceProblem) are scaled to a per-100 m density by [[lengthFactor]], so a long street is not penalized for
 *     having more room for problems; NoSidewalk's pooled term is already length-free.
 *   - A unit's score is `sigmoid(sum)`, mapped to (0, 1).
 *   - A street's headline score is the mean of its segment score and its end intersections' scores
 *     ([[headlineScore]]): a trip along a street includes getting on and off it.
 *   - A region's score is the street-length-weighted mean of its audited streets' scores (the paper's normalization),
 *     and its intersection score the plain mean of its scored intersections.
 *
 * Severity semantics differ by type and are the crux of the model (the same DB `severity` column means different things):
 *   - Positive **quality**-rated types (CurbRamp, Crosswalk): Good(1) / Okay(2) / Bad(3). A Bad one flips negative.
 *   - Negative **severity**-rated types (NoCurbRamp, Obstacle, SurfaceProblem): Low(1) / Med(2) / High(3).
 *   - **Presence-only** types (Signal): no severity; a fixed weight for mere presence.
 *   - **Street-condition** types (NoSidewalk): no severity; one pooled term per street (see [[StreetCondition]]).
 */
object AccessScoreCalculator {

  /** How a label type's clusters are turned into its contribution to a street's score. */
  sealed trait Scoring

  /** Severity ignored; each cluster's presence alone contributes `baseWeight` (e.g. Signal). */
  case object PresenceOnly extends Scoring

  /** Quality-rated positive feature: severity 1=Good, 2=Okay, 3=Bad (a Bad one contributes negatively). */
  case object PositiveQuality extends Scoring

  /** Severity-rated negative feature: severity 1=Low, 2=Med, 3=High (magnitude grows with severity). */
  case object NegativeSeverity extends Scoring

  /**
   * Scored once per street rather than once per cluster (#5093).
   *
   * NoSidewalk describes a stretch of street, not a point, and labelers pin it repeatedly along the stretch (it also
   * has the tightest clustering threshold, 10 m), so a per-cluster weight would track label density instead of the
   * street's condition. All of a street's clusters of this type pool into one term:
   * `baseWeight * min(1, n / streetConditionSaturationCount) + pooledTagAdjustments`, where `n` is the cluster count.
   * A tag is active when it covers at least [[tagActiveThreshold]] of the street's pooled labels of this type, except
   * the [[streetConditionPointTags]], which are active when any single cluster carries them at that threshold.
   */
  case object StreetCondition extends Scoring

  /**
   * Per-type scoring configuration.
   *
   * @param baseWeight       Signed base weight (positive features positive, negative features negative). The
   *                         severity/quality multiplier scales this; for `PositiveQuality` the multiplier may flip the
   *                         sign (Bad → negative).
   * @param scoring          How this type's clusters are scored.
   * @param lengthNormalized Whether the type's term on a segment is scaled to a per-100 m density ([[lengthFactor]]).
   *                         Only meaningful for along-length types; an intersection has no length.
   */
  case class TypeWeight(baseWeight: Double, scoring: Scoring, lengthNormalized: Boolean = false)

  // --- TUNABLE: base weight + scoring mode per scored label type. Types absent here are excluded from scoring. ---
  val typeWeights: Map[String, TypeWeight] = Map(
    LabelTypeEnum.CurbRamp.name   -> TypeWeight(+0.75, PositiveQuality),
    LabelTypeEnum.Crosswalk.name  -> TypeWeight(+0.75, PositiveQuality),
    LabelTypeEnum.Signal.name     -> TypeWeight(+0.50, PresenceOnly),
    LabelTypeEnum.NoCurbRamp.name -> TypeWeight(-1.00, NegativeSeverity),
    // Along-length problems are counted per 100 m of street (#5095): three obstacles on a 300 m street are the
    // same density as one on a 100 m street, and score the same.
    LabelTypeEnum.Obstacle.name       -> TypeWeight(-1.00, NegativeSeverity, lengthNormalized = true),
    LabelTypeEnum.SurfaceProblem.name -> TypeWeight(-1.00, NegativeSeverity, lengthNormalized = true),
    // A whole street without a sidewalk sits at sigmoid(-2) ≈ 0.12 before its tags and other features (#5093).
    LabelTypeEnum.NoSidewalk.name -> TypeWeight(-2.00, StreetCondition)
  )

  /** Names of the label types that contribute to the score. Single source of truth for the DB query's type filter. */
  val scoredTypeNames: Set[String] = typeWeights.keySet

  /** Scored types in the canonical label type order so CSV/shapefile columns never drift from the header. */
  val orderedScoredTypes: Seq[String] = LabelTypeEnum.orderedNames.filter(scoredTypeNames.contains)

  /** Each scored type's signed base weight, the form [[subScoresFromCounts]] takes so a caller can substitute its own. */
  val baseWeights: Map[String, Double] = typeWeights.map { case (t, tw) => t -> tw.baseWeight }

  // --- Intersections as a scoring unit (#5095). ---
  // Measured on Seattle's clusters: 81-95% of CurbRamp, NoCurbRamp, Crosswalk and Signal clusters sit within 25 m of
  // an intersection (median 9-15 m), against 22-24% of Obstacle, SurfaceProblem and NoSidewalk clusters (median
  // 29-32 m, what a uniform spread along a street looks like). The split is clean, so it is a fixed partition.

  /** The scored types that are corner features, pooled on the intersection they sit at rather than on a street. */
  val intersectionTypeNames: Set[String] = Set(
    LabelTypeEnum.CurbRamp.name,
    LabelTypeEnum.NoCurbRamp.name,
    LabelTypeEnum.Crosswalk.name,
    LabelTypeEnum.Signal.name
  )

  /** The scored types that describe a stretch of street: everything scored that isn't an intersection type. */
  val segmentTypeNames: Set[String] = scoredTypeNames -- intersectionTypeNames

  /** The intersection types in canonical order, the column order of every per-type intersection output. */
  val orderedIntersectionTypes: Seq[String] = orderedScoredTypes.filter(intersectionTypeNames.contains)

  // --- TUNABLE: how far (geodesic meters) from the nearest intersection a corner-type cluster is still attributed to
  // it. The 5-8% of such clusters farther out are mid-block crosswalks and driveway ramps, which stay with the street.
  // Cited by the SQL that attributes clusters (IntersectionTable) and published by /v3/api/accessScoreConfig. ---
  val attributionRadiusMeters: Double = 25.0

  // --- TUNABLE: a length-normalized type's term is expressed per this many meters of street, with the street's
  // length floored at lengthMinMeters so a stub can't multiply one problem without bound (factor caps at 4). ---
  val lengthNormalizationPerMeters: Double = 100.0
  val lengthMinMeters: Double              = 25.0

  /**
   * The factor a [[TypeWeight.lengthNormalized]] type's segment term is scaled by: the term per
   * [[lengthNormalizationPerMeters]] of street, the street's length floored at [[lengthMinMeters]].
   *
   * @param lengthMeters The segment's length in meters.
   * @return             `per / max(length, min)`: 1 on a 100 m street, 0.5 on a 200 m one, 4 on anything ≤ 25 m.
   */
  def lengthFactor(lengthMeters: Double): Double =
    lengthNormalizationPerMeters / math.max(lengthMeters, lengthMinMeters)

  /** [[lengthFactor]] for a length-normalized type on a segment; 1 for everything else, intersections included. */
  private def termFactor(labelType: String, lengthMeters: Option[Double]): Double =
    lengthMeters match {
      case Some(length) if typeWeights.get(labelType).exists(_.lengthNormalized) => lengthFactor(length)
      case _                                                                     => 1.0
    }

  // --- TUNABLE: quality multiplier for PositiveQuality types. Signed: Bad(3) flips a positive base to a penalty. ---
  private val qualityMultiplier: Map[Int, Double] = Map(1 -> 1.0, 2 -> 0.5, 3 -> -1.0)
  // Null quality on a positive type → treat as Okay (credit an unknown weakly but still positively).
  private val qualityNullMultiplier: Double = qualityMultiplier(2)

  // --- TUNABLE: severity magnitude for NegativeSeverity types (unsigned; the negative base carries the sign). ---
  private val severityMultiplier: Map[Int, Double] = Map(1 -> 0.33, 2 -> 0.67, 3 -> 1.0)
  // Null severity on a negative type → treat as Low (penalize an unknown conservatively). Highest-impact tuning knob:
  // v2 effectively used magnitude 1.0 for every negative cluster, so scores shift relative to v2 by design (#3855).
  private val severityNullMultiplier: Double = severityMultiplier(1)

  /** The rating bucket for an unrated cluster, or one whose rating is outside 1..3 (the multiplier maps' domain). */
  val nullSeverityBucket: String = "null"

  /** The rating buckets a cluster can fall into, in the order the API publishes them. */
  val severityBuckets: Seq[String] = Seq("1", "2", "3", nullSeverityBucket)

  /** The quality multipliers keyed by [[severityBuckets]], the null bucket carrying its fallback. */
  val qualityMultiplierByBucket: Map[String, Double] =
    qualityMultiplier.map { case (s, m) => s.toString -> m } + (nullSeverityBucket -> qualityNullMultiplier)

  /** The severity multipliers keyed by [[severityBuckets]], the null bucket carrying its fallback. */
  val severityMultiplierByBucket: Map[String, Double] =
    severityMultiplier.map { case (s, m) => s.toString -> m } + (nullSeverityBucket -> severityNullMultiplier)

  // --- TUNABLE: cluster count at which a StreetCondition type's extent factor reaches 1. One stray pin counts 1/n
  // of the base weight; n or more clusters count the full base, however many more there are. Labelers place
  // NoSidewalk at a median of ~5 clusters per 100 m, so a fully labeled street of ordinary length saturates (#5093).
  //
  // KNOWN LIMITATION: a raw cluster count is a proxy for coverage, and NoSidewalk clusters at 10 m, so how easily a
  // street saturates scales with its length. Measured on the Teaneck snapshot, only 35% of NoSidewalk streets under
  // 50 m reach three clusters, against 69-78% of longer ones — so a short street with no sidewalk at all is capped
  // near extent 2/3 and scores above an identically-conditioned long street. Pooling removes the density bias above
  // saturation but not below it. Fixing it properly means a length-aware denominator, which this object cannot do
  // without being handed the street's length (AccessScoreService has it); until then the bias is on short streets. ---
  val streetConditionSaturationCount: Int = 3

  // --- TUNABLE: additive weight adjustments for impactful tags. (labelType, tag) -> delta; unlisted tags contribute 0.
  // Sign is absolute (added directly to the type's contribution), independent of the base weight's sign. ---
  val tagAdjustments: Map[(String, String), Double] = Map(
    (LabelTypeEnum.Signal.name, "hard to reach buttons")       -> -0.25,
    (LabelTypeEnum.Signal.name, "button waist height")         -> +0.15,
    (LabelTypeEnum.Signal.name, "APS")                         -> +0.25,
    (LabelTypeEnum.CurbRamp.name, "steep")                     -> -0.25,
    (LabelTypeEnum.CurbRamp.name, "narrow")                    -> -0.25,
    (LabelTypeEnum.CurbRamp.name, "missing tactile warning")   -> -0.25,
    (LabelTypeEnum.CurbRamp.name, "points into traffic")       -> -0.25,
    (LabelTypeEnum.Crosswalk.name, "level with sidewalk")      -> +0.25,
    (LabelTypeEnum.Crosswalk.name, "paint fading")             -> -0.25,
    (LabelTypeEnum.Crosswalk.name, "no pedestrian priority")   -> -0.25,
    (LabelTypeEnum.NoCurbRamp.name, "no alternate route")      -> -0.50,
    (LabelTypeEnum.NoCurbRamp.name, "alternate route present") -> +0.25,
    // NoSidewalk tags are pooled per street (#5093). "street has no sidewalks" and "street has a sidewalk" (the other
    // side has one) are mutually exclusive, so at most one is active unless the street's labels split exactly in half.
    // "ends abruptly" aggravates: a pedestrian on the sidewalk is stranded in the roadway where it stops.
    (LabelTypeEnum.NoSidewalk.name, "ends abruptly")               -> -1.00,
    (LabelTypeEnum.NoSidewalk.name, "street has no sidewalks")     -> -1.00,
    (LabelTypeEnum.NoSidewalk.name, "street has a sidewalk")       -> +1.00,
    (LabelTypeEnum.NoSidewalk.name, "gravel/dirt road")            -> -0.25,
    (LabelTypeEnum.NoSidewalk.name, "shared pedestrian/car space") -> +0.25,
    (LabelTypeEnum.NoSidewalk.name, "covered walkway")             -> +0.50,
    (LabelTypeEnum.NoSidewalk.name, "pedestrian lane marking")     -> +0.50
  )

  // --- TUNABLE: StreetCondition tags that describe a point on the street rather than the whole stretch. A pooled
  // majority would only ever notice them on short streets (a sidewalk ends in one place, and labelers tag that one
  // pin), so they are active when any single cluster carries them at the active threshold (#5093). ---
  val streetConditionPointTags: Set[(String, String)] = Set((LabelTypeEnum.NoSidewalk.name, "ends abruptly"))

  // --- TUNABLE: a tag counts toward scoring when it appears on at least this fraction of the labels it is judged over
  // (a cluster's members, or a street's pooled members for a StreetCondition type). ---
  val tagActiveThreshold: Double = 0.5

  // --- TUNABLE: named weight vectors for the AccessScore tool's lenses. Each is a magnitude per scored type; the
  // type's sign is fixed by its base weight. "default" is the engine's own weights, so the tool can reset to exactly
  // what the API serves. The others are described by what they change, not by who they are for: a weighting that
  // claims to stand for a disability community needs that community's involvement and literature behind it, and
  // none of these has either yet. Every value is published, so a lens hides nothing. ---
  val presetOrder: Seq[String] = Seq("default", "barriers", "infrastructure", "missing_ramps")

  val presets: Map[String, Map[String, Double]] = {
    val default: Map[String, Double] = baseWeights.map { case (t, w) => t -> math.abs(w) }
    val problems: Set[String]        = baseWeights.collect { case (t, w) if w < 0 => t }.toSet
    Map(
      "default" -> default,
      // Problems weigh half again as much; features are unchanged.
      "barriers" -> default.map { case (t, w) => t -> (if (problems.contains(t)) w * 1.5 else w) },
      // Features weigh half again as much; problems are unchanged.
      "infrastructure" -> default.map { case (t, w) => t -> (if (problems.contains(t)) w else w * 1.5) },
      // The one problem a curb-ramp program can fix, doubled, with the ramps themselves credited more too.
      "missing_ramps" -> (default ++ Map(LabelTypeEnum.NoCurbRamp.name -> 2.0, LabelTypeEnum.CurbRamp.name -> 1.0))
    )
  }

  /**
   * The per-cluster inputs the calculator needs. Severity is the cluster's median member severity (None if unrated).
   *
   * @param labelType  The cluster's label type name (e.g. "CurbRamp").
   * @param severity   Median severity 1..3 of the cluster's labels, or None for presence-only/unrated clusters.
   * @param labelCount Number of member labels (the denominator for the tag-active threshold).
   * @param tagCounts  Map of tag name → how many member labels carry that tag.
   */
  case class ClusterScoreInput(
      labelType: String,
      severity: Option[Int],
      labelCount: Int,
      tagCounts: Map[String, Int]
  )

  /**
   * Computes a single cluster's signed contribution to its street's pre-sigmoid sum.
   *
   * Scope this narrowly: [[scoreByType]] is the entry point for scoring a street, and summing this over a street's
   * clusters is only correct for the per-cluster scoring modes. For a [[StreetCondition]] type this returns the term
   * the cluster would earn as the only one of its type on the street (extent `1 / streetConditionSaturationCount`),
   * so summing it over `n` such clusters yields `n` times a fraction of the base weight instead of the pooled term —
   * the label-density artifact the pooling exists to remove.
   *
   * @param c The cluster inputs.
   * @return  The contribution, or 0.0 if the cluster's label type is not scored (e.g. Occlusion/Other).
   */
  private[service] def scoreCluster(c: ClusterScoreInput): Double = {
    typeWeights.get(c.labelType) match {
      case None                               => 0.0 // Not a scored type.
      case Some(TypeWeight(base, scoring, _)) =>
        scoring match {
          case PresenceOnly    => base + activeTagAdjustment(c)
          case PositiveQuality =>
            base * c.severity.flatMap(qualityMultiplier.get).getOrElse(qualityNullMultiplier) + activeTagAdjustment(c)
          case NegativeSeverity =>
            base * c.severity.flatMap(severityMultiplier.get).getOrElse(severityNullMultiplier) + activeTagAdjustment(c)
          case StreetCondition => streetConditionTerm(base, Seq(c))
        }
    }
  }

  /**
   * Computes each scored label type's contribution to a unit's pre-sigmoid sum.
   *
   * Per-cluster types contribute the sum of their clusters' [[scoreCluster]] values; a [[StreetCondition]] type
   * contributes one pooled term for all of its clusters on the street. On a segment (a length is given) a
   * [[TypeWeight.lengthNormalized]] type's term is then scaled by [[lengthFactor]]; on an intersection (no length)
   * nothing is scaled. This is the one path both the unit's score and the API's `sub_scores` breakdown go through, so
   * the breakdown always sums to the score's logit.
   *
   * @param clusters     The unit's clusters (any label type; unscored types are dropped). For a segment that is its
   *                     along-length clusters plus any corner-type clusters not attributed to an intersection.
   * @param lengthMeters The segment's length, or None for an intersection.
   * @return             Contribution keyed by label-type name, present only for scored types with at least one cluster.
   */
  def scoreByType(clusters: Seq[ClusterScoreInput], lengthMeters: Option[Double] = None): Map[String, Double] = {
    clusters.groupBy(_.labelType).flatMap { case (labelType, typeClusters) =>
      typeWeights.get(labelType).map { case TypeWeight(base, scoring, _) =>
        val term: Double = scoring match {
          case StreetCondition => streetConditionTerm(base, typeClusters)
          case _               => typeClusters.iterator.map(scoreCluster).sum
        }
        labelType -> term * termFactor(labelType, lengthMeters)
      }
    }
  }

  /**
   * The API's name for a scoring mode, so a client can pick the right multiplier table without knowing the Scala type.
   *
   * @param scoring The scoring mode.
   * @return        Its snake_case name.
   */
  def scoringName(scoring: Scoring): String = scoring match {
    case PresenceOnly     => "presence_only"
    case PositiveQuality  => "positive_quality"
    case NegativeSeverity => "negative_severity"
    case StreetCondition  => "street_condition"
  }

  /**
   * The rating bucket a cluster's median severity falls into.
   *
   * @param severity The cluster's median severity.
   * @return         "1", "2", or "3", or the null bucket for an unrated cluster or a rating outside the multiplier
   *                 tables' domain (which the per-cluster path also treats as unrated).
   */
  def severityBucket(severity: Option[Int]): String =
    severity.filter(s => s >= 1 && s <= 3).map(_.toString).getOrElse(nullSeverityBucket)

  /**
   * The factor a single cluster in `bucket` multiplies its type's base weight by.
   *
   * @param scoring The type's scoring mode.
   * @param bucket  One of [[severityBuckets]].
   * @return        The multiplier; 1.0 for the modes that ignore ratings (a [[StreetCondition]] type's extent factor is
   *                a function of the cluster count, not of any one cluster, and is applied by [[subScoresFromCounts]]).
   */
  def ratingMultiplier(scoring: Scoring, bucket: String): Double = scoring match {
    case PositiveQuality                => qualityMultiplierByBucket.getOrElse(bucket, qualityNullMultiplier)
    case NegativeSeverity               => severityMultiplierByBucket.getOrElse(bucket, severityNullMultiplier)
    case PresenceOnly | StreetCondition => 1.0
  }

  /**
   * Turns a preset's weight magnitudes into the signed base weights [[subScoresFromCounts]] takes, each type keeping
   * the sign of its engine base weight (a problem type stays a penalty however heavily it is weighted).
   *
   * @param magnitudes Weight magnitude per scored type, e.g. one of [[presets]].
   * @return           Signed base weight per type present in `magnitudes`.
   */
  def signedWeights(magnitudes: Map[String, Double]): Map[String, Double] =
    magnitudes.map { case (t, m) => t -> math.signum(baseWeights.getOrElse(t, 1.0)) * math.abs(m) }

  /**
   * Counts a street's clusters per scored type and rating bucket: the rating-dependent half of the inputs that let
   * [[subScoresFromCounts]] rebuild the street's score under any weights.
   *
   * @param clusters The street's clusters (any label type; unscored types are dropped).
   * @return         `labelType → bucket → count`, present only for scored types with at least one cluster; a bucket
   *                 with no clusters is absent rather than zero.
   */
  def severityCountsByType(clusters: Seq[ClusterScoreInput]): Map[String, Map[String, Int]] =
    clusters
      .filter(c => scoredTypeNames.contains(c.labelType))
      .groupBy(_.labelType)
      .map { case (labelType, typeClusters) =>
        labelType -> typeClusters.groupBy(c => severityBucket(c.severity)).map { case (b, cs) => b -> cs.size }
      }

  /**
   * Each scored type's summed tag adjustment on a street — judged per cluster for the per-cluster modes and over the
   * pooled labels for a [[StreetCondition]] type — i.e. the part of the type's term that no weight scales.
   *
   * @param clusters The street's clusters (any label type; unscored types are dropped).
   * @return         `labelType → adjustment`, present only for scored types with at least one cluster.
   */
  def tagAdjustmentsByType(clusters: Seq[ClusterScoreInput]): Map[String, Double] =
    clusters.groupBy(_.labelType).flatMap { case (labelType, typeClusters) =>
      typeWeights.get(labelType).map { tw =>
        val adjustment: Double = tw.scoring match {
          case StreetCondition => pooledTagAdjustment(typeClusters)
          case _               => typeClusters.iterator.map(activeTagAdjustment).sum
        }
        labelType -> adjustment
      }
    }

  /**
   * Rebuilds each scored type's contribution from the counts alone, so the score can be recomputed under different
   * weights without the clusters — the path the AccessScore tool's client-side reweighting mirrors.
   *
   * With the engine's own `baseWeights` this equals [[scoreByType]] on the clusters the counts came from: for a
   * per-cluster type `base × Σ_bucket count × ratingMultiplier + tagAdjustment`, for a [[StreetCondition]] type
   * `base × min(1, n / streetConditionSaturationCount) + tagAdjustment`, and on a segment a length-normalized type's
   * whole term is then multiplied by [[lengthFactor]] — the published `tag_adjustments` are the unscaled sums.
   *
   * @param severityCounts Per type, the cluster count per rating bucket (see [[severityCountsByType]]).
   * @param tagAdjustments Per type, the summed active tag adjustment (see [[tagAdjustmentsByType]]).
   * @param baseWeights    Signed base weight per type; a type missing here contributes nothing.
   * @param lengthMeters   The segment's length, or None for an intersection (nothing is length-scaled).
   * @return               Contribution keyed by label-type name, present only for types with at least one cluster.
   */
  def subScoresFromCounts(
      severityCounts: Map[String, Map[String, Int]],
      tagAdjustments: Map[String, Double],
      baseWeights: Map[String, Double] = baseWeights,
      lengthMeters: Option[Double] = None
  ): Map[String, Double] =
    severityCounts.flatMap { case (labelType, countsByBucket) =>
      val clusterCount: Int = countsByBucket.valuesIterator.sum
      typeWeights.get(labelType).filter(_ => clusterCount > 0).map { tw =>
        val base: Double     = baseWeights.getOrElse(labelType, 0.0)
        val weighted: Double = tw.scoring match {
          case StreetCondition => base * math.min(1.0, clusterCount.toDouble / streetConditionSaturationCount)
          case scoring         =>
            base * countsByBucket.iterator.map { case (b, n) => n * ratingMultiplier(scoring, b) }.sum
        }
        labelType -> (weighted + tagAdjustments.getOrElse(labelType, 0.0)) * termFactor(labelType, lengthMeters)
      }
    }

  /**
   * The pooled term for a [[StreetCondition]] type: the base weight scaled by how much of the street the clusters
   * cover, plus the adjustments for tags active across the street's pooled labels.
   *
   * @param base     The type's signed base weight.
   * @param clusters The street's clusters of this one type (non-empty; all the same label type).
   * @return         The signed contribution.
   */
  private def streetConditionTerm(base: Double, clusters: Seq[ClusterScoreInput]): Double = {
    val extent: Double = math.min(1.0, clusters.size.toDouble / streetConditionSaturationCount)
    base * extent + pooledTagAdjustment(clusters)
  }

  /**
   * Sums the adjustments for tags active across a street's clusters of one [[StreetCondition]] type: a street-wide tag
   * must cover [[tagActiveThreshold]] of the pooled labels; a [[streetConditionPointTags]] tag needs only one cluster
   * that carries it at the threshold.
   *
   * @param clusters The street's clusters of this one type (non-empty; all the same label type).
   * @return         The summed tag adjustment.
   */
  private def pooledTagAdjustment(clusters: Seq[ClusterScoreInput]): Double = {
    val labelType: String                 = clusters.head.labelType
    val pooledLabelCount: Int             = clusters.iterator.map(_.labelCount).sum
    val pooledTagCounts: Map[String, Int] =
      clusters.iterator.flatMap(_.tagCounts).toSeq.groupMapReduce(_._1)(_._2)(_ + _)

    tagAdjustments.iterator.collect {
      case ((lt, tag), delta) if lt == labelType =>
        val active: Boolean =
          if (streetConditionPointTags.contains((lt, tag)))
            clusters.exists(c => tagActive(c.tagCounts.getOrElse(tag, 0), c.labelCount))
          else tagActive(pooledTagCounts.getOrElse(tag, 0), pooledLabelCount)
        if (active) delta else 0.0
    }.sum
  }

  /**
   * Sums the adjustments for tags that are "active" on this cluster (present on >= [[tagActiveThreshold]] of its labels).
   *
   * @param c The cluster inputs.
   * @return  The summed tag adjustment (0.0 when the cluster has no labels or no active, mapped tags).
   */
  private def activeTagAdjustment(c: ClusterScoreInput): Double = {
    c.tagCounts.iterator.collect {
      case (tag, count) if tagActive(count, c.labelCount) && tagAdjustments.contains((c.labelType, tag)) =>
        tagAdjustments((c.labelType, tag))
    }.sum
  }

  /** Whether a tag carried by `count` of `labelCount` labels clears [[tagActiveThreshold]] (never with zero labels). */
  private def tagActive(count: Int, labelCount: Int): Boolean =
    labelCount > 0 && count.toDouble / labelCount >= tagActiveThreshold

  /** The logistic squashing function mapping the unbounded weighted sum to (0, 1). */
  private def sigmoid(t: Double): Double = 1.0 / (1.0 + math.exp(-t))

  /**
   * Squashes a street's per-type contributions (from [[scoreByType]]) into its access score.
   *
   * @param subScores Contribution per scored label type.
   * @return          The access score in (0, 1); an empty map yields the neutral 0.5.
   */
  def scoreFromSubScores(subScores: Map[String, Double]): Double = sigmoid(subScores.valuesIterator.sum)

  /**
   * Computes a unit's access score: the sigmoid of the summed per-type contributions — a saturating "how accessible is
   * this" signal in (0, 1). With a length this is a street segment's score; without one an intersection's.
   *
   * @param clusters     The unit's scored clusters (empty yields the neutral 0.5).
   * @param lengthMeters The segment's length, or None for an intersection.
   * @return             The access score in (0, 1).
   */
  def scoreStreet(clusters: Seq[ClusterScoreInput], lengthMeters: Option[Double] = None): Double =
    scoreFromSubScores(scoreByType(clusters, lengthMeters))

  /**
   * A street's headline score: the plain mean of its segment score and the scores of the intersections at its two
   * ends, over whichever of the three exist (#5095). An end with no intersection (a dead end, a way split at a region
   * boundary) or a grade-separated one simply contributes nothing, and a street whose ends are unscored keeps its
   * segment score; the components are all reported beside the headline so a consumer can recombine them.
   *
   * @param segmentScore The segment's score, or None when the street is unaudited.
   * @param endScores    The scores of the street's end intersections that have one.
   * @return             The mean, or None when there is nothing to average.
   */
  def headlineScore(segmentScore: Option[Double], endScores: Seq[Double]): Option[Double] = {
    val components: Seq[Double] = segmentScore.toSeq ++ endScores
    if (components.isEmpty) None else Some(components.sum / components.size)
  }

  /**
   * Computes a region's intersection score as the plain mean of its scored intersections (#5095). Unweighted, since
   * an intersection has no length: every crossing counts once.
   *
   * @param intersectionScores The scores of the region's scored intersections.
   * @return                   The mean, or None when the region has no scored intersection.
   */
  def scoreRegionIntersections(intersectionScores: Seq[Double]): Option[Double] =
    if (intersectionScores.isEmpty) None else Some(intersectionScores.sum / intersectionScores.size)

  /**
   * Computes a region's access score as the street-length-weighted mean of its audited streets' scores.
   *
   * @param auditedStreets (streetScore, lengthMeters) pairs for streets in the region with >= 1 completed audit.
   * @return               The weighted-mean score, or None when there are no audited streets / zero total length.
   */
  def scoreRegion(auditedStreets: Seq[(Double, Double)]): Option[Double] = {
    val totalLength: Double = auditedStreets.iterator.map(_._2).sum
    if (totalLength <= 0.0) None
    else Some(auditedStreets.iterator.map { case (score, length) => score * length }.sum / totalLength)
  }
}
