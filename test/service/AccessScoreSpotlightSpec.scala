package service

import models.api.{
  RegionAccessScoreForApi,
  RegionSpotlightRowForApi,
  SpotlightCityForApi,
  StreetAccessScoreForApi,
  StreetSpotlightRowForApi
}
import models.region.NamedRegionCompletion
import models.street.StreetAccessScore
import org.locationtech.jts.geom.{GeometryFactory, LineString, MultiPolygon}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{OffsetDateTime, ZoneOffset}
import scala.util.Random

/**
 * The AccessScore Spotlight's rules, with no database or application attached (#5215).
 *
 * These are the decisions a reader of the landing page's two lists is actually trusting: which places are ranked at
 * all, what a "street" is once edges are rolled into the named stretch people recognize, and how equal scores are
 * broken so the list does not reshuffle between two page loads. The DAOs restate the qualification bars in SQL to
 * keep a city's query bounded, so the copies here are also what says those bars mean what they are meant to.
 */
class AccessScoreSpotlightSpec extends AnyFunSuite with Matchers {

  private val gf: GeometryFactory = new GeometryFactory()
  private val run: OffsetDateTime = OffsetDateTime.of(2026, 9, 16, 3, 14, 0, 0, ZoneOffset.UTC)

  /** A degenerate geometry: nothing here reads it, but the DTOs carry one. */
  private val line: LineString = gf.createLineString(
    Array(new org.locationtech.jts.geom.Coordinate(0, 0), new org.locationtech.jts.geom.Coordinate(0, 1))
  )
  private val polygon: MultiPolygon = gf.createMultiPolygon(Array.empty)

  /** One street as `AccessScoreService` scores it; only the fields the roll-up reads are interesting. */
  private def street(
      streetEdgeId: Int,
      osmWayId: Long,
      regionId: Int,
      score: Option[Double],
      lengthMeters: Double,
      auditCount: Int = 1,
      clusters: Int = 3,
      name: Option[String] = Some("Rainier Ave S")
  ): StreetAccessScoreForApi = StreetAccessScoreForApi(
    streetEdgeId = streetEdgeId,
    osmWayId = osmWayId,
    streetName = name,
    regionId = regionId,
    score = score,
    segmentScore = score,
    startIntersectionId = None,
    endIntersectionId = None,
    startIntersectionScore = None,
    endIntersectionScore = None,
    auditCount = auditCount,
    lengthMeters = lengthMeters,
    labelCount = clusters,
    clusterCounts = if (clusters > 0) Map("Obstacle" -> clusters) else Map.empty,
    subScores = Map.empty,
    severityCounts = Map.empty,
    tagAdjustments = Map.empty,
    geometry = line
  )

  /** One region as `AccessScoreService` rolls it up. */
  private def regionScore(regionId: Int, name: String, score: Option[Double]): RegionAccessScoreForApi =
    RegionAccessScoreForApi(
      regionId = regionId, name = name, score = score, coverage = 1.0, auditedStreetCount = 1, totalStreetCount = 1,
      intersectionScore = None, intersectionCount = 0, scoredIntersectionCount = 0, avgClusterCounts = Map.empty,
      geometry = polygon
    )

  /** One region snapshot row, the shape the endpoint ranks. */
  private def regionRow(
      regionId: Int,
      name: String,
      score: Option[Double],
      completionRate: Double,
      city: Option[SpotlightCityForApi] = None
  ): RegionSpotlightRowForApi =
    RegionSpotlightRowForApi(regionId, name, score, completionRate, auditedDistanceM = 1000.0, city = city)

  /** One street snapshot row, the shape the endpoint ranks. */
  private def streetRow(
      osmWayId: Long,
      score: Double,
      validationCount: Int,
      city: Option[SpotlightCityForApi] = None
  ): StreetSpotlightRowForApi =
    StreetSpotlightRowForApi(
      osmWayId = osmWayId, streetEdgeId = osmWayId.toInt, regionId = 1, regionName = "Ballard",
      name = Some("NW Market St"), score = Some(score), lengthM = 500.0, clusterCount = 4,
      validationCount = validationCount, city = city
    )

  // --- Who gets ranked. ---

