package models.region

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for how much of a street's length gets credited to a region's `audited_distance`
 * (#4677).
 *
 * A street cut short because Street View imagery ran out partway must credit only the distance the user actually
 * walked, not the full geometry — otherwise a 200 m street whose imagery dies at 80 m still adds 200 m of "audited"
 * coverage nobody could see. Pins the normal path (credit full length), the imagery-truncated path (credit walked
 * distance), and the clamping that keeps a missing/negative/oversized client value from inflating coverage past the
 * street's real length.
 */
class RegionCompletionMetricSpec extends AnyFunSuite with Matchers {

  test("normal completion (no imagery truncation) credits the full street length") {
    RegionCompletionTable.auditedDistanceToCredit(200.0, None) shouldBe 200.0
  }

  test("imagery-truncated street credits only how far the user actually walked") {
    // The motivating case: 200 m street, imagery dies at 80 m.
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(Some(80.0))) shouldBe 80.0
  }

  test("imagery-truncated street with no walked distance gets no credit") {
    // Missing client distance must fail closed rather than fall back to the full street length.
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(None)) shouldBe 0.0
  }

  test("walked distance is clamped to the full length so it can never overstate coverage") {
    // An oversized/stale client value must not credit more than the street actually is.
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(Some(250.0))) shouldBe 200.0
  }

  test("a negative walked distance is clamped up to zero, never subtracting coverage") {
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(Some(-5.0))) shouldBe 0.0
  }

  test("walking the whole street before imagery ran out credits the full length") {
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(Some(200.0))) shouldBe 200.0
  }

  test("a zero-length walk credits nothing") {
    RegionCompletionTable.auditedDistanceToCredit(200.0, Some(Some(0.0))) shouldBe 0.0
  }
}
