package service

import models.street.StreetImageryTable
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.LocalDate

/**
 * Pure unit tests for the imagery-age poller's parsing and geometry helpers (#4384). No DB or network.
 */
class ImageryFreshnessPollSpec extends AnyFunSuite with Matchers {
  import ImageryFreshnessService.*

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
    val geometryFactory = GeometryFactory()
    // A ~111 m east-west street at the equator; JTS coordinates are (x = lng, y = lat).
    val street = geometryFactory.createLineString(Array(Coordinate(0.0, 0.0), Coordinate(0.001, 0.0)))

    metersToStreet(0.0, 0.0005, street) shouldBe 0.0 +- 0.01     // On the line.
    metersToStreet(0.0001, 0.0005, street) shouldBe 11.13 +- 0.1 // ~11 m north of the midpoint.
    // Beyond the east endpoint: distance to the endpoint, not to the infinite line through the segment.
    metersToStreet(0.0, 0.002, street) shouldBe 111.32 +- 0.5
    // A pano ~30 m down a cross street from an endpoint: outside PanoStreetToleranceMeters, so it must filter out.
    metersToStreet(0.00027, 0.001, street) should be > 15.0
  }

  test("a GSV answer far outside the search radius is farther from the street than the tolerance (#5114)") {
    // Google's metadata `radius` is a hint: a 25 m query at a Seattle street endpoint came back with a user photosphere
    // in Syracuse, NY. The poll sends that same query and relies on pollOneStreet's metersToStreet-vs-tolerance filter,
    // not the radius, to keep such an answer off the street. This pins the measurement half of that: the distance comes
    // out beyond the tolerance however far away the answer is, with no projection artefact letting it back in.
    val geometryFactory = GeometryFactory()
    val street          = geometryFactory.createLineString(
      Array(Coordinate(-122.3100703, 47.6196811), Coordinate(-122.3100703, 47.6208411))
    )
    metersToStreet(43.0917906, -76.1720131, street) should be > StreetImageryTable.PanoStreetToleranceMeters
    // The milder form: a pano 77 m off a 25 m query.
    metersToStreet(47.6196811, -122.3090500, street) should be > StreetImageryTable.PanoStreetToleranceMeters
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

  test("batchSizeFor sizes a two-week pass, held between the floor and the ceiling (#5402)") {
    // Newberg-sized: 1,544 / 14 = 111, so the floor holds and a small city finishes a pass in ~3 nights.
    batchSizeFor(1544, None, 14, 500, 5000) shouldBe 500
    // DC-sized: ceil(14,037 / 14) = 1,003, the first city where the floor stops mattering.
    batchSizeFor(14037, None, 14, 500, 5000) shouldBe 1003
    // Chicago-sized and beyond: the ceiling bounds run time and Mapillary's rate limits; the pass just runs longer.
    batchSizeFor(100000, None, 14, 500, 5000) shouldBe 5000
    batchSizeFor(0, None, 14, 500, 5000) shouldBe 500
  }

  test("batchSizeFor uses an explicit override verbatim, outside the bounds too") {
    batchSizeFor(14037, Some(2000), 14, 500, 5000) shouldBe 2000
    batchSizeFor(14037, Some(100), 14, 500, 5000) shouldBe 100
    batchSizeFor(14037, Some(9000), 14, 500, 5000) shouldBe 9000
  }

  test("batchSizeFor survives misconfigured bounds rather than producing a nonsense batch") {
    batchSizeFor(14037, None, 0, 500, 5000) shouldBe 5000   // A zero-night pass is read as one night.
    batchSizeFor(14037, None, 14, 6000, 5000) shouldBe 5000 // Crossed bounds: the protective ceiling wins.
  }

  test("PollPlan: audited streets at least the batch cycle on their own and unaudited ones are never reached") {
    // streetsToPoll serves audited streets strictly first, so with A >= B every slot goes to them.
    val plan = PollPlan(openStreets = 23995, auditedStreets = 9000, batchSize = 500, overridden = true)
    plan.auditedPassNights shouldBe 18 // ceil(9,000 / 500).
    plan.unauditedPassNights shouldBe None
    PollPlan(2000, 1003, 1003, overridden = false).unauditedPassNights shouldBe None // A == B leaves no slot either.
  }

  test("PollPlan: audited streets under the batch are re-polled nightly and unaudited ones share what is left") {
    val plan = PollPlan(openStreets = 14037, auditedStreets = 600, batchSize = 1003, overridden = false)
    plan.auditedPassNights shouldBe 1
    plan.unauditedPassNights shouldBe Some(34) // ceil(13,437 / (1,003 - 600)), rounding the partial night up.
    PollPlan(1544, 0, 500, overridden = false).unauditedPassNights shouldBe Some(4) // No audits: the whole batch.
    PollPlan(1544, 0, 500, overridden = false).auditedPassNights shouldBe 0
  }

  test("PollPlan: no unaudited streets is a zero-night pass, and a zero batch reaches nothing") {
    PollPlan(800, 800, 500, overridden = false).unauditedPassNights shouldBe Some(0)
    PollPlan(100, 10, 0, overridden = true).auditedPassNights shouldBe 0
    PollPlan(100, 10, 0, overridden = true).unauditedPassNights shouldBe None
  }
}