  test("a region is ranked only once it has a score and clears the completion floor") {
    AccessScoreSpotlight.regionQualifies(regionRow(1, "Ranked", Some(0.6), 0.85)) shouldBe true
    AccessScoreSpotlight.regionQualifies(regionRow(2, "Too little explored", Some(0.6), 0.5)) shouldBe false
    // Explored end to end, but nobody has labeled a street in it, so the roll-up has nothing to score.
    AccessScoreSpotlight.regionQualifies(regionRow(3, "Unscored", None, 1.0)) shouldBe false
  }

  test("the completion floor is judged on the rounded percent, like the page prints it") {
    // 0.7996 prints as 80%, so it counts as 80%; 0.7949 prints as 79% and does not. The AccessScore tool's own floor
    // rounds the same way, and the two now read the same number out of /v3/api/accessScoreConfig.
    AccessScoreSpotlight.regionQualifies(regionRow(1, "Prints 80", Some(0.5), 0.7996)) shouldBe true
    AccessScoreSpotlight.regionQualifies(regionRow(2, "Prints 79", Some(0.5), 0.7949)) shouldBe false
  }

  test("the floor is a parameter, so the endpoint and the tool can only ever apply the backend's number") {
    val row = regionRow(1, "Two thirds", Some(0.5), 0.67)
    AccessScoreSpotlight.regionQualifies(row, minCompletion = 0.8) shouldBe false
    AccessScoreSpotlight.regionQualifies(row, minCompletion = 0.5) shouldBe true
  }

  test("a stretch of street is ranked when explored, long enough, and carrying evidence -- or none at all") {
    def row(lengthM: Double, clusters: Int, audits: Int = 1, score: Option[Double] = Some(0.5)): StreetAccessScore =
      StreetAccessScore(0, 1L, 1, 1, Some("Broadway E"), score, lengthM, audits, clusters, 0, 0.5, run)

    AccessScoreSpotlight.streetQualifies(row(500, 4)) shouldBe true
    // A 20 m stub with one bad label is one label, not a street with a bad score.
    AccessScoreSpotlight.streetQualifies(row(20, 4)) shouldBe false
    AccessScoreSpotlight.streetQualifies(row(500, 4, audits = 0)) shouldBe false
    AccessScoreSpotlight.streetQualifies(row(500, 4, score = None)) shouldBe false
    // One or two clusters on a long street is the thin middle that says little either way...
    AccessScoreSpotlight.streetQualifies(row(500, 1)) shouldBe false
    AccessScoreSpotlight.streetQualifies(row(500, 2)) shouldBe false
    // ...while none at all on an explored street is a confirmed absence of problems, which is a finding.
    AccessScoreSpotlight.streetQualifies(row(500, 0)) shouldBe true
  }

  // --- Building a night's rows. ---

  test("every region gets a row, including the ones with no score, since they are the 'of M' and the CTA") {
    val scores      = Seq(regionScore(1, "Downtown", Some(0.7)), regionScore(2, "Riverside", None))
    val completions = Seq(
      NamedRegionCompletion(1, "Downtown", totalDistance = 1000.0, auditedDistance = 900.0),
      NamedRegionCompletion(2, "Riverside", totalDistance = 1000.0, auditedDistance = 670.0)
    )
    val rows = AccessScoreSpotlight.buildRegionRows(scores, completions, run).sortBy(_.regionId)

    rows.map(_.regionId) shouldBe Seq(1, 2)
    rows.head.score shouldBe Some(0.7)
    rows.head.completionRate shouldBe (0.9 +- 1e-9)
    rows.head.auditedDistanceM shouldBe (900.0 +- 1e-9)
    rows(1).score shouldBe None
    rows(1).completionRate shouldBe (0.67 +- 1e-9)
    rows.foreach(_.computedAt shouldBe run)
  }

  test("a region with no streets reads as complete, which the unscored score keeps it from being ranked on") {
    val rows = AccessScoreSpotlight.buildRegionRows(
      Seq(regionScore(1, "Empty", None)),
      Seq(NamedRegionCompletion(1, "Empty", totalDistance = 0.0, auditedDistance = 0.0)),
      run
    )
    rows.head.completionRate shouldBe 1.0
    rows.head.score shouldBe None
  }

  test("a region missing a completion row counts as unexplored rather than failing the run") {
    val rows = AccessScoreSpotlight.buildRegionRows(Seq(regionScore(9, "New", None)), Seq.empty, run)
    rows.head.completionRate shouldBe 0.0
    rows.head.auditedDistanceM shouldBe 0.0
  }

