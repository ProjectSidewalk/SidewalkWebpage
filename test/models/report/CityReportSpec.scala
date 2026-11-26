package models.report

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}
import models.label.LabelType
import models.region.NamedRegionCompletion
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import service.{AccessScoreSpotlight, AccessScores, ReportService}

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}

/**
 * The rows of the city reports page (#6041), with no database attached: which neighborhoods are scored, what lowers each
 * one's score, the order they're listed in, and the data-quality figures beside them.
 */
class CityReportSpec extends AnyFunSuite with Matchers {
  private val now  = OffsetDateTime.of(2026, 11, 26, 12, 0, 0, 0, ZoneOffset.UTC)
  private val gf   = GeometryFactory()
  private val line = gf.createLineString(Array(Coordinate(-122.3, 47.6), Coordinate(-122.31, 47.61)))

  private def street(
      id: Int,
      region: Int,
      score: Double = 0.6,
      audits: Int = 1,
      length: Double = 100.0,
      terms: Map[String, Double] = Map.empty
  ): StreetAccessScoreForApi = StreetAccessScoreForApi(
    id,
    id.toLong,
    Some(s"Street $id"),
    region,
    Some(score),
    Some(score),
    None,
    None,
    None,
    None,
    audits,
    length,
    0,
    Map.empty,
    terms,
    Map.empty,
    Map.empty,
    None,
    0.0,
    line
  )

  private def crossing(id: Int, region: Int, terms: Map[String, Double]): IntersectionAccessScoreForApi =
    IntersectionAccessScoreForApi(
      id,
      Some(region),
      3,
      false,
      Seq.empty,
      1,
      Some(0.5),
      0,
      Map.empty,
      terms,
      Map.empty,
      Map.empty,
      gf.createPoint(Coordinate(-122.3, 47.6))
    )

  private def completion(region: Int, audited: Double, total: Double = 1000.0) =
    NamedRegionCompletion(region, s"Region $region", total, audited)

  private def label(id: Int, user: String, agree: Int = 0): ReportLabel = ReportLabel(
    id,
    LabelType.Obstacle,
    Some(2),
    Nil,
    1,
    None,
    user,
    s"pano$id",
    OffsetDateTime.of(2026, 5, 4, 0, 0, 0, 0, ZoneOffset.UTC),
    None,
    agree,
    0,
    0,
    Some("2023-06"),
    None,
    None,
    None,
    None
  )

  private def build(
      regions: Seq[Int],
      completions: Seq[NamedRegionCompletion],
      scores: Option[AccessScores],
      tallies: Option[Map[Int, CoverageTally]] = Some(Map.empty)
  ): CityReport = CityReport.build(
    regions.map(r => r -> s"Region $r"),
    regions.map(r => r -> s"region-$r").toMap,
    completions,
    scores,
    tallies,
    now
  )

  private def row(report: CityReport, region: Int): CityReportRow = report.rows.find(_.regionId == region).get

  test("states a score at the completion floor and none just under it, as the neighborhood report does") {
    val streets = Seq(street(1, 1), street(2, 2))
    // The floor compares whole percents, so 80% explored is scored and 79% is not.
    val floor  = math.round(AccessScoreSpotlight.MinRegionCompletion * 1000).toDouble
    val report =
      build(Seq(1, 2), Seq(completion(1, floor), completion(2, floor - 10)), Some(AccessScores(streets, Seq.empty)))
    row(report, 1).score shouldBe NeighborhoodScore.from(Seq(streets.head), floor / 1000)
    row(report, 1).score.score shouldBe defined
    row(report, 2).score.score shouldBe None
    row(report, 2).score.percentExplored shouldBe math.round((floor - 10) / 10).toInt
    report.minCompletionPercent shouldBe math.round(AccessScoreSpotlight.MinRegionCompletion * 100).toInt
  }

  test("keeps the contributions of an unscored region that has explored streets, as a provisional bar") {
    val terms  = Map("NoCurbRamp" -> -0.4, "SurfaceProblem" -> -0.1, "CurbRamp" -> 0.3)
    val report = build(
      Seq(3),
      Seq(completion(3, 300)),
      Some(AccessScores(Seq(street(1, 3, terms = terms), street(2, 3, audits = 0)), Seq(crossing(9, 3, terms))))
    )
    val r = row(report, 3)
    r.score.score shouldBe None
    r.provisional shouldBe true
    r.contributions shouldBe ReportService.contributions(
      Seq(street(1, 3, terms = terms), street(2, 3, audits = 0)),
      Seq(crossing(9, 3, terms)),
      3
    )
    r.topTypes shouldBe Seq("NoCurbRamp", "SurfaceProblem")
    r.helpExplore shouldBe true
  }

  test("gives a region with no explored street no bar and no top types") {
    val report = build(Seq(4), Seq(completion(4, 0)), Some(AccessScores(Seq(street(1, 4, audits = 0)), Seq.empty)))
    val r      = row(report, 4)
    r.contributions shouldBe empty
    r.causes shouldBe empty
    r.topTypes shouldBe empty
    r.provisional shouldBe false
    r.helpExplore shouldBe true
  }

