package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.LocalDate

/**
 * Pure unit tests for the imagery-age poller's parsing and geometry helpers (#4384). No DB or network.
 */
class ImageryFreshnessPollSpec extends AnyFunSuite with Matchers {
  import ImageryFreshnessService._

  test("parseGsvCaptureDate handles the three GSV precisions and rejects garbage") {
    parseGsvCaptureDate("2024-06-15") shouldBe Some(LocalDate.of(2024, 6, 15))
    parseGsvCaptureDate("2024-06") shouldBe Some(LocalDate.of(2024, 6, 1))
    parseGsvCaptureDate("2024") shouldBe Some(LocalDate.of(2024, 1, 1))
    parseGsvCaptureDate(" 2024-06 ") shouldBe Some(LocalDate.of(2024, 6, 1))
    parseGsvCaptureDate("2024-13") shouldBe None // Not a real month.
    parseGsvCaptureDate("June 2024") shouldBe None
    parseGsvCaptureDate("") shouldBe None
    parseGsvCaptureDate(null) shouldBe None
  }

  test("parseMapillaryCapturedAt converts epoch millis and clamps implausible device-clock values") {
    val now = LocalDate.of(2026, 7, 16)
    // 2024-06-15T12:00:00Z in epoch millis.
    parseMapillaryCapturedAt(1718452800000L, now) shouldBe Some(LocalDate.of(2024, 6, 15))
    parseMapillaryCapturedAt(0L, now) shouldBe None             // Epoch zero = unset device clock.
    parseMapillaryCapturedAt(-1000L, now) shouldBe None         // Pre-epoch nonsense.
    parseMapillaryCapturedAt(1041379200000L, now) shouldBe None // 2003: before street-level imagery.
    parseMapillaryCapturedAt(4102444800000L, now) shouldBe None // 2100: future.
  }

  test("bboxHalfWidths approximates the radius and widens longitude away from the equator") {
    val (dLatEq, dLngEq) = bboxHalfWidths(0.0, 25.0)
    dLatEq shouldBe (25.0 / 111320.0) +- 1e-12
    dLngEq shouldBe dLatEq +- 1e-6 // cos(0) = 1.

    val (dLat60, dLng60) = bboxHalfWidths(60.0, 25.0)
    dLat60 shouldBe dLatEq
    dLng60 shouldBe (dLatEq / 0.5) +- 1e-6 // cos(60°) = 0.5, so longitude degrees are twice as wide.

    // The polar clamp keeps the divisor sane instead of exploding toward infinity.
    val (_, dLngPole) = bboxHalfWidths(90.0, 25.0)
    dLngPole should be <= (dLatEq / 0.01) + 1e-9
  }
}
