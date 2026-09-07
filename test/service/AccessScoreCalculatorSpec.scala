package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import service.AccessScoreCalculator.ClusterScoreInput

/**
 * Pure (no DB, no app boot) unit test for the v3 AccessScore math (#3855, #5093).
 *
 * Pins the consequential weighting decisions so they can't silently drift: the Good/Okay/Bad sign-flip for positive
 * types, the Low/Med/High magnitude scaling for negative types, presence-only handling for Signal, the null-severity
 * fallbacks, tag activation, the street-condition pooling of NoSidewalk, and the street/region aggregation.
 */
class AccessScoreCalculatorSpec extends AnyFunSuite with Matchers {

  private val eps = 1e-9

  /** Builds a cluster input; severity/labelCount/tagCounts default to the common "no tags" case. */
  private def cluster(
      labelType: String,
      severity: Option[Int] = None,
      labelCount: Int = 1,
      tagCounts: Map[String, Int] = Map.empty
  ): ClusterScoreInput = ClusterScoreInput(labelType, severity, labelCount, tagCounts)

  /** A NoSidewalk cluster of `labelCount` labels, `tagged` of which carry `tag`. */
  private def noSidewalk(labelCount: Int = 1, tag: String = "", tagged: Int = 0): ClusterScoreInput =
    cluster("NoSidewalk", labelCount = labelCount, tagCounts = if (tagged > 0) Map(tag -> tagged) else Map.empty)

  /** The NoSidewalk term of a street made of just these clusters. */
  private def noSidewalkTerm(clusters: ClusterScoreInput*): Double =
    AccessScoreCalculator.scoreByType(clusters)("NoSidewalk")

  private def logit(p: Double): Double = math.log(p / (1.0 - p))

  test("positive quality maps Good→full+, Okay→half+, Bad→full− (the sign-flip, CurbRamp base 0.75)") {
    AccessScoreCalculator.scoreCluster(cluster("CurbRamp", Some(1))) shouldBe (0.75 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("CurbRamp", Some(2))) shouldBe (0.375 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("CurbRamp", Some(3))) shouldBe (-0.75 +- eps)
  }

  test("Crosswalk (also a positive quality type) follows the same sign-flipping mapping") {
    AccessScoreCalculator.scoreCluster(cluster("Crosswalk", Some(1))) shouldBe (0.75 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("Crosswalk", Some(3))) shouldBe (-0.75 +- eps)
  }

  test("negative severity scales magnitude Low→Med→High, staying negative (Obstacle base −1.0)") {
    AccessScoreCalculator.scoreCluster(cluster("Obstacle", Some(1))) shouldBe (-0.33 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("Obstacle", Some(2))) shouldBe (-0.67 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("Obstacle", Some(3))) shouldBe (-1.0 +- eps)
  }

  test("presence-only Signal ignores severity entirely") {
    // Signal is +0.5 for mere presence; a (spurious) severity value must not change it.
    AccessScoreCalculator.scoreCluster(cluster("Signal", None)) shouldBe (0.5 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("Signal", Some(3))) shouldBe (0.5 +- eps)
  }

  test("null severity falls back to Okay for positives and Low for negatives") {
    AccessScoreCalculator.scoreCluster(cluster("CurbRamp", None)) shouldBe (0.375 +- eps)       // Okay
    AccessScoreCalculator.scoreCluster(cluster("SurfaceProblem", None)) shouldBe (-0.33 +- eps) // Low
  }

  test("unscored label types contribute exactly zero and are absent from the per-type breakdown") {
    Seq("Occlusion", "Other", "NotARealType").foreach { lt =>
      AccessScoreCalculator.scoreCluster(cluster(lt, Some(3))) shouldBe (0.0 +- eps)
    }
    AccessScoreCalculator.scoreByType(Seq(cluster("Occlusion"), cluster("Signal"))).keySet shouldBe Set("Signal")
  }