  test("names up to two types with negative terms, worst first, and none when nothing is negative") {
    def topOf(terms: Map[String, Double]) =
      row(build(Seq(5), Seq(completion(5, 900)), Some(AccessScores(Seq(street(1, 5, terms = terms)), Seq.empty))), 5)
    val two = topOf(Map("Obstacle" -> -0.1, "NoSidewalk" -> -0.9, "SurfaceProblem" -> -0.3, "CurbRamp" -> 0.4))
    two.topTypes shouldBe Seq("NoSidewalk", "SurfaceProblem")
    two.causes.map(_._1) shouldBe Seq("NoSidewalk", "SurfaceProblem", "Obstacle")
    topOf(Map("Obstacle" -> -0.2, "CurbRamp" -> 0.4)).topTypes shouldBe Seq("Obstacle")
    val none = topOf(Map("CurbRamp" -> 0.4, "Crosswalk" -> 0.2))
    none.topTypes shouldBe empty
    none.causes shouldBe empty
  }

  test("lists scored regions lowest first, then unscored ones most explored first, then regions with no streets") {
    val streets = Seq(
      street(1, 1, score = 0.7),
      street(2, 2, score = 0.3),
      street(3, 3, score = 0.5),
      street(4, 4, score = 0.5),
      street(5, 5, score = 0.5)
    )
    val report = build(
      Seq(1, 2, 3, 4, 5, 6),
      Seq(
        completion(1, 950),
        completion(2, 900),
        completion(3, 200),
        completion(4, 600),
        completion(5, 0),
        completion(6, 0, total = 0)
      ),
      Some(AccessScores(streets, Seq.empty))
    )
    report.rows.map(_.regionId) shouldBe Seq(2, 1, 4, 3, 5, 6)
    report.selected.map(_.regionId) shouldBe Some(2)
  }

  test("gives a region with no streets a row of its own: not scored, nothing to explore, never 100% explored") {
    val report = build(Seq(6), Seq(completion(6, 0, total = 0)), Some(AccessScores(Seq.empty, Seq.empty)))
    val r      = row(report, 6)
    r.hasStreets shouldBe false
    r.score.score shouldBe None
    r.helpExplore shouldBe false
    r.provisional shouldBe false
    // A region missing from the completion table has no streets either, rather than no row.
    row(build(Seq(7), Seq.empty, Some(AccessScores(Seq.empty, Seq.empty))), 7).hasStreets shouldBe false
  }

  test("lists every region it is given, with its slug, whether or not scores are ready") {
    val waiting = build(Seq(1, 2), Seq(completion(1, 900), completion(2, 100)), None)
    waiting.scoresReady shouldBe false
    waiting.rows.map(r => r.regionId -> r.slug).toSet shouldBe Set(1 -> "region-1", 2 -> "region-2")
    waiting.rows.flatMap(_.score.score) shouldBe empty
    waiting.rows.flatMap(_.contributions) shouldBe empty
  }

  test("divides observations by the explored distance, and says nothing of quality before it is ready") {
    val tally  = Seq(label(1, "a", agree = 1), label(2, "b"), label(3, "a")).foldLeft(CoverageTally.empty)(_.add(_))
    val report = build(
      Seq(8, 9),
      Seq(completion(8, 500), completion(9, 0)),
      Some(AccessScores(Seq.empty, Seq.empty)),
      Some(Map(8 -> tally))
    )
    val quality = row(report, 8).quality.get
    quality.observations shouldBe 3
    // Half a kilometer explored, so three observations is six per explored km, not three per km of street.
    quality.observationsPerKm shouldBe Some(6.0)
    quality.reviewedPercent shouldBe Some(33)
    quality.labelers shouldBe 2
    quality.lastObservation shouldBe Some(LocalDate.of(2026, 5, 4))
    quality.medianImageryYear shouldBe Some(2023)
    // Nothing explored: no rate to state, and no labels to count.
    row(report, 9).quality.get.observationsPerKm shouldBe None
    row(report, 9).quality.get.reviewedPercent shouldBe None

    val waiting = build(Seq(8), Seq(completion(8, 500)), Some(AccessScores(Seq.empty, Seq.empty)), None)
    waiting.qualityReady shouldBe false
    row(waiting, 8).quality shouldBe None
  }

  test("scales every bar against the city's largest total, so bars compare across rows") {
    val report = build(
      Seq(1, 2),
      Seq(completion(1, 900), completion(2, 900)),
      Some(
        AccessScores(
          Seq(
            street(1, 1, terms = Map("Obstacle" -> -0.2, "NoCurbRamp" -> -0.6)),
            street(2, 2, terms = Map("Obstacle" -> -0.4))
          ),
          Seq.empty
        )
      )
    )
    report.barScale shouldBe (0.8 +- 1e-9)
    row(report, 1).causes.map(_._2).sum / report.barScale shouldBe (1.0 +- 1e-9)
    row(report, 2).causes.map(_._2).sum / report.barScale shouldBe (0.5 +- 1e-9)
  }
}
