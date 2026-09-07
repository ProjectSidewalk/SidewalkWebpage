package service

import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
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

  test("parsePanoramaxDatetime reads the STAC datetime's date in UTC and clamps implausible values") {
    val now = LocalDate.of(2026, 9, 4)
    parsePanoramaxDatetime("2026-08-11T15:02:33+00:00", now) shouldBe Some(LocalDate.of(2026, 8, 11))
    // A local-offset timestamp is read as the UTC date, like Mapillary's epoch millis.
    parsePanoramaxDatetime("2026-08-11T00:30:00+02:00", now) shouldBe Some(LocalDate.of(2026, 8, 10))
    parsePanoramaxDatetime("2039-10-02T11:45:57+00:00", now) shouldBe None // Future: a mis-set camera clock.
    parsePanoramaxDatetime("2003-05-01T00:00:00+00:00", now) shouldBe None // Before street-level imagery.
    parsePanoramaxDatetime("not a date", now) shouldBe None
    parsePanoramaxDatetime("", now) shouldBe None
  }

  test("metersToStreet measures point-to-polyline distance in meters, clamped to the segment") {
    val geometryFactory = new GeometryFactory()
    // A ~111 m east-west street at the equator; JTS coordinates are (x = lng, y = lat).
    val street = geometryFactory.createLineString(Array(new Coordinate(0.0, 0.0), new Coordinate(0.001, 0.0)))

    metersToStreet(0.0, 0.0005, street) shouldBe 0.0 +- 0.01     // On the line.
    metersToStreet(0.0001, 0.0005, street) shouldBe 11.13 +- 0.1 // ~11 m north of the midpoint.
    // Beyond the east endpoint: distance to the endpoint, not to the infinite line through the segment.
    metersToStreet(0.0, 0.002, street) shouldBe 111.32 +- 0.5
    // A pano ~30 m down a cross street from an endpoint: outside PanoStreetToleranceMeters, so it must filter out.
    metersToStreet(0.00027, 0.001, street) should be > 15.0
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