  test("a tag is active only when present on at least half the cluster's labels") {
    // 1 of 2 labels tagged == 0.5 threshold → active → Signal penalty applies on top of the +0.5 presence base.
    AccessScoreCalculator.scoreCluster(
      cluster("Signal", labelCount = 2, tagCounts = Map("hard to reach buttons" -> 1))
    ) shouldBe (0.25 +- eps)

    // 1 of 3 labels tagged < 0.5 → inactive → only the presence base remains.
    AccessScoreCalculator.scoreCluster(
      cluster("Signal", labelCount = 3, tagCounts = Map("hard to reach buttons" -> 1))
    ) shouldBe (0.5 +- eps)
  }

  test("unmapped tags add nothing, and a zero label count never divides by zero") {
    AccessScoreCalculator.scoreCluster(
      cluster("CurbRamp", Some(1), labelCount = 1, tagCounts = Map("some unmapped tag" -> 1))
    ) shouldBe (0.75 +- eps)
    AccessScoreCalculator.scoreCluster(
      cluster("Signal", labelCount = 0, tagCounts = Map("hard to reach buttons" -> 1))
    ) shouldBe (0.5 +- eps)
    noSidewalkTerm(noSidewalk(labelCount = 0, "street has no sidewalks", tagged = 1)) shouldBe (-2.0 / 3 +- eps)
  }

  test("tag adjustments add independently of the base sign (Crosswalk 'level with sidewalk' helps a Bad crosswalk)") {
    // Bad crosswalk base −0.75, plus +0.25 for the positive tag.
    AccessScoreCalculator.scoreCluster(
      cluster("Crosswalk", Some(3), labelCount = 1, tagCounts = Map("level with sidewalk" -> 1))
    ) shouldBe (-0.5 +- eps)
  }

  // --- NoSidewalk as a street condition (#5093) ---

  test("NoSidewalk's extent factor grows with the cluster count and saturates at three clusters") {
    // base −2.0 × min(1, n / 3): one stray pin is a third of a missing sidewalk; eight pins are no worse than three.
    noSidewalkTerm(noSidewalk()) shouldBe (-2.0 / 3 +- eps)
    noSidewalkTerm(noSidewalk(), noSidewalk()) shouldBe (-4.0 / 3 +- eps)
    noSidewalkTerm(Seq.fill(3)(noSidewalk()): _*) shouldBe (-2.0 +- eps)
    noSidewalkTerm(Seq.fill(8)(noSidewalk()): _*) shouldBe (-2.0 +- eps)
    noSidewalkTerm(Seq.fill(40)(noSidewalk()): _*) shouldBe (-2.0 +- eps)
    AccessScoreCalculator.streetConditionSaturationCount shouldBe 3
  }

  test("a lone NoSidewalk cluster scores the same through scoreCluster and scoreByType") {
    val c = noSidewalk(labelCount = 2, "street has a sidewalk", tagged = 2)
    AccessScoreCalculator.scoreCluster(c) shouldBe (noSidewalkTerm(c) +- eps)
    AccessScoreCalculator.scoreCluster(c) shouldBe (-2.0 / 3 + 1.0 +- eps)
  }

  test("street-wide NoSidewalk tags are judged over the street's pooled labels, not cluster by cluster") {
    // Cluster A: 2 of 3 labels tagged (67% of A alone); cluster B: 1 untagged label. Pooled 2/4 = 50% → active.
    noSidewalkTerm(
      noSidewalk(labelCount = 3, "street has no sidewalks", tagged = 2),
      noSidewalk(labelCount = 1)
    ) shouldBe (-4.0 / 3 - 1.0 +- eps)

    // Same cluster A, but two untagged clusters: pooled 2/5 = 40% → inactive even though A alone clears 50%.
    noSidewalkTerm(
      noSidewalk(labelCount = 3, "street has no sidewalks", tagged = 2),
      noSidewalk(labelCount = 1),
      noSidewalk(labelCount = 1)
    ) shouldBe (-2.0 +- eps)
  }

