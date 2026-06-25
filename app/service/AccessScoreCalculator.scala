package service

import models.label.LabelTypeEnum

/**
 * Pure, DB-free scoring engine for the v3 AccessScore API (#3855).
 *
 * Implements the severity/quality- and tag-aware extension of Chu Li's Urban Access 2022 AccessScore. All weighting
 * lives here as tunable constants so the math can be unit-tested in isolation and adjusted without touching the DB layer
 * ([[AccessScoreService]]) or the controller. Nothing in this object performs IO.
 *
 * The model, per label type:
 *   - A street's pre-sigmoid sum is the sum of each cluster's `contribution = base(type) * multiplier + tagAdjustments`.
 *   - The street score is `sigmoid(sum)`, mapped to (0, 1).
 *   - A region's score is the street-length-weighted mean of its audited streets' scores (the paper's normalization).
 *
 * Severity semantics differ by type and are the crux of the model (the same DB `severity` column means different things):
 *   - Positive **quality**-rated types (CurbRamp, Crosswalk): Good(1) / Okay(2) / Bad(3). A Bad one flips negative.
 *   - Negative **severity**-rated types (NoCurbRamp, Obstacle, SurfaceProblem): Low(1) / Med(2) / High(3).
 *   - **Presence-only** types (Signal, NoSidewalk): no severity; a fixed weight for mere presence.
 */
object AccessScoreCalculator {

  /** How a label type's severity column is interpreted when scoring. */
  sealed trait Scoring

  /** Severity ignored; presence alone contributes `baseWeight` (e.g. Signal, NoSidewalk). */
  case object PresenceOnly extends Scoring

  /** Quality-rated positive feature: severity 1=Good, 2=Okay, 3=Bad (a Bad one contributes negatively). */
  case object PositiveQuality extends Scoring

  /** Severity-rated negative feature: severity 1=Low, 2=Med, 3=High (magnitude grows with severity). */
  case object NegativeSeverity extends Scoring

  /**
   * Per-type scoring configuration.
   *
   * @param baseWeight Signed base weight (positive features positive, negative features negative). The severity/quality
   *                   multiplier scales this; for `PositiveQuality` the multiplier may flip the sign (Bad → negative).
   * @param scoring    How this type's severity column is interpreted.
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
    LabelTypeEnum.NoSidewalk.name     -> TypeWeight(-1.00, PresenceOnly)
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

  // --- TUNABLE: additive weight adjustments for impactful tags. (labelType, tag) -> delta; unlisted tags contribute 0.
  // Sign is absolute (added directly to the cluster's contribution), independent of the base weight's sign. ---
  val tagAdjustments: Map[(String, String), Double] = Map(
    (LabelTypeEnum.Signal.name, "hard to reach buttons")    -> -0.25,
    (LabelTypeEnum.Signal.name, "button waist height")      -> +0.15,
    (LabelTypeEnum.Signal.name, "APS")                      -> +0.25,
    (LabelTypeEnum.CurbRamp.name, "steep")                  -> -0.25,
    (LabelTypeEnum.CurbRamp.name, "narrow")                 -> -0.25,
    (LabelTypeEnum.CurbRamp.name, "missing tactile warning")-> -0.25,
    (LabelTypeEnum.CurbRamp.name, "points into traffic")    -> -0.25,
    (LabelTypeEnum.Crosswalk.name, "level with sidewalk")   -> +0.25,
    (LabelTypeEnum.Crosswalk.name, "paint fading")          -> -0.25,
    (LabelTypeEnum.Crosswalk.name, "no pedestrian priority")-> -0.25,
    (LabelTypeEnum.NoCurbRamp.name, "no alternate route")   -> -0.50,
    (LabelTypeEnum.NoCurbRamp.name, "alternate route present") -> +0.25
  )

  // --- TUNABLE: a tag counts toward scoring when it appears on at least this fraction of a cluster's member labels. ---
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
   * @param c The cluster inputs.
   * @return  The contribution, or 0.0 if the cluster's label type is not scored (e.g. Occlusion/Other/Problem).
   */
  def scoreCluster(c: ClusterScoreInput): Double = {
    typeWeights.get(c.labelType) match {
      case None => 0.0 // Not a scored type.
      case Some(TypeWeight(base, scoring)) =>
        val typeContribution: Double = scoring match {
          case PresenceOnly     => base
          case PositiveQuality  => base * c.severity.flatMap(qualityMultiplier.get).getOrElse(qualityNullMultiplier)
          case NegativeSeverity => base * c.severity.flatMap(severityMultiplier.get).getOrElse(severityNullMultiplier)
        }
        typeContribution + activeTagAdjustment(c)
    }
  }

  /**
   * Sums the adjustments for tags that are "active" on this cluster (present on >= [[tagActiveThreshold]] of its labels).
   *
   * @param c The cluster inputs.
   * @return  The summed tag adjustment (0.0 when the cluster has no labels or no active, mapped tags).
   */
  private def activeTagAdjustment(c: ClusterScoreInput): Double = {
    if (c.labelCount <= 0) 0.0
    else
      c.tagCounts.iterator.collect {
        case (tag, count)
            if count.toDouble / c.labelCount >= tagActiveThreshold && tagAdjustments.contains((c.labelType, tag)) =>
          tagAdjustments((c.labelType, tag))
      }.sum
  }

  /** The logistic squashing function mapping the unbounded weighted sum to (0, 1). */
  private def sigmoid(t: Double): Double = 1.0 / (1.0 + math.exp(-t))

  /**
   * Computes a street's access score: the sigmoid of the summed cluster contributions. No length normalization at the
   * street level (faithful to the paper) — this is a saturating "how accessible is this street" signal in (0, 1).
   *
   * @param clusters The street's scored clusters (empty yields the neutral 0.5).
   * @return         The access score in (0, 1).
   */
  def scoreStreet(clusters: Seq[ClusterScoreInput]): Double = sigmoid(clusters.iterator.map(scoreCluster).sum)

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
