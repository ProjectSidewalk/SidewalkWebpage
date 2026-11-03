package service

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}

/**
 * A reader's own weights for the AccessScore model: a magnitude per scored label type, and how heavily street grade
 * counts. Each type keeps its engine sign, so a problem type stays a penalty however it is weighted.
 *
 * Written in links the way the AccessScore tool writes them, so a report link and a tool link carry one format:
 * `w=CurbRamp:1,NoCurbRamp:2.5` and `gs=w:0.5`.
 *
 * @param magnitudes  Weight magnitude per scored type, each type present.
 * @param slopeWeight How much grade counts; the rest of the grade settings stay the engine's.
 */
case class AccessScoreWeights(magnitudes: Map[String, Double], slopeWeight: Double) {

  /** @return Signed base weight per type, the form the calculator takes. */
  def signed: Map[String, Double] = AccessScoreCalculator.signedWeights(magnitudes)

  /** @return The engine's slope settings, at this weight. */
  def slopeSettings: AccessScoreCalculator.SlopeSettings =
    AccessScoreCalculator.defaultSlopeSettings.copy(weight = slopeWeight)

  /** @return Whether these are exactly the engine's own, so the published scores already answer them. */
  def isDefault: Boolean = this == AccessScoreWeights.Default
}

object AccessScoreWeights {
  private val Tolerance: Double = 1e-9

  val Default: AccessScoreWeights = AccessScoreWeights(
    AccessScoreCalculator.presets("default"),
    AccessScoreCalculator.defaultSlopeSettings.weight
  )

  /**
   * The highest magnitude a type may take: the AccessScore tool's slider ceiling, 3 or the next whole number above the
   * engine's largest default. Held to it so a hand-edited link can't push a score past what the tool could show.
   */
  val TypeWeightMax: Double = math.max(3.0, math.ceil(Default.magnitudes.values.max) + 1)

  /**
   * Reads the two link parameters. A token naming an unscored type, or a value that isn't a number, is dropped and its
   * weight stays the engine's, so a stale link degrades token by token rather than failing.
   *
   * @param w  The `w` parameter: `Type:magnitude` tokens joined by commas.
   * @param gs The `gs` parameter; only its `w:` (grade weight) token is read here.
   * @return The weights, the engine's own where the link says nothing.
   */
  def fromParams(w: Option[String], gs: Option[String]): AccessScoreWeights = {
    def tokens(raw: Option[String]): Seq[(String, Double)] =
      raw.toSeq.flatMap(_.split(',')).flatMap { token =>
        token.split(':') match {
          case Array(key, value) => value.trim.toDoubleOption.filter(v => v >= 0 && !v.isInfinite).map(key.trim -> _)
          case _                 => None
        }
      }
    val asked = tokens(w).collect {
      case (t, v) if AccessScoreCalculator.scoredTypeNames(t) => t -> math.min(v, TypeWeightMax)
    }.toMap
    val slope = tokens(gs).collectFirst { case ("w", v) => math.min(v, AccessScoreCalculator.slopeWeightMax) }
    snap(AccessScoreWeights(Default.magnitudes ++ asked, slope.getOrElse(Default.slopeWeight)))
  }

  /** A value a hair off a default (a rounded link) reads as the default, so a round trip can't stamp a report custom. */
  private def snap(weights: AccessScoreWeights): AccessScoreWeights = {
    def near(a: Double, b: Double) = math.abs(a - b) < Tolerance
    AccessScoreWeights(
      weights.magnitudes.map { case (t, v) => t -> (if (near(v, Default.magnitudes(t))) Default.magnitudes(t) else v) },
      if (near(weights.slopeWeight, Default.slopeWeight)) Default.slopeWeight else weights.slopeWeight
    )
  }

  /**
   * Re-scores published AccessScores under other weights, from the per-type counts each row already carries, so it
   * costs no database read: the path the AccessScore tool's own client-side reweighting takes, run on the server.
   *
   * @param scores  The engine's published scores.
   * @param weights The weights to apply.
   * @return Every street and intersection with its sub-scores, slope term and scores rebuilt; the rest unchanged.
   */
  def reweight(scores: AccessScores, weights: AccessScoreWeights): AccessScores =
    if (weights.isDefault) scores
    else {
      val signed        = weights.signed
      val intersections = scores.intersections.map(i => reweightIntersection(i, signed))
      val byId          = intersections.map(i => i.intersectionId -> i.score).toMap
      AccessScores(scores.streets.map(s => reweightStreet(s, signed, weights.slopeSettings, byId)), intersections)
    }

  private def reweightIntersection(
      i: IntersectionAccessScoreForApi,
      signed: Map[String, Double]
  ): IntersectionAccessScoreForApi = {
    val subScores = AccessScoreCalculator.subScoresFromCounts(i.severityCounts, i.tagAdjustments, signed, None)
    i.copy(subScores = subScores, score = i.score.map(_ => AccessScoreCalculator.scoreFromSubScores(subScores)))
  }

  private def reweightStreet(
      s: StreetAccessScoreForApi,
      signed: Map[String, Double],
      slopeSettings: AccessScoreCalculator.SlopeSettings,
      intersectionScores: Map[Int, Option[Double]]
  ): StreetAccessScoreForApi = {
    val subScores =
      AccessScoreCalculator.subScoresFromCounts(s.severityCounts, s.tagAdjustments, signed, Some(s.lengthMeters))
    val slope        = s.gradient.map(AccessScoreService.slopeInput)
    val segmentScore = s.segmentScore.map { _ =>
      AccessScoreCalculator.segmentScoreWithSlope(subScores, slope, s.lengthMeters, slopeSettings)
    }
    def end(id: Option[Int]): Option[Double] = id.flatMap(intersectionScores.get).flatten
    val (startScore, endScore)               = (end(s.startIntersectionId), end(s.endIntersectionId))
    s.copy(
      subScores = subScores,
      slopeTerm = AccessScoreCalculator.slopeTerm(slope, s.lengthMeters, slopeSettings),
      segmentScore = segmentScore,
      startIntersectionScore = startScore,
      endIntersectionScore = endScore,
      score = AccessScoreCalculator.headlineScore(segmentScore, Seq(startScore, endScore).flatten)
    )
  }
}