  test("'ends abruptly' is a point tag: one cluster carrying it at the threshold activates it for the street") {
    // 1 of 8 clusters tagged — pooled that is 1/8 of the labels, but a sidewalk only ends in one place.
    noSidewalkTerm(
      Seq.fill(7)(noSidewalk()) :+ noSidewalk(labelCount = 1, "ends abruptly", tagged = 1): _*
    ) shouldBe (-2.0 - 1.0 +- eps)

    // The tagged cluster itself still has to clear the threshold: 1 of 3 of its labels is not enough.
    noSidewalkTerm(
      Seq.fill(7)(noSidewalk()) :+ noSidewalk(labelCount = 3, "ends abruptly", tagged = 1): _*
    ) shouldBe (-2.0 +- eps)

    AccessScoreCalculator.streetConditionPointTags shouldBe Set(("NoSidewalk", "ends abruptly"))
  }

  test("the mutually exclusive sidewalk tags cancel when a street's labels split exactly in half") {
    noSidewalkTerm(
      noSidewalk(labelCount = 2, "street has no sidewalks", tagged = 2),
      noSidewalk(labelCount = 2, "street has a sidewalk", tagged = 2)
    ) shouldBe (-4.0 / 3 +- eps)
  }

  test("NoSidewalk streets order by what labelers recorded: no sidewalks < untagged < a sidewalk on the other side") {
    val full        = Seq.fill(3)(noSidewalk())
    val noSidewalks = Seq.fill(3)(noSidewalk(tag = "street has no sidewalks", tagged = 1))
    val otherSide   = Seq.fill(3)(noSidewalk(tag = "street has a sidewalk", tagged = 1))
    val endsHere    = full :+ noSidewalk(tag = "ends abruptly", tagged = 1)

    AccessScoreCalculator.scoreStreet(noSidewalks) should be < AccessScoreCalculator.scoreStreet(full)
    AccessScoreCalculator.scoreStreet(full) should be < AccessScoreCalculator.scoreStreet(otherSide)
    AccessScoreCalculator.scoreStreet(endsHere) should be < AccessScoreCalculator.scoreStreet(full)
    // A bare no-sidewalk street sits near 0.12 before any other feature; the tagged extremes at 0.05 and 0.27.
    AccessScoreCalculator.scoreStreet(full) shouldBe (0.1192 +- 1e-3)
    AccessScoreCalculator.scoreStreet(noSidewalks) shouldBe (0.0474 +- 1e-3)
    AccessScoreCalculator.scoreStreet(otherSide) shouldBe (0.2689 +- 1e-3)
  }

  test("the NoSidewalk tag table is exactly the seven documented tags") {
    AccessScoreCalculator.tagAdjustments.collect { case (("NoSidewalk", tag), delta) => tag -> delta } shouldBe Map(
      "ends abruptly"               -> -1.0,
      "street has no sidewalks"     -> -1.0,
      "street has a sidewalk"       -> +1.0,
      "gravel/dirt road"            -> -0.25,
      "shared pedestrian/car space" -> +0.25,
      "covered walkway"             -> +0.5,
      "pedestrian lane marking"     -> +0.5
    )
  }

  test("per-cluster types still sum cluster by cluster, and the per-type terms sum to the score's logit") {
    val clusters = Seq(
      cluster("CurbRamp", Some(1)),
      cluster("CurbRamp", Some(3)),
      cluster("Obstacle", Some(2)),
      noSidewalk(),
      noSidewalk()
    )
    val byType = AccessScoreCalculator.scoreByType(clusters)
    byType("CurbRamp") shouldBe (0.0 +- eps)
    byType("Obstacle") shouldBe (-0.67 +- eps)
    byType("NoSidewalk") shouldBe (-4.0 / 3 +- eps)
    byType.keySet shouldBe Set("CurbRamp", "Obstacle", "NoSidewalk")

    val score = AccessScoreCalculator.scoreStreet(clusters)
    logit(score) shouldBe (byType.values.sum +- 1e-9)
    AccessScoreCalculator.scoreFromSubScores(byType) shouldBe (score +- eps)
  }

