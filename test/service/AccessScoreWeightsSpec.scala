package service

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import service.AccessScoreCalculator.ClusterScoreInput

/**
 * A reader's weights (#5876): how a link's `w` and `gs` read, and that re-scoring from the published counts lands on the
 * numbers the engine would publish under the same weights.
 */
class AccessScoreWeightsSpec extends AnyFunSuite with Matchers {
  private val factory = GeometryFactory()
  private val line    = factory.createLineString(Array(Coordinate(-122.3, 47.6), Coordinate(-122.31, 47.61)))

  private val blockClusters = Seq(
    ClusterScoreInput("Obstacle", Some(3), 2, Map("fire hydrant" -> 2)),
    ClusterScoreInput("SurfaceProblem", Some(2), 1, Map.empty),
    ClusterScoreInput("NoSidewalk", None, 3, Map.empty)
  )
  private val cornerClusters = Seq(
    ClusterScoreInput("CurbRamp", Some(1), 2, Map.empty),
    ClusterScoreInput("NoCurbRamp", Some(3), 1, Map.empty)
  )

  private val crossing = IntersectionAccessScoreForApi(
    intersectionId = 9,
    regionId = Some(1),
    degree = 4,
    gradeSeparated = false,
    streetEdgeIds = Seq(1),
    auditCount = 1,
    score = Some(AccessScoreCalculator.scoreStreet(cornerClusters)),
    labelCount = 3,
    clusterCounts = Map("CurbRamp" -> 1, "NoCurbRamp" -> 1),
    subScores = AccessScoreCalculator.scoreByType(cornerClusters),
    severityCounts = AccessScoreCalculator.severityCountsByType(cornerClusters),
    tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(cornerClusters),
    geometry = factory.createPoint(Coordinate(-122.3, 47.6))
  )

  /**
   * The street as the engine publishes it: from the clusters under its own weights, which is the path the API takes;
   * from the counts under any other, which is the path the AccessScore tool's sliders take.
   */
  private def street(magnitudes: Map[String, Double]): StreetAccessScoreForApi = {
    val signed                                               = AccessScoreCalculator.signedWeights(magnitudes)
    val length                                               = 180.0
    def terms(cs: Seq[ClusterScoreInput], l: Option[Double]) =
      if (signed == AccessScoreCalculator.baseWeights) AccessScoreCalculator.scoreByType(cs, l)
      else
        AccessScoreCalculator.subScoresFromCounts(
          AccessScoreCalculator.severityCountsByType(cs),
          AccessScoreCalculator.tagAdjustmentsByType(cs),
          signed,
          l
        )
    val sub     = terms(blockClusters, Some(length))
    val end     = AccessScoreCalculator.scoreFromSubScores(terms(cornerClusters, None))
    val segment = AccessScoreCalculator.scoreFromSubScores(sub)
    StreetAccessScoreForApi(
      streetEdgeId = 1,
      osmWayId = 1L,
      streetName = Some("A St"),
      regionId = 1,
      score = AccessScoreCalculator.headlineScore(Some(segment), Seq(end)),
      segmentScore = Some(segment),
      startIntersectionId = Some(9),
      endIntersectionId = None,
      startIntersectionScore = Some(end),
      endIntersectionScore = None,
      auditCount = 1,
      lengthMeters = length,
      labelCount = 6,
      clusterCounts = Map("Obstacle" -> 1, "SurfaceProblem" -> 1, "NoSidewalk" -> 1),
      subScores = sub,
      severityCounts = AccessScoreCalculator.severityCountsByType(blockClusters),
      tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(blockClusters),
      gradient = None,
      slopeTerm = 0.0,
      geometry = line
    )
  }

  test("a link with no weights, or none worth reading, is the engine's own") {
    AccessScoreWeights.fromParams(None, None) shouldBe AccessScoreWeights.Default
    AccessScoreWeights.fromParams(Some("NoCurbRamp:lots,Nonsense:2,,:"), Some("w:-1,x")).isDefault shouldBe true
  }

  test("a link's weights are read per type, capped at the sliders' ceilings") {
    val w = AccessScoreWeights.fromParams(Some("NoCurbRamp:2.5,CurbRamp:0,Obstacle:99"), Some("s:mean_grade,w:0.5"))
    w.magnitudes("NoCurbRamp") shouldBe 2.5
    w.magnitudes("CurbRamp") shouldBe 0.0
    w.magnitudes("Obstacle") shouldBe AccessScoreWeights.TypeWeightMax
    w.magnitudes("Signal") shouldBe AccessScoreCalculator.presets("default")("Signal")
    w.slopeWeight shouldBe 0.5
    w.signed("NoCurbRamp") shouldBe -2.5
  }

  test("the engine's own weights leave the published scores untouched") {
    val scores = AccessScores(Seq(street(AccessScoreCalculator.presets("default"))), Seq(crossing))
    AccessScoreWeights.reweight(scores, AccessScoreWeights.Default) shouldBe scores
  }

  test("re-scoring from the counts reproduces the engine's own numbers") {
    val published = AccessScores(Seq(street(AccessScoreCalculator.presets("default"))), Seq(crossing))
    // A hair off the defaults, so the counts path runs where the clusters path made the published numbers.
    val nudged = AccessScoreWeights(AccessScoreWeights.Default.magnitudes.map { case (t, v) => t -> (v + 1e-7) }, 1.0)
    val got    = AccessScoreWeights.reweight(published, nudged)
    got.streets.head.score.get shouldBe published.streets.head.score.get +- 1e-5
    got.intersections.head.score.get shouldBe crossing.score.get +- 1e-5
  }

  test("re-scoring under other weights lands where the engine would, crossings included") {
    val published = AccessScores(Seq(street(AccessScoreCalculator.presets("default"))), Seq(crossing))
    val asked     = AccessScoreCalculator.presets("default") ++ Map("NoCurbRamp" -> 3.0, "Obstacle" -> 0.0)
    val weights   = AccessScoreWeights(asked, 1.0)
    val rescored  = AccessScoreWeights.reweight(published, weights)
    val expected  = street(asked)
    val got       = rescored.streets.head
    got.score.get shouldBe expected.score.get +- 1e-12
    got.segmentScore.get shouldBe expected.segmentScore.get +- 1e-12
    got.startIntersectionScore.get shouldBe expected.startIntersectionScore.get +- 1e-12
    got.subScores.keySet shouldBe expected.subScores.keySet
    got.score.get should be < published.streets.head.score.get
  }
}
