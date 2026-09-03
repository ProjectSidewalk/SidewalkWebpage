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

  test("the scored-type set is exactly the seven expected types, in id order") {
    AccessScoreCalculator.orderedScoredTypes shouldBe Seq(
      "CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal"
    )
  }
}