  test("scoreStreet sigmoids the summed contributions; empty street is the neutral 0.5") {
    AccessScoreCalculator.scoreStreet(Seq.empty) shouldBe (0.5 +- eps)
    AccessScoreCalculator.scoreFromSubScores(Map.empty) shouldBe (0.5 +- eps)
    // A strongly negative street trends toward 0; a strongly positive one toward 1.
    AccessScoreCalculator.scoreStreet(Seq.fill(10)(cluster("Obstacle", Some(3)))) should be < 0.01
    AccessScoreCalculator.scoreStreet(Seq.fill(10)(cluster("CurbRamp", Some(1)))) should be > 0.99
  }

  test("scoreRegion is the street-length-weighted mean of scores, or None when nothing is audited") {
    AccessScoreCalculator.scoreRegion(Seq((0.2, 100.0), (0.8, 300.0))).get shouldBe (0.65 +- eps)
    AccessScoreCalculator.scoreRegion(Seq.empty) shouldBe None
    AccessScoreCalculator.scoreRegion(Seq((0.5, 0.0))) shouldBe None                // zero total length
    AccessScoreCalculator.scoreRegion(Seq((0.42, 50.0))).get shouldBe (0.42 +- eps) // single street
  }

  // --- The count-based path the AccessScore tool's client mirrors (#3855) ---

  /** A deterministic spread of clusters: every scored type, every rating bucket, tags on and off, pooled NoSidewalk. */
  private def randomClusters(seed: Int, n: Int): Seq[ClusterScoreInput] = {
    val rng   = new scala.util.Random(seed)
    val types = AccessScoreCalculator.orderedScoredTypes :+ "Occlusion"
    Seq.fill(n) {
      val labelType  = types(rng.nextInt(types.size))
      val severity   = rng.nextInt(6) match { case 0 => None; case 5 => Some(5); case s => Some(s) }
      val labelCount = rng.nextInt(4)
      val tags = AccessScoreCalculator.tagAdjustments.keysIterator.collect { case (lt, tag) if lt == labelType => tag }
      val tagCounts = tags.filter(_ => rng.nextBoolean()).map(tag => tag -> rng.nextInt(labelCount + 1)).toMap
      cluster(labelType, severity, labelCount, tagCounts)
    }
  }

  test("severityCountsByType buckets ratings 1..3 and sends null or out-of-range ratings to the null bucket") {
    val counts = AccessScoreCalculator.severityCountsByType(
      Seq(
        cluster("CurbRamp", Some(1)),
        cluster("CurbRamp", Some(1)),
        cluster("CurbRamp", Some(3)),
        cluster("CurbRamp", None),
        cluster("CurbRamp", Some(5)),
        cluster("Obstacle", Some(2)),
        cluster("Occlusion", Some(2))
      )
    )
    counts shouldBe Map("CurbRamp" -> Map("1" -> 2, "3" -> 1, "null" -> 2), "Obstacle" -> Map("2" -> 1))
    AccessScoreCalculator.severityBucket(Some(0)) shouldBe "null"
    AccessScoreCalculator.severityBuckets shouldBe Seq("1", "2", "3", "null")
  }

  test("tagAdjustmentsByType judges per-cluster types cluster by cluster and NoSidewalk over the pooled street") {
    val adjustments = AccessScoreCalculator.tagAdjustmentsByType(
      Seq(
        cluster("Signal", labelCount = 2, tagCounts = Map("hard to reach buttons" -> 1)), // active: −0.25
        cluster("Signal", labelCount = 3, tagCounts = Map("APS" -> 1)), // inactive
        noSidewalk(labelCount = 3, "street has no sidewalks", tagged = 2), // pooled 2/4 → active: −1.0
        noSidewalk(labelCount = 1),
        cluster("CurbRamp", Some(1))
      )
    )
    adjustments shouldBe Map("Signal" -> -0.25, "NoSidewalk" -> -1.0, "CurbRamp" -> 0.0)
  }

