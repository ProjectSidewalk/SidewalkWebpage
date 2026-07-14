package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import service.AccessScoreCalculator.ClusterScoreInput

/**
 * Pure (no DB, no app boot) unit test for the v3 AccessScore math (#3855).
 *
 * Pins the consequential weighting decisions so they can't silently drift: the Good/Okay/Bad sign-flip for positive
 * types, the Low/Med/High magnitude scaling for negative types, presence-only handling for Signal/NoSidewalk, the
 * null-severity fallbacks, tag activation, and the street/region aggregation.
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

  test("presence-only types ignore severity entirely") {
    // Signal is +0.5 for mere presence; a (spurious) severity value must not change it.
    AccessScoreCalculator.scoreCluster(cluster("Signal", None)) shouldBe (0.5 +- eps)
    AccessScoreCalculator.scoreCluster(cluster("Signal", Some(3))) shouldBe (0.5 +- eps)
    // NoSidewalk is a strong fixed negative.
    AccessScoreCalculator.scoreCluster(cluster("NoSidewalk", None)) shouldBe (-1.0 +- eps)
  }

  test("null severity falls back to Okay for positives and Low for negatives") {
    AccessScoreCalculator.scoreCluster(cluster("CurbRamp", None)) shouldBe (0.375 +- eps)       // Okay
    AccessScoreCalculator.scoreCluster(cluster("SurfaceProblem", None)) shouldBe (-0.33 +- eps) // Low
  }

  test("unscored label types contribute exactly zero") {
    Seq("Occlusion", "Other", "Problem", "NotARealType").foreach { lt =>
      AccessScoreCalculator.scoreCluster(cluster(lt, Some(3))) shouldBe (0.0 +- eps)
    }
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
  }

  test("tag adjustments add independently of the base sign (Crosswalk 'level with sidewalk' helps a Bad crosswalk)") {
    // Bad crosswalk base −0.75, plus +0.25 for the positive tag.
    AccessScoreCalculator.scoreCluster(
      cluster("Crosswalk", Some(3), labelCount = 1, tagCounts = Map("level with sidewalk" -> 1))
    ) shouldBe (-0.5 +- eps)
  }

  test("scoreStreet sigmoids the summed contributions; empty street is the neutral 0.5") {
    AccessScoreCalculator.scoreStreet(Seq.empty) shouldBe (0.5 +- eps)
    // A strongly negative street trends toward 0; a strongly positive one toward 1.
    AccessScoreCalculator.scoreStreet(Seq.fill(10)(cluster("NoSidewalk"))) should be < 0.01
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