  test("street edges roll up into one row per OSM way per region, length-weighted") {
    // Two blocks of one way in one region: 100 m at 0.2 and 300 m at 1.0 average to 0.8, not 0.6.
    val streets = Seq(
      street(11, osmWayId = 99L, regionId = 1, score = Some(0.2), lengthMeters = 100),
      street(12, osmWayId = 99L, regionId = 1, score = Some(1.0), lengthMeters = 300)
    )
    val rows = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(1))

    rows should have size 1
    rows.head.osmWayId shouldBe 99L
    rows.head.score.get shouldBe (0.8 +- 1e-9)
    rows.head.lengthM shouldBe (400.0 +- 1e-9)
    // The longest edge is what a click hands the AccessScore tool to open on.
    rows.head.streetEdgeId shouldBe 12
  }

  test("the same way in two regions stays two rows, since a street name alone is ambiguous in a big city") {
    val streets = Seq(
      street(11, osmWayId = 99L, regionId = 1, score = Some(0.2), lengthMeters = 200),
      street(12, osmWayId = 99L, regionId = 2, score = Some(0.9), lengthMeters = 200)
    )
    val rows = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(1))

    rows.map(r => (r.osmWayId, r.regionId)) should contain theSameElementsAs Seq((99L, 1), (99L, 2))
  }

  test("an unexplored edge adds its length but not its (absent) score, and an all-unexplored way has none") {
    val mixed = Seq(
      street(11, 99L, 1, score = Some(0.4), lengthMeters = 100),
      street(12, 99L, 1, score = None, lengthMeters = 300, auditCount = 0, clusters = 0)
    )
    val mixedRow = AccessScoreSpotlight.buildStreetRows(mixed, Map.empty, run, new Random(1)).head
    mixedRow.score.get shouldBe (0.4 +- 1e-9) // Only the explored 100 m is evidence...
    mixedRow.lengthM shouldBe (400.0 +- 1e-9) // ...but the row still says how long the whole stretch is.

    val untouched = Seq(street(13, 98L, 1, score = None, lengthMeters = 500, auditCount = 0, clusters = 0))
    AccessScoreSpotlight.buildStreetRows(untouched, Map.empty, run, new Random(1)).head.score shouldBe None
  }

  test("a way's counts are summed across its edges, validations included") {
    val streets = Seq(
      street(11, 99L, 1, Some(0.4), 200, auditCount = 2, clusters = 3),
      street(12, 99L, 1, Some(0.6), 200, auditCount = 1, clusters = 5)
    )
    val row = AccessScoreSpotlight.buildStreetRows(streets, Map(11 -> 7, 12 -> 2), run, new Random(1)).head

    row.auditCount shouldBe 3
    row.clusterCount shouldBe 8
    row.validationCount shouldBe 9
  }

  test("the tie-break is drawn per run, so one night's list is stable and the next night's is not") {
    val streets = (1 to 5).map(i => street(i, i.toLong, 1, Some(0.5), 200))
    val first   = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(42)).map(_.tieBreak)
    val again   = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(42)).map(_.tieBreak)
    val nextRun = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(43)).map(_.tieBreak)

    first shouldBe again        // Same seed, same order: the day's list does not reshuffle between page loads.
    first should not be nextRun // A new run redraws, so a tie is not frozen forever.
    all(first) should (be >= 0.0 and be < 1.0)
  }

  test("the rows a run writes do not depend on the hash order of the grouping") {
    val streets  = (1 to 20).map(i => street(i, i.toLong, 1, Some(0.5), 200))
    val forward  = AccessScoreSpotlight.buildStreetRows(streets, Map.empty, run, new Random(7))
    val shuffled =
      AccessScoreSpotlight.buildStreetRows(new Random(3).shuffle(streets), Map.empty, run, new Random(7))

    forward.map(r => (r.osmWayId, r.tieBreak)) shouldBe shuffled.map(r => (r.osmWayId, r.tieBreak))
  }

  // --- Ordering the lists. ---

  test("the lists are the best and the worst scores, in those directions") {
    val rows = Seq(
      regionRow(1, "Mid", Some(0.5), 0.9),
      regionRow(2, "Best", Some(0.9), 0.9),
      regionRow(3, "Worst", Some(0.1), 0.9)
    )
    AccessScoreSpotlight.rank(rows, descending = true, 2).map(_.asInstanceOf[RegionSpotlightRowForApi].name) shouldBe
      Seq("Best", "Mid")
    AccessScoreSpotlight.rank(rows, descending = false, 2).map(_.asInstanceOf[RegionSpotlightRowForApi].name) shouldBe
      Seq("Worst", "Mid")
  }

  test("streets that score alike are ordered by how well validated they are, in both lists") {
    // The whole point of the tie-break: in a city where many streets score the same, the well-checked one is the one
    // worth pointing at -- at the top of the best list and at the top of the worst list alike.
    val rows = Seq(
      streetRow(1L, 0.5, validationCount = 2),
      streetRow(2L, 0.5, validationCount = 40),
      streetRow(3L, 0.5, validationCount = 9)
    )

    AccessScoreSpotlight
      .rank(rows, descending = true, 3)
      .map(_.asInstanceOf[StreetSpotlightRowForApi].osmWayId) shouldBe
      Seq(2L, 3L, 1L)
    AccessScoreSpotlight
      .rank(rows, descending = false, 3)
      .map(_.asInstanceOf[StreetSpotlightRowForApi].osmWayId) shouldBe
      Seq(2L, 3L, 1L)
  }

  test("rows equal on score and validations keep one order, so the list does not churn between requests") {
    val rows  = Seq(streetRow(3L, 0.5, 1), streetRow(1L, 0.5, 1), streetRow(2L, 0.5, 1))
    val once  = AccessScoreSpotlight.rank(rows, descending = true, 3)
    val twice = AccessScoreSpotlight.rank(new Random(5).shuffle(rows), descending = true, 3)

    once.map(_.asInstanceOf[StreetSpotlightRowForApi].osmWayId) shouldBe
      twice.map(_.asInstanceOf[StreetSpotlightRowForApi].osmWayId)
  }

  test("a cross-city merge ranks the cities' rows against each other, not within each city") {
    val seattle = SpotlightCityForApi("seattle-wa", "Seattle", "https://sidewalk-sea.cs.washington.edu")
    val cdmx    = SpotlightCityForApi("mexico-city", "Mexico City", "https://sidewalk-cdmx.cs.washington.edu")
    val rows    = Seq(
      regionRow(1, "Seattle mid", Some(0.5), 0.9, Some(seattle)),
      regionRow(1, "CDMX best", Some(0.95), 0.9, Some(cdmx)),
      regionRow(2, "Seattle best", Some(0.8), 0.9, Some(seattle))
    )
    val top = AccessScoreSpotlight.rank(rows, descending = true, 2).map(_.asInstanceOf[RegionSpotlightRowForApi])

    top.map(_.name) shouldBe Seq("CDMX best", "Seattle best")
    top.head.city.map(_.cityId) shouldBe Some("mexico-city")
  }

  test("two cities' rows can share a region id without colliding in the ordering") {
    // region_id is per-schema, so a cross-city list routinely holds several rows with the same one.
    val a    = SpotlightCityForApi("a-city", "A", "https://a.example")
    val b    = SpotlightCityForApi("b-city", "B", "https://b.example")
    val rows = Seq(regionRow(1, "A one", Some(0.5), 0.9, Some(a)), regionRow(1, "B one", Some(0.5), 0.9, Some(b)))

    AccessScoreSpotlight.rank(rows, descending = true, 5) should have size 2
  }

  // --- The "closest to being ranked" call to action. ---

  test("nearest lists the unranked regions best-explored first, and never a ranked one") {
    val rows = Seq(
      regionRow(1, "Ranked", Some(0.6), 0.9),
      regionRow(2, "Riverside", Some(0.4), 0.67),
      regionRow(3, "Oradell Manor", None, 0.54),
      regionRow(4, "Soldier Hill", None, 0.41)
    )
    val nearest = AccessScoreSpotlight.nearest(rows, minCompletion = 0.8, n = 2)

    nearest.map(_.name) shouldBe Seq("Riverside", "Oradell Manor")
  }

  test("nearest is capped at n, so the CTA stays a short list rather than the whole city") {
    val rows = (1 to 20).map(i => regionRow(i, s"Region $i", None, i / 100.0))
    AccessScoreSpotlight.nearest(rows, minCompletion = 0.8, n = 5) should have size 5
  }
}
