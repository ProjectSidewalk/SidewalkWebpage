package models.report

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}
import models.label.LabelType
import models.region.NamedRegionCompletion
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.i18n.{DefaultMessagesApi, Lang, Messages, MessagesImpl}
import play.api.libs.json.{JsNull, JsValue, Json}
import play.api.test.FakeRequest
import play.api.mvc.RequestHeader
import service.{AccessScoreCalculator, AccessScoreSpotlight, AccessScores, ReportService}

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
    tallies.map(CityTallies(_, now.minusHours(3))),
    now
  )

  private def row(report: CityReport, region: Int): CityReportRow = report.rows.find(_.regionId == region).get

  /** Messages in a measurement system, with the few the formatting below fills in; any other key reads as itself. */
  private def messagesIn(system: String): Messages = MessagesImpl(
    Lang("en"),
    DefaultMessagesApi(
      Map(
        "default" -> Map(
          "measurement.system"          -> system,
          "unit.distance.abbr.metric"   -> "km",
          "unit.distance.abbr.imperial" -> "mi",
          "report.city.togo"            -> "{0} to go",
          "report.city.why.sofar.none"  -> "Nothing in {0}%"
        )
      )
    )
  )

  private given RequestHeader = FakeRequest()

  /** @return The page's client data for one region's row. */
  private def clientRow(report: CityReport, region: Int)(using Messages): JsValue =
    (CityReportClientData
      .toJson(report, Json.obj()) \ "rows").as[Seq[JsValue]].find(r => (r \ "id").as[Int] == region).get

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
    // Nobody knows yet which of them lacks a score, so none of them asks for help.
    waiting.rows.map(_.helpExplore) shouldBe Seq(false, false)
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
    waiting.qualityCountedAt shouldBe None
    row(waiting, 8).quality shouldBe None
    // A ready tally carries its own time, not the page's: it is cached for hours.
    report.qualityCountedAt shouldBe Some(now.minusHours(3))
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

  test("scales bars from the scored rows, so a barely explored region can't shrink them, and fits its own bar") {
    val report = build(
      Seq(1, 2, 3),
      Seq(completion(1, 900), completion(2, 900), completion(3, 50)),
      Some(
        AccessScores(
          Seq(
            street(1, 1, terms = Map("Obstacle" -> -0.4)),
            street(2, 2, terms = Map("Obstacle" -> -0.2)),
            // One explored street with severe problems: its mean is far past any scored row's.
            street(3, 3, terms = Map("NoSidewalk" -> -3.0, "Obstacle" -> -1.0))
          ),
          Seq.empty
        )
      )
    )
    row(report, 3).provisional shouldBe true
    report.barScale shouldBe (0.4 +- 1e-9)
    report.barShares(row(report, 1)).map(_._2).sum shouldBe (1.0 +- 1e-9)
    report.barShares(row(report, 2)).map(_._2).sum shouldBe (0.5 +- 1e-9)
    // The provisional bar fills the width exactly, its mix kept: three parts to one.
    val provisional = report.barShares(row(report, 3))
    provisional.map(_._1) shouldBe Seq("NoSidewalk", "Obstacle")
    provisional.map(_._2).sum shouldBe (1.0 +- 1e-9)
    provisional.head._2 / provisional(1)._2 shouldBe (3.0 +- 1e-9)
  }

  test("takes the scale from provisional rows when no scored row has a cause, and is 0 with none at all") {
    val terms   = Map("Obstacle" -> -0.6)
    val onlyNew = build(
      Seq(1, 2),
      Seq(completion(1, 100), completion(2, 100)),
      Some(AccessScores(Seq(street(1, 1, terms = terms), street(2, 2, terms = Map("Obstacle" -> -0.3))), Seq.empty))
    )
    onlyNew.scoredRows shouldBe empty
    onlyNew.barScale shouldBe (0.6 +- 1e-9)
    onlyNew.barShares(row(onlyNew, 2)).map(_._2).sum shouldBe (0.5 +- 1e-9)
    val nothing = build(Seq(1), Seq(completion(1, 900)), Some(AccessScores(Seq(street(1, 1)), Seq.empty)))
    nothing.barScale shouldBe 0.0
    nothing.barShares(row(nothing, 1)) shouldBe empty
  }

  test("breaks a tie between causes by the canonical type order, whichever order the terms arrive in") {
    val order  = AccessScoreCalculator.orderedScoredTypes
    val (a, b) = (order.head, order(1))
    CityReport.causesOf(Map(b -> -0.5, a -> -0.5)).map(_._1) shouldBe Seq(a, b)
    CityReport.causesOf(Map(a -> -0.5, b -> -0.5)).map(_._1) shouldBe Seq(a, b)
  }

  test("measures what is left to explore to the floor itself, and states it rounded up, never as nothing") {
    val report = build(Seq(1), Seq(completion(1, 300, total = 1000)), Some(AccessScores(Seq.empty, Seq.empty)))
    row(report, 1).metersToFloor shouldBe (AccessScoreSpotlight.MinRegionCompletion * 1000 - 300 +- 1e-9)

    // 79.4% of 3 km leaves 18 m: a tenth of a kilometer, not 0.0.
    val close = build(Seq(2), Seq(completion(2, 2382, total = 3000)), Some(AccessScores(Seq.empty, Seq.empty)))
    row(close, 2).score.score shouldBe None
    CityReportFormat.toGo(row(close, 2))(using summon[RequestHeader], messagesIn("metric")) shouldBe
      Some("0.1 km to go")
    // A scored region has nothing to go.
    val past = build(Seq(3), Seq(completion(3, 900)), Some(AccessScores(Seq(street(1, 3)), Seq.empty)))
    CityReportFormat.toGo(row(past, 3))(using summon[RequestHeader], messagesIn("metric")) shouldBe None
  }

  test("says a region with no streets has none, and doesn't call a partly explored one with no score unexplored") {
    given Messages = messagesIn("metric")
    val noStreets  = build(Seq(6), Seq(completion(6, 0, total = 0)), Some(AccessScores(Seq.empty, Seq.empty)))
    CityReportFormat.why(row(noStreets, 6), scoresReady = true) shouldBe "report.city.why.nostreets"
    CityReportFormat.why(row(noStreets, 6), scoresReady = false) shouldBe "report.city.why.computing"

    val unexplored = build(Seq(4), Seq(completion(4, 0)), Some(AccessScores(Seq.empty, Seq.empty)))
    CityReportFormat.why(row(unexplored, 4), scoresReady = true) shouldBe "report.city.why.unexplored"

    // Explored past the floor, but its streets carry no score: not unexplored, and more exploring won't score it.
    val unscorable = build(Seq(5), Seq(completion(5, 1000)), Some(AccessScores(Seq.empty, Seq.empty)))
    row(unscorable, 5).score.score shouldBe None
    row(unscorable, 5).helpExplore shouldBe false
    CityReportFormat.why(row(unscorable, 5), scoresReady = true) shouldBe "Nothing in 100%"
  }

  test("gives the browser a link to Explore only for a region that asks for help, and no completion without streets") {
    given Messages = messagesIn("metric")
    val report     = build(
      Seq(1, 2, 3),
      Seq(completion(1, 900), completion(2, 100), completion(3, 0, total = 0)),
      Some(AccessScores(Seq(street(1, 1)), Seq.empty))
    )
    row(report, 1).helpExplore shouldBe false
    row(report, 2).helpExplore shouldBe true
    (clientRow(report, 1) \ "explore").toOption.getOrElse(JsNull) shouldBe JsNull
    (clientRow(report, 2) \ "explore").as[String] shouldBe ReportLinks.explore(2)
    (clientRow(report, 3) \ "explore").toOption.getOrElse(JsNull) shouldBe JsNull

    (clientRow(report, 2) \ "completion").as[Double] shouldBe (0.1 +- 1e-9)
    // A region with no streets is vacuously complete to AccessScore; sorted by Explored it must not come first.
    (clientRow(report, 3) \ "completion").toOption.getOrElse(JsNull) shouldBe JsNull
  }

  test("states observation density per explored kilometer or per explored mile, as the reader's units have it") {
    val tally  = Seq(label(1, "a"), label(2, "b")).foldLeft(CoverageTally.empty)(_.add(_))
    val report = build(Seq(8), Seq(completion(8, 500)), Some(AccessScores(Seq.empty, Seq.empty)), Some(Map(8 -> tally)))
    val quality = row(report, 8).quality.get
    // Two observations over half a kilometer.
    CityReportFormat.density(quality)(using summon[RequestHeader], messagesIn("metric")).get shouldBe (4.0 +- 1e-9)
    // A mile is 1.609344 km, so as many per explored mile is that many times more.
    CityReportFormat.density(quality)(using summon[RequestHeader], messagesIn("imperial")).get shouldBe
      (4.0 * 1.609344 +- 1e-4)
  }

  test("dates a month in each language's own form, as the report does") {
    val october = LocalDate.of(2026, 10, 4)
    CityReportFormat.month(october)(using MessagesImpl(Lang("en"), DefaultMessagesApi())) shouldBe "Oct 2026"
    // Not "10月 2026", which a fixed "MMM yyyy" gives.
    CityReportFormat.month(october)(using MessagesImpl(Lang("zh-TW"), DefaultMessagesApi())) shouldBe "2026年10月"
  }
}
