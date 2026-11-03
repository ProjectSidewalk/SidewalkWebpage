package service

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}

/**
 * A reader's own settings for the AccessScore model: a magnitude per scored label type, and the slope settings. Each
 * type keeps its engine sign, so a problem type stays a penalty however it is weighted.
 *
 * Written in links the way the AccessScore tool writes them, so a report link and a tool link carry one format:
 * `w=CurbRamp:1,NoCurbRamp:2.5` and `gs=w:0.5,s:mean_grade,lo:0.05,hi:0.08333,b:0.125,ap:1` (see AccessScoreUrlSync.js).
 *
 * @param magnitudes Weight magnitude per scored type, each type present.
 * @param slope      How grade counts.
 */
case class AccessScoreWeights(magnitudes: Map[String, Double], slope: AccessScoreCalculator.SlopeSettings) {

  /** @return Signed base weight per type, the form the calculator takes. */
  def signed: Map[String, Double] = AccessScoreCalculator.signedWeights(magnitudes)

  def slopeWeight: Double = slope.weight

  /** @return Whether these are exactly the engine's own, so the published scores already answer them. */
  def isDefault: Boolean = this == AccessScoreWeights.Default

  /**
   * @return The `gs` link value: only the tokens that differ from the engine's, as the tool writes it, so a link from
   *         the report opens the tool on the same settings. Empty for the engine's own.
   */
  def slopeParam: String = {
    val d                = AccessScoreCalculator.defaultSlopeSettings
    def grade(v: Double) =
      BigDecimal(v).setScale(5, BigDecimal.RoundingMode.HALF_UP).bigDecimal.stripTrailingZeros.toPlainString
    def weight(v: Double) =
      BigDecimal(v).setScale(3, BigDecimal.RoundingMode.HALF_UP).bigDecimal.stripTrailingZeros.toPlainString
    Seq(
      Option.when(slope.weight != d.weight)(s"w:${weight(slope.weight)}"),
      Option.when(slope.statistic != d.statistic)(s"s:${AccessScoreCalculator.slopeStatisticName(slope.statistic)}"),
      Option.when(slope.lowThreshold != d.lowThreshold)(s"lo:${grade(slope.lowThreshold)}"),
      Option.when(slope.highThreshold != d.highThreshold)(s"hi:${grade(slope.highThreshold)}"),
      Option.when(slope.barrierEnabled)(s"b:${grade(slope.barrierThreshold)}"),
      Option.when(slope.includeApproximate)("ap:1")
    ).flatten.mkString(",")
  }
}

object AccessScoreWeights {
  private val Tolerance: Double = 1e-9

  val Default: AccessScoreWeights =
    AccessScoreWeights(AccessScoreCalculator.presets("default"), AccessScoreCalculator.defaultSlopeSettings)

  /** A grade is written to five decimals, so one read back this close to a default is that default. */
  private val GradeStep: Double = 1e-5

  /**
   * The highest magnitude a type may take: the AccessScore tool's slider ceiling, 3 or the next whole number above the
   * engine's largest default. Held to it so a hand-edited link can't push a score past what the tool could show.
   */
  val TypeWeightMax: Double = math.max(3.0, math.ceil(Default.magnitudes.values.max) + 1)

  /**
   * Reads the two link parameters as the AccessScore tool does (AccessScoreUrlSync.#readSlope). A token naming an
   * unscored type or statistic, or a value that isn't a number in range, is dropped and that setting stays the
   * engine's, so a stale link degrades token by token rather than failing. Thresholds that cross are dropped as a pair.
   *
   * @param w  The `w` parameter: `Type:magnitude` tokens joined by commas.
   * @param gs The `gs` parameter: the slope settings' tokens.
   * @return The settings, the engine's own where the link says nothing.
   */
  def fromParams(w: Option[String], gs: Option[String]): AccessScoreWeights = {
    def tokens(raw: Option[String]): Seq[(String, String)] =
      raw.toSeq.flatMap(_.split(',')).flatMap { token =>
        token.split(':') match {
          case Array(key, value) => Some(key.trim -> value.trim)
          case _                 => None
        }
      }
    def number(text: String) = text.toDoubleOption.filter(v => v >= 0 && !v.isInfinite)
    val asked                = tokens(w)
      .flatMap { case (t, v) => number(v).map(t -> _) }
      .collect {
        case (t, v) if AccessScoreCalculator.scoredTypeNames(t) => t -> math.min(v, TypeWeightMax)
      }
      .toMap
    snap(AccessScoreWeights(Default.magnitudes ++ asked, readSlope(tokens(gs))))
  }

  private def readSlope(tokens: Seq[(String, String)]): AccessScoreCalculator.SlopeSettings = {
    val d                                                     = AccessScoreCalculator.defaultSlopeSettings
    def grade(text: String, fallback: Double): Option[Double] =
      text.toDoubleOption
        .filter(v => v >= AccessScoreCalculator.slopeThresholdMin && v <= AccessScoreCalculator.slopeThresholdMax)
        .map(v => if (math.abs(v - fallback) < GradeStep) fallback else v)
    val read = tokens.foldLeft(d) {
      case (s, ("w", v)) =>
        v.toDoubleOption
          .filter(x => x >= 0 && !x.isInfinite)
          .fold(s)(x => s.copy(weight = math.min(x, AccessScoreCalculator.slopeWeightMax)))
      case (s, ("s", v)) =>
        AccessScoreCalculator.slopeStatistics
          .find(AccessScoreCalculator.slopeStatisticName(_) == v)
          .fold(s)(x => s.copy(statistic = x))
      case (s, ("lo", v)) => grade(v, d.lowThreshold).fold(s)(x => s.copy(lowThreshold = x))
      case (s, ("hi", v)) => grade(v, d.highThreshold).fold(s)(x => s.copy(highThreshold = x))
      case (s, ("b", v))  =>
        grade(v, d.barrierThreshold).fold(s)(x => s.copy(barrierEnabled = true, barrierThreshold = x))
      case (s, ("ap", "1")) => s.copy(includeApproximate = true)
      case (s, _)           => s
    }
    if (read.lowThreshold >= read.highThreshold)
      read.copy(lowThreshold = d.lowThreshold, highThreshold = d.highThreshold)
    else read
  }

  /** A value a hair off a default (a rounded link) reads as the default, so a round trip can't stamp a report custom. */
  private def snap(weights: AccessScoreWeights): AccessScoreWeights = {
    def near(a: Double, b: Double) = math.abs(a - b) < Tolerance
    val d                          = Default.slope
    AccessScoreWeights(
      weights.magnitudes.map { case (t, v) => t -> (if (near(v, Default.magnitudes(t))) Default.magnitudes(t) else v) },
      weights.slope.copy(weight = if (near(weights.slope.weight, d.weight)) d.weight else weights.slope.weight)
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
      AccessScores(scores.streets.map(s => reweightStreet(s, signed, weights.slope, byId)), intersections)
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