  test("subScoresFromCounts rebuilds scoreByType exactly from the counts, over a wide random spread of streets") {
    (1 to 200).foreach { seed =>
      val clusters = randomClusters(seed, n = 1 + seed % 12)
      val expected = AccessScoreCalculator.scoreByType(clusters)
      val rebuilt  = AccessScoreCalculator.subScoresFromCounts(
        AccessScoreCalculator.severityCountsByType(clusters),
        AccessScoreCalculator.tagAdjustmentsByType(clusters)
      )
      withClue(s"seed $seed: ") {
        rebuilt.keySet shouldBe expected.keySet
        expected.foreach { case (t, term) => rebuilt(t) shouldBe (term +- eps) }
        AccessScoreCalculator.scoreFromSubScores(rebuilt) shouldBe (AccessScoreCalculator.scoreStreet(clusters) +- eps)
      }
    }
  }

  test("subScoresFromCounts scales each type's weighted part by the substituted weight but never its tag adjustment") {
    val counts = Map("Obstacle" -> Map("3" -> 2), "NoSidewalk" -> Map("null" -> 8), "Signal" -> Map("null" -> 1))
    val tags   = Map("Obstacle" -> 0.0, "NoSidewalk" -> -1.0, "Signal" -> 0.25)
    val halved = AccessScoreCalculator.baseWeights.map { case (t, w) => t -> w / 2 }
    val terms  = AccessScoreCalculator.subScoresFromCounts(counts, tags, halved)
    terms("Obstacle") shouldBe (-1.0 +- eps)         // (−1.0 / 2) × 2 × 1.0
    terms("NoSidewalk") shouldBe (-1.0 - 1.0 +- eps) // (−2.0 / 2) × min(1, 8/3) − 1.0
    terms("Signal") shouldBe (0.25 + 0.25 +- eps)    // (0.5 / 2) × 1 + 0.25
    // A type with zero clusters contributes nothing even if a tag adjustment is (spuriously) supplied for it.
    AccessScoreCalculator.subScoresFromCounts(Map("CurbRamp" -> Map.empty), Map("CurbRamp" -> 1.0)) shouldBe Map.empty
  }

  test("ratingMultiplier ignores the bucket for the modes that ignore ratings") {
    AccessScoreCalculator.severityBuckets.foreach { b =>
      AccessScoreCalculator.ratingMultiplier(AccessScoreCalculator.PresenceOnly, b) shouldBe 1.0
      AccessScoreCalculator.ratingMultiplier(AccessScoreCalculator.StreetCondition, b) shouldBe 1.0
    }
    AccessScoreCalculator.ratingMultiplier(AccessScoreCalculator.PositiveQuality, "3") shouldBe -1.0
    AccessScoreCalculator.ratingMultiplier(AccessScoreCalculator.PositiveQuality, "null") shouldBe 0.5
    AccessScoreCalculator.ratingMultiplier(AccessScoreCalculator.NegativeSeverity, "null") shouldBe 0.33
  }

  test("every preset weights exactly the scored types, and 'default' is the engine's own magnitudes") {
    AccessScoreCalculator.presetOrder.toSet shouldBe AccessScoreCalculator.presets.keySet
    AccessScoreCalculator.presetOrder.head shouldBe "default"
    AccessScoreCalculator.presets.foreach { case (id, weights) =>
      withClue(s"preset $id: ") {
        weights.keySet shouldBe AccessScoreCalculator.scoredTypeNames
        weights.values.foreach(_ should be >= 0.0)
      }
    }
    AccessScoreCalculator.presets("default") shouldBe AccessScoreCalculator.baseWeights.map { case (t, w) =>
      t -> math.abs(w)
    }
    AccessScoreCalculator.presetOrder shouldBe Seq("default", "barriers", "infrastructure", "missing_ramps")
    AccessScoreCalculator.presets("barriers")("Obstacle") shouldBe (1.5 +- eps)
    AccessScoreCalculator.presets("barriers")("CurbRamp") shouldBe (0.75 +- eps)
    AccessScoreCalculator.presets("infrastructure")("CurbRamp") shouldBe (1.125 +- eps)
    AccessScoreCalculator.presets("missing_ramps")("NoCurbRamp") shouldBe (2.0 +- eps)
  }

  test("the scored-type set is exactly the seven expected types, in canonical order") {
    AccessScoreCalculator.orderedScoredTypes shouldBe Seq(
      "CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal", "NoSidewalk"
    )
  }
}
