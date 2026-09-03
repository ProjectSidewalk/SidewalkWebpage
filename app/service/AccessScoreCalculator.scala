package service

import models.label.LabelTypeEnum

/**
 * Pure, DB-free scoring engine for the v3 AccessScore API (#3855).
 *
 * Implements the severity/quality- and tag-aware extension of Chu Li's Urban Access 2022 AccessScore. All weighting
 * lives here as tunable constants so the math can be unit-tested in isolation and adjusted without touching the DB layer
 * ([[AccessScoreService]]) or the controller. Nothing in this object performs IO.
 *
 * The model:
 *   - A street's pre-sigmoid sum is the sum of one term per scored label type ([[scoreByType]]).
 *   - For per-cluster types that term is the sum of each cluster's
 *     `contribution = base(type) * multiplier + tagAdjustments` ([[scoreCluster]]).
 *   - For a street-condition type (NoSidewalk, #5093) the street's clusters pool into a single term,
 *     `base(type) * extent(n) + pooledTagAdjustments`, so the penalty reflects the street's condition rather than how
 *     many pins a labeler dropped along it.
 *   - The street score is `sigmoid(sum)`, mapped to (0, 1).
 *   - A region's score is the street-length-weighted mean of its audited streets' scores (the paper's normalization).
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
   * @param baseWeight Signed base weight (positive features positive, negative features negative). The severity/quality
   *                   multiplier scales this; for `PositiveQuality` the multiplier may flip the sign (Bad → negative).
   * @param scoring    How this type's clusters are scored.
   */
  case class TypeWeight(baseWeight: Double, scoring: Scoring)

  // --- TUNABLE: base weight + scoring mode per scored label type. Types absent here are excluded from scoring. ---
  val typeWeights: Map[String, TypeWeight] = Map(
    LabelTypeEnum.CurbRamp.name       -> TypeWeight(+0.75, PositiveQuality),
    LabelTypeEnum.Crosswalk.name      -> TypeWeight(+0.75, PositiveQuality),
    LabelTypeEnum.Signal.name         -> TypeWeight(+0.50, PresenceOnly),
    LabelTypeEnum.NoCurbRamp.name     -> TypeWeight(-1.00, NegativeSeverity),
    LabelTypeEnum.Obstacle.name       -> TypeWeight(-1.00, NegativeSeverity),
    LabelTypeEnum.SurfaceProblem.name -> TypeWeight(-1.00, NegativeSeverity),
    // A whole street without a sidewalk sits at sigmoid(-2) ≈ 0.12 before its tags and other features (#5093).
    LabelTypeEnum.NoSidewalk.name -> TypeWeight(-2.00, StreetCondition)
  )

  /** Names of the label types that contribute to the score. Single source of truth for the DB query's type filter. */
  val scoredTypeNames: Set[String] = typeWeights.keySet

  /** Scored types in a stable order (by label-type id) so CSV/shapefile columns never drift from the header. */
  val orderedScoredTypes: Seq[String] = scoredTypeNames.toSeq.sortBy(LabelTypeEnum.labelTypeToId)

  // --- TUNABLE: quality multiplier for PositiveQuality types. Signed: Bad(3) flips a positive base to a penalty. ---
  private val qualityMultiplier: Map[Int, Double] = Map(1 -> 1.0, 2 -> 0.5, 3 -> -1.0)
  // Null quality on a positive type → treat as Okay (credit an unknown weakly but still positively).
  private val qualityNullMultiplier: Double = qualityMultiplier(2)

  // --- TUNABLE: severity magnitude for NegativeSeverity types (unsigned; the negative base carries the sign). ---
  private val severityMultiplier: Map[Int, Double] = Map(1 -> 0.33, 2 -> 0.67, 3 -> 1.0)
  // Null severity on a negative type → treat as Low (penalize an unknown conservatively). Highest-impact tuning knob:
  // v2 effectively used magnitude 1.0 for every negative cluster, so scores shift relative to v2 by design (#3855).
  private val severityNullMultiplier: Double = severityMultiplier(1)

  // --- TUNABLE: cluster count at which a StreetCondition type's extent factor reaches 1. One stray pin counts 1/n
  // of the base weight; n or more clusters count the full base, however many more there are. Labelers place
  // NoSidewalk at a median of ~5 clusters per 100 m, so a fully labeled street of ordinary length saturates (#5093). ---
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
   * For a [[StreetCondition]] type this is the term the cluster would earn as the only one of its type on the street
   * (extent `1 / streetConditionSaturationCount`); several such clusters on one street do not sum, they pool — see
   * [[scoreByType]].
   *
   * @param c The cluster inputs.
   * @return  The contribution, or 0.0 if the cluster's label type is not scored (e.g. Occlusion/Other).
   */
  def scoreCluster(c: ClusterScoreInput): Double = {
    typeWeights.get(c.labelType) match {
      case None                            => 0.0 // Not a scored type.
      case Some(TypeWeight(base, scoring)) =>
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
   * Computes each scored label type's contribution to a street's pre-sigmoid sum.
   *
   * Per-cluster types contribute the sum of their clusters' [[scoreCluster]] values; a [[StreetCondition]] type
   * contributes one pooled term for all of its clusters on the street. This is the one path both the street score and
   * the API's `sub_scores` breakdown go through, so the breakdown always sums to the score's logit.
   *
   * @param clusters The street's clusters (any label type; unscored types are dropped).
   * @return         Contribution keyed by label-type name, present only for scored types with at least one cluster.
   */
  def scoreByType(clusters: Seq[ClusterScoreInput]): Map[String, Double] = {
    clusters.groupBy(_.labelType).flatMap { case (labelType, typeClusters) =>
      typeWeights.get(labelType).map { case TypeWeight(base, scoring) =>
        val term: Double = scoring match {
          case StreetCondition => streetConditionTerm(base, typeClusters)
          case _               => typeClusters.iterator.map(scoreCluster).sum
        }
        labelType -> term
      }
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
   * Computes a street's access score: the sigmoid of the summed per-type contributions. No length normalization at the
   * street level (faithful to the paper) — this is a saturating "how accessible is this street" signal in (0, 1).
   *
   * @param clusters The street's scored clusters (empty yields the neutral 0.5).
   * @return         The access score in (0, 1).
   */
  def scoreStreet(clusters: Seq[ClusterScoreInput]): Double = scoreFromSubScores(scoreByType(clusters))

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
