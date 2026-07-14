package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for the engagement-funnel conversion math (#288).
 *
 * Pins the step-over-step and overall conversion helpers, including the divide-by-zero behavior that keeps an empty
 * funnel from producing NaN/Infinity, and the invariant that the step-key list and zero-fill stay the same length.
 */
class FunnelMathSpec extends AnyFunSuite with Matchers {

  private val eps = 1e-9

  test("FunnelDefs declares the mapping (6-step) and contribution (3-step) funnels, all starting with 'visited'") {
    val defs = ConfigService.FunnelDefs.toMap
    defs.keySet shouldBe Set("mapping", "contribution")
    ConfigService.funnelStepKeys("mapping").length shouldBe 6
    ConfigService.funnelStepKeys("contribution").length shouldBe 3
    ConfigService.funnelStepKeys("mapping").head shouldBe "visited"
    ConfigService.funnelStepKeys("contribution").head shouldBe "visited"
    ConfigService.funnelStepKeys("nonexistent") shouldBe empty
  }

  test("stepConversion: first step is always 1.0; each later step is its share of the previous") {
    val conv = ConfigService.stepConversion(Seq(100, 50, 25, 25, 5, 1))
    conv.head shouldBe (1.0 +- eps)
    conv(1) shouldBe (0.5 +- eps)
    conv(2) shouldBe (0.5 +- eps)
    conv(3) shouldBe (1.0 +- eps)
    conv(4) shouldBe (0.2 +- eps)
    conv.length shouldBe 6
  }

  test("stepConversion: a zero previous step yields 0.0, not NaN/Infinity") {
    val conv = ConfigService.stepConversion(Seq(100, 0, 0, 0, 0, 0))
    conv.head shouldBe (1.0 +- eps)
    conv(1) shouldBe (0.0 +- eps)
    conv.drop(1).forall(_ == 0.0) shouldBe true
  }

  test("stepConversion on an all-zero funnel is 1.0 then zeros (no division blowups)") {
    val conv = ConfigService.stepConversion(ConfigService.ZeroFunnelSteps)
    conv.head shouldBe (1.0 +- eps)
    conv.drop(1).forall(_ == 0.0) shouldBe true
  }

  test("overallConversion is last/first, and 0.0 when there are no visitors or no steps") {
    ConfigService.overallConversion(Seq(100, 50, 25, 25, 5, 10)) shouldBe (0.1 +- eps)
    ConfigService.overallConversion(ConfigService.ZeroFunnelSteps) shouldBe (0.0 +- eps)
    ConfigService.overallConversion(Seq.empty) shouldBe (0.0 +- eps)
  }
}
