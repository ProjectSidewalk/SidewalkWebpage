package models.report

import models.api.StreetAccessScoreForApi
import models.label.LabelType
import models.label.LabelType.*
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import service.{AccessScoreCalculator, AccessScoreSpotlight}

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}
import scala.util.Random

/**
 * The rules behind a neighborhood report (#5876), with no database attached. Every fixture street is scored by the
 * engine itself, so the parts that recompute a score are held to the number the engine published.
 */
class ReportRulesSpec extends AnyFunSuite with Matchers {
  private val created: OffsetDateTime          = OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.UTC)
  private val noCrop: ReportLabel => Boolean   = _ => false
  private val allCrops: ReportLabel => Boolean = _ => true
  private val line                             =
    GeometryFactory().createLineString(Array(Coordinate(-122.3, 47.6), Coordinate(-122.31, 47.61)))

  private def label(
      id: Int,
      labelType: LabelType = Obstacle,
      severity: Option[Int] = Some(3),
      tags: List[String] = Nil,
      edge: Int = 1,
      correct: Option[Boolean] = None,
      agree: Int = 0,
      disagree: Int = 0,
      unsure: Int = 0,
      user: String = "u1",
      capture: Option[String] = Some("2024-05")
  ): ReportLabel = ReportLabel(
    id,
    labelType,
    severity,
    tags,
    edge,
    user,
    s"pano$id",
    created,
    correct,
    agree,
    disagree,
    unsure,
    capture,
    None,
    None,
    None,
    None
  )

  private def loc(
      id: Int,
      labelType: LabelType = Obstacle,
      severity: Option[Int] = Some(3),
      edge: Int = 1,
      crossing: Option[Int] = None,
      labelIds: Option[Seq[Int]] = None,
      tags: Map[String, Int] = Map.empty
  ): ReportLocation =
    ReportLocation(id, labelType, severity, edge, crossing, labelIds.getOrElse(Seq(id * 10)), tags, 47.6, -122.3)

  /** A street as the engine would publish it from these locations, so a test can't pass on numbers it made up. */
  private def edge(
      id: Int,
      evidence: ReportEvidence,
      way: Long = 1L,
      name: Option[String] = Some("A St"),
      length: Double = 200.0,
      audits: Int = 1,
      start: Option[Int] = None,
      end: Option[Int] = None,
      slopeTerm: Double = 0.0
  ): StreetAccessScoreForApi = {
    val block                = evidence.block(id)
    val inputs               = block.map(_.scoreInput)
    def end_(i: Option[Int]) = i.map(x => AccessScoreCalculator.scoreStreet(evidence.crossing(x).map(_.scoreInput)))
    val segment = Option.when(audits > 0)(AccessScoreCalculator.headlineFromClusters(inputs, length, slopeTerm, Nil))
    StreetAccessScoreForApi(
      streetEdgeId = id,
      osmWayId = way,
      streetName = name,
      regionId = 1,
      score = AccessScoreCalculator.headlineScore(segment, Seq(end_(start), end_(end)).flatten),
      segmentScore = segment,
      startIntersectionId = start,
      endIntersectionId = end,
      startIntersectionScore = end_(start),
      endIntersectionScore = end_(end),
      auditCount = audits,
      lengthMeters = length,
      labelCount = block.map(_.labelIds.size).sum,
      clusterCounts = block.groupBy(_.labelType.name).map { case (t, ls) => t -> ls.size },
      subScores = AccessScoreCalculator.scoreByType(inputs, Some(length)),
      severityCounts = Map.empty,
      tagAdjustments = Map.empty,
      gradient = None,
      slopeTerm = slopeTerm,
      geometry = line
    )
  }

  private def stretch(edges: Seq[StreetAccessScoreForApi], evidence: ReportEvidence): ReportStretch =
    ReportStretch.build(edges, evidence).get

  /** A ranked stretch with three obstacles along its one block, from `first` up, on its own edge. */
  private def street(name: String, way: Long, first: Int, severity: Int = 3): (ReportStretch, ReportEvidence) = {
    val evidence = ReportEvidence((first until first + 3).map(i => loc(i, severity = Some(severity), edge = way.toInt)))
    stretch(Seq(edge(way.toInt, evidence, way = way, name = Some(name))), evidence) -> evidence
  }

  // ---- Rolling edges up ------------------------------------------------------------------------------------------

  test("a stretch is the length-weighted mean of its explored edges, as Spotlight rolls up a fully explored way") {
    val evidence  = ReportEvidence(Seq(loc(1, edge = 1), loc(2, edge = 1), loc(3, edge = 1)))
    val edges     = Seq(edge(1, evidence, length = 300), edge(2, evidence, length = 100))
    val s         = stretch(edges, evidence)
    val spotlight = AccessScoreSpotlight.buildStreetRows(edges, Map.empty, created, new Random(1)).head
    s.score shouldBe spotlight.score.get
    s.toolEdgeId shouldBe spotlight.streetEdgeId
    s.totalMeters shouldBe spotlight.lengthM
    s.blockLocationCount shouldBe spotlight.clusterCount
    s.isRanked shouldBe true
  }

  test("an unexplored edge adds length but no score, though its crossings alone would give it a published one") {
    val evidence   = ReportEvidence(Seq(loc(1, CurbRamp, Some(1), edge = 2, crossing = Some(9))))
    val explored   = edge(1, evidence, length = 100)
    val walkedPast = edge(2, evidence, length = 900, audits = 0, end = Some(9))
    walkedPast.score shouldBe defined
    val s = stretch(Seq(explored, walkedPast), evidence)
    s.score shouldBe explored.score.get
    s.exploredMeters shouldBe 100.0
    s.totalMeters shouldBe 1000.0
    s.toolEdgeId shouldBe 1
    s.locations shouldBe empty
  }

  test("a way nobody has explored has no stretch") {
    val evidence = ReportEvidence(Seq.empty)
    ReportStretch.build(Seq(edge(1, evidence, audits = 0)), evidence) shouldBe None
  }

  test("block and crossing numbers roll up by length, and a stretch with no scored crossing has no crossing number") {
    val evidence =
      ReportEvidence(Seq(loc(1, NoCurbRamp, crossing = Some(9)), loc(2, CurbRamp, Some(1), crossing = Some(8))))
    val a = edge(1, evidence, length = 300, start = Some(9))
    val b = edge(2, evidence, length = 100, start = Some(8), end = Some(9))
    val s = stretch(Seq(a, b), evidence)
    s.blockScore.get shouldBe 0.5
    val meanB = (b.startIntersectionScore.get + b.endIntersectionScore.get) / 2
    s.crossingScore.get shouldBe ((a.startIntersectionScore.get * 300 + meanB * 100) / 400 +- 1e-12)
    stretch(Seq(edge(3, evidence)), evidence).crossingScore shouldBe None
  }

  test("slope is stated in points off the published score, and not at all when it costs nothing") {
    val evidence = ReportEvidence(Seq.empty)
    val steep    = edge(1, evidence, slopeTerm = -1.0)
    val points   = stretch(Seq(steep), evidence).slopePoints.get
    points shouldBe ((0.5 - steep.score.get) * 100 +- 1e-9)
    stretch(Seq(edge(1, evidence)), evidence).slopePoints shouldBe None
  }

  // ---- What costs a street the most ------------------------------------------------------------------------------

  test("removing nothing rebuilds the published score exactly, block, crossing and slope together") {
    val evidence = ReportEvidence(
      Seq(
        loc(1, edge = 1),
        loc(2, NoSidewalk, None, edge = 1),
        loc(3, NoCurbRamp, crossing = Some(9), edge = 77),
        loc(4, CurbRamp, Some(1), crossing = Some(9), edge = 1)
      )
    )
    val e       = edge(1, evidence, start = Some(9), slopeTerm = -0.4)
    val rebuilt = AccessScoreCalculator.headlineFromClusters(
      evidence.block(1).map(_.scoreInput),
      e.lengthMeters,
      e.slopeTerm,
      Seq(evidence.crossing(9).map(_.scoreInput))
    )
    rebuilt shouldBe e.score.get
  }

  test("an item's cost is how far the stretch's own score rises without it, and a helpful feature isn't an item") {
    val hazard   = loc(1, edge = 1)
    val ramp     = loc(2, CurbRamp, Some(1), edge = 1)
    val evidence = ReportEvidence(Seq(hazard, ramp))
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    val without  = ReportEvidence(Seq(ramp))
    s.items.map(_.locations.map(_.clusterId)) shouldBe Seq(Seq(1))
    s.items.head.costPoints shouldBe ((edge(1, without).score.get - edge(1, evidence).score.get) * 100 +- 1e-9)
  }

  test("a crossing's location is priced through every edge of the stretch meeting there, wherever it was labeled") {
    val shared   = loc(1, NoCurbRamp, edge = 77, crossing = Some(9))
    val evidence = ReportEvidence(Seq(shared))
    val edges    = Seq(edge(1, evidence, length = 100, end = Some(9)), edge(2, evidence, length = 100, start = Some(9)))
    val s        = stretch(edges, evidence)
    val clear    = ReportEvidence(Seq.empty)
    val expected = (0.5 - edges.head.score.get) * 100
    clear.crossing(9) shouldBe empty
    s.items.head.costPoints shouldBe (expected +- 1e-9)
    s.locations shouldBe Seq(shared)
  }

  test("one block's missing-sidewalk pins are one item, since most single pins move nothing once the pool saturates") {
    val pins     = (1 to 6).map(i => loc(i, NoSidewalk, None, edge = 1))
    val evidence = ReportEvidence(pins)
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    s.items.size shouldBe 1
    s.items.head.locations.map(_.clusterId) should contain theSameElementsAs (1 to 6)
    s.items.head.costPoints should be > 1.0
    AccessScoreCalculator.scoreStreet(pins.tail.map(_.scoreInput), Some(200.0)) shouldBe
      AccessScoreCalculator.scoreStreet(pins.map(_.scoreInput), Some(200.0))
  }

  test("two blocks' pools are two items") {
    val evidence = ReportEvidence(
      (1 to 3).map(i => loc(i, NoSidewalk, None, edge = 1)) ++ (4 to 6).map(i => loc(i, NoSidewalk, None, edge = 2))
    )
    stretch(Seq(edge(1, evidence), edge(2, evidence)), evidence).items.size shouldBe 2
  }

  test("items run costliest first, with a stable order between equals") {
    val evidence = ReportEvidence(Seq(loc(5, severity = Some(1)), loc(2), loc(1)))
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    s.items.map(_.locations.head.clusterId) shouldBe Seq(1, 2, 5)
  }

  // ---- Streets ---------------------------------------------------------------------------------------------------

  test("a street is listed once, at its lowest ranked stretch, and the whole street's number sits beside it") {
    val (low, _)  = street("NW 61st St", 1, 1, severity = 3)
    val (high, _) = street("NW 61st St", 2, 10, severity = 1)
    val ranked    = ReportStreet.rank(Seq(high, low))
    ranked.size shouldBe 1
    ranked.head.worst shouldBe low
    ranked.head.stretchCount shouldBe 2
    ranked.head.wholeScore shouldBe ((low.score + high.score) / 2 +- 1e-12)
    ranked.head.wholeExploredMeters shouldBe 400.0
  }

  test("a whole-street average never hides a street whose lowest stretch ranks it") {
    val (low, _)    = street("Mixed St", 1, 1)
    val empty       = ReportEvidence(Seq.empty)
    val longAndFine = stretch(Seq(edge(2, empty, way = 2, name = Some("Mixed St"), length = 5000)), empty)
    val (middle, _) = street("Other St", 3, 10, severity = 2)
    val ranked      = ReportStreet.rank(Seq(longAndFine, low, middle))
    ranked.head.wholeScore should be > middle.score
    ranked.map(_.worst.name.get) shouldBe Seq("Mixed St", "Other St")
  }

  test("names that differ only in case are one street, and unnamed ways stay apart") {
    val (a, _) = street("Oak St", 1, 1)
    val (b, _) = street("OAK ST", 2, 10)
    ReportStreet.rank(Seq(a, b)).size shouldBe 1
    val (c, _) = street("x", 3, 20)
    val (d, _) = street("x", 4, 30)
    ReportStreet.rank(Seq(c.copy(name = None), d.copy(name = None))).size shouldBe 2
  }

  test("Spotlight's bars decide what's ranked, and a stretch under them can't stand for its street") {
    val empty    = ReportEvidence(Seq.empty)
    val tooShort = stretch(Seq(edge(1, empty, way = 1, length = 99)), empty)
    val twoPins  = ReportEvidence(Seq(loc(1, edge = 2), loc(2, edge = 2)))
    val thin     = stretch(Seq(edge(2, twoPins, way = 2)), twoPins)
    val walkedOk = stretch(Seq(edge(3, empty, way = 3)), empty)
    tooShort.isRanked shouldBe false
    thin.isRanked shouldBe false
    walkedOk.isRanked shouldBe true
    val (ranked, _) = street("A St", 4, 10, severity = 1)
    ReportStreet.rank(Seq(tooShort, ranked)).head.worst.osmWayId shouldBe 4L
  }

  test("the evidence bar counts locations along the block, not at the crossings the row also shows") {
    val evidence = ReportEvidence(
      Seq(
        loc(1, NoCurbRamp, crossing = Some(9)),
        loc(2, NoCurbRamp, crossing = Some(9)),
        loc(3, NoCurbRamp, crossing = Some(9)),
        loc(4, edge = 1)
      )
    )
    val s = stretch(Seq(edge(1, evidence, start = Some(9))), evidence)
    s.locations.size shouldBe 4
    s.blockLocationCount shouldBe 1
    s.isRanked shouldBe false
  }

  test("ties go to the longer explored stretch, then the name, then the way, so two loads agree") {
    val empty                                      = ReportEvidence(Seq.empty)
    def s(way: Long, name: String, length: Double) =
      stretch(Seq(edge(way.toInt, empty, way = way, name = Some(name), length = length)), empty)
    val order = ReportStreet.rank(Seq(s(1, "Beta", 200), s(2, "Alpha", 200), s(3, "Gamma", 900)))
    order.map(_.worst.name.get) shouldBe Seq("Gamma", "Alpha", "Beta")
  }

  // ---- Photos and fixes ------------------------------------------------------------------------------------------

  test("a photo is one a reader would rate as the score does: the median's rating, with a crop, confirmed first") {
    val location = loc(1, severity = Some(3), labelIds = Some(Seq(1, 2, 3, 4)))
    val labels   = Map(
      1 -> label(1, severity = Some(1), agree = 9),
      2 -> label(2, severity = Some(3), agree = 0),
      3 -> label(3, severity = Some(3), agree = 2),
      4 -> label(4, severity = Some(3), agree = 5)
    )
    val item = ReportItem(Seq(location), 3.0)
    ReportRules.representative(item, labels, allCrops).map(_.labelId) shouldBe Some(4)
    ReportRules.representative(item, labels, l => l.labelId == 2).map(_.labelId) shouldBe Some(2)
    ReportRules.representative(item, labels - 2 - 3 - 4, allCrops).map(_.labelId) shouldBe Some(1)
    ReportRules.representative(item, Map.empty, allCrops) shouldBe None
  }

  test("a street's cards hold one per location, by each one's share of what its item costs") {
    val evidence = ReportEvidence(Seq(loc(1), loc(2, severity = Some(2)), loc(3, severity = Some(1))))
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    val labels   = Map(10 -> label(10), 20 -> label(20, severity = Some(2)), 30 -> label(30, severity = Some(1)))
    val cards    = ReportRules.cards(s, labels, allCrops)
    cards.map(_.location.clusterId).toSet shouldBe s.locations.map(_.clusterId).toSet
    val shares = cards.map(c => c.costPoints / c.poolSize)
    shares shouldBe shares.sorted.reverse
    cards.foreach(c => c.location.labelIds should contain(c.label.labelId))
  }

  test("a location with no label left to show has no card, and the street's other locations keep theirs") {
    val evidence = ReportEvidence(Seq(loc(1), loc(2, severity = Some(2))))
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    ReportRules.cards(s, Map(20 -> label(20, severity = Some(2))), allCrops).map(_.label.labelId) shouldBe Seq(20)
  }

  private def rankedStreet(name: String, way: Long, first: Int, severity: Int = 3): (ReportStreet, ReportStretch) = {
    val (s, _) = street(name, way, first, severity)
    ReportStreet(s, s.score, s.exploredMeters, 1) -> s
  }

  test("the fixes walk the ranked streets, one per street, each its costliest item a reviewer has backed") {
    val (a, sa) = rankedStreet("A St", 1, 1)
    val (b, sb) = rankedStreet("B St", 2, 10)
    val labels  = (sa.locations ++ sb.locations).flatMap(_.labelIds).map(id => id -> label(id, agree = 1)).toMap
    val picks   = ReportRules.fixes(Seq(a, b), labels, 5, allCrops)
    picks.map(_._1) shouldBe Seq(a, b)
    picks.map(_._2).map(_.costPoints) shouldBe Seq(sa.items.head.costPoints, sb.items.head.costPoints)
    ReportRules.fixes(Seq(a, b), labels, 1, allCrops).size shouldBe 1
  }

  test("a fix needs a human backing it: an unreviewed or contested label doesn't qualify") {
    val (a, sa) = rankedStreet("A St", 1, 1)
    val ids     = sa.locations.flatMap(_.labelIds)
    ReportRules.fixes(Seq(a), ids.map(id => id -> label(id)).toMap, 5, allCrops) shouldBe empty
    ReportRules.fixes(Seq(a), ids.map(id => id -> label(id, agree = 3, disagree = 1)).toMap, 5, allCrops) shouldBe empty
  }

  test("a fix must be rated at or next to the worst, and cost enough to matter") {
    val (mild, s) = rankedStreet("A St", 1, 1, severity = 1)
    val labels    = s.locations.flatMap(_.labelIds).map(id => id -> label(id, severity = Some(1), agree = 1)).toMap
    s.items.head.costPoints should be >= ReportRules.FixMinPoints
    ReportRules.fixes(Seq(mild), labels, 5, allCrops) shouldBe empty

    val severe = s.items.map(i => ReportItem(i.locations.map(_.copy(severity = Some(3))), ReportRules.FixMinPoints / 2))
    val cheap  = s.copy(items = severe)
    ReportRules.fixes(Seq(mild.copy(worst = cheap)), labels, 5, allCrops) shouldBe empty
  }

  test("a crossing two ranked streets share is the pick of the first, and the second falls to its next item") {
    val shared   = loc(1, NoCurbRamp, crossing = Some(9), edge = 77)
    val mine     = loc(2, NoCurbRamp, severity = Some(2), crossing = Some(8), edge = 2)
    val evidence = ReportEvidence(Seq(shared, mine))
    val first    = stretch(Seq(edge(1, evidence, way = 1, name = Some("A St"), start = Some(9))), evidence)
    val second = stretch(Seq(edge(2, evidence, way = 2, name = Some("B St"), start = Some(9), end = Some(8))), evidence)
    val labels = Map(10 -> label(10, NoCurbRamp, agree = 1), 20 -> label(20, NoCurbRamp, Some(2), agree = 1))
    val picks  = ReportRules.fixes(
      Seq(ReportStreet(first, first.score, 200, 1), ReportStreet(second, second.score, 200, 1)),
      labels,
      5,
      allCrops
    )
    picks.map(_._3.labelId) shouldBe Seq(10, 20)
  }

  test("an unrated type can be a fix, shown through a pin a reviewer backed") {
    val pins     = (1 to 3).map(i => loc(i, NoSidewalk, None, edge = 1))
    val evidence = ReportEvidence(pins)
    val s        = stretch(Seq(edge(1, evidence)), evidence)
    val labels   = Map(
      10 -> label(10, NoSidewalk, None),
      20 -> label(20, NoSidewalk, None, agree = 2),
      30 -> label(30, NoSidewalk, None)
    )
    val picks = ReportRules.fixes(Seq(ReportStreet(s, s.score, 200, 1)), labels, 5, noCrop)
    picks.map(_._3.labelId) shouldBe Seq(20)
    picks.head._2.locations.size shouldBe 3
  }

  // ---- Headlines -------------------------------------------------------------------------------------------------

  private val ownStreet: Int => Any = identity

  test("the no-alternate-route headline needs enough of them, counted by location with the tag held by most labels") {
    val noWay    = (1 to 5).map(i => loc(i, NoCurbRamp, tags = Map(ReportRules.NoAlternateRouteTag -> 1)))
    val withWay  = (6 to 9).map(i => loc(i, NoCurbRamp))
    val headline = HeadlineRule.select(noWay ++ withWay, ownStreet, 10)
    headline.key shouldBe "report.headline.noalternate"
    headline.args shouldBe Seq(2, 9, 5)
    headline.locationCount shouldBe 5
    headline.labelIds shouldBe noWay.flatMap(_.labelIds)

    HeadlineRule.select(noWay.take(4) ++ withWay, ownStreet, 10).key should not be "report.headline.noalternate"
    val minority = loc(1, NoCurbRamp, labelIds = Some(Seq(1, 2, 3)), tags = Map(ReportRules.NoAlternateRouteTag -> 1))
    minority.hasNoAlternateRoute shouldBe false
  }

  test("the missing-sidewalk headline counts streets, so that pins along one street can't inflate it") {
    val pinned = (1 to 40).map(i => loc(i, NoSidewalk, None, edge = 1))
    HeadlineRule.select(pinned, ownStreet, 4).key should not be "report.headline.nosidewalk"
    val spread   = (1 to 3).map(i => loc(i, NoSidewalk, None, edge = i))
    val headline = HeadlineRule.select(spread, ownStreet, 8)
    headline.key shouldBe "report.headline.nosidewalk"
    headline.args shouldBe Seq(3, 8)
    HeadlineRule.select(spread, ownStreet, 20).key should not be "report.headline.nosidewalk"
  }

  test("the concentration headline needs enough worst-rated locations on few streets") {
    val top      = (1 to 12).map(i => loc(i, edge = 1 + i % 3))
    val rest     = (100 to 110).map(i => loc(i, edge = i))
    val headline = HeadlineRule.select(top ++ rest, ownStreet, 30)
    headline.key shouldBe "report.headline.concentration"
    headline.args.head shouldBe HeadlineRule.ConcentrationStreets
    headline.args(1) shouldBe 52
    headline.locationCount shouldBe 12

    val evenlySpread = (1 to 40).map(i => loc(i, edge = i))
    HeadlineRule.select(evenlySpread, ownStreet, 40).key shouldBe "report.headline.worst"
  }

  test("a small region's headline counts its worst-rated locations, and says so plainly when it has none") {
    val few = HeadlineRule.select(Seq(loc(1, edge = 1), loc(2, edge = 1), loc(3, edge = 2)), ownStreet, 2)
    few.key shouldBe "report.headline.worst"
    few.args shouldBe Seq(3, 2)
    val none = HeadlineRule.select(Seq(loc(1, severity = Some(1))), ownStreet, 1)
    none.key shouldBe "report.headline.none"
    none.labelIds shouldBe empty
    HeadlineRule.select(Seq.empty, ownStreet, 0).key shouldBe "report.headline.none"
  }

  // ---- The neighborhood's number ---------------------------------------------------------------------------------

  test("a neighborhood's score is what AccessScore computes, stated only past the bar that ranks it") {
    val evidence = ReportEvidence(Seq(loc(1, edge = 1)))
    val streets  =
      Seq(edge(1, evidence, length = 300), edge(2, evidence, length = 100), edge(3, evidence, length = 900, audits = 0))
    val expected = AccessScoreCalculator.scoreRegion(streets.take(2).map(s => s.score.get -> s.lengthMeters))
    NeighborhoodScore.from(streets, 0.8).score shouldBe expected
    val under = NeighborhoodScore.from(streets, 0.79)
    under.score shouldBe None
    under.percentExplored shouldBe 79
    under.percentRequired shouldBe 80
    NeighborhoodScore.from(streets, 0.796).score shouldBe expected
  }

  // ---- Coverage and inventory ------------------------------------------------------------------------------------

  test("coverage counts people and human review, and reads imagery age from free-text capture dates") {
    val counted = Seq(
      label(1, user = "a", agree = 2, capture = Some("2015-06")),
      label(2, user = "a", disagree = 1, capture = Some("2022-02")),
      label(3, user = "b", unsure = 1, capture = Some("2024")),
      label(4, user = "c", capture = Some("not a date")),
      label(5, user = "c", capture = None)
    )
    val excluded = Seq(label(6, correct = Some(false)))
    val coverage = Coverage.from(counted, excluded, Seq.empty, 2000, 500, LocalDate.of(2026, 11, 1))
    coverage.percentAudited shouldBe 25
    coverage.observationIds shouldBe Seq(1, 2, 3, 4, 5)
    coverage.excludedIds shouldBe Seq(6)
    coverage.labelers shouldBe 3
    coverage.reviewedIds shouldBe Seq(1, 2, 3)
    coverage.confirmedIds shouldBe Seq(1)
    coverage.medianImageryYear shouldBe Some(2022)
    coverage.oldImageryPercent shouldBe Some(33)
  }

  test("coverage states which labels no score uses, leaving out types AccessScore doesn't score at all") {
    val counted  = Seq(label(1), label(2), label(3, Occlusion, None))
    val coverage =
      Coverage.from(counted, Seq.empty, Seq(loc(1, labelIds = Some(Seq(1)))), 100, 100, LocalDate.of(2026, 11, 1))
    coverage.unclusteredIds shouldBe Seq(2)
  }

  test("coverage of an empty region has no imagery figures and doesn't divide by zero") {
    val coverage = Coverage.from(Seq.empty, Seq.empty, Seq.empty, 0, 0, LocalDate.of(2026, 11, 1))
    coverage.percentAudited shouldBe 0
    coverage.medianImageryYear shouldBe None
    coverage.oldImageryPercent shouldBe None
    coverage.firstObservation shouldBe None
  }

  test("the inventory states labels and locations, canonically, with no worst count for an unrated type") {
    val rows = InventoryRow.from(
      Seq(
        label(1, NoSidewalk, None),
        label(2, Obstacle, tags = List("pole", "tree")),
        label(3, Obstacle, Some(1), tags = List("pole"), agree = 1),
        label(4, CurbRamp, Some(1)),
        label(5, Occlusion, None)
      ),
      Seq(loc(7, Obstacle, labelIds = Some(Seq(2, 3))))
    )
    rows.map(_.labelType) shouldBe Seq(CurbRamp, Obstacle, NoSidewalk, Occlusion)
    val obstacle = rows(1)
    obstacle.locations shouldBe Some((1, Seq(2, 3)))
    obstacle.observedIds shouldBe Seq(2, 3)
    obstacle.worstIds shouldBe Some(Seq(2))
    obstacle.confirmedIds shouldBe Seq(3)
    obstacle.topTags shouldBe Seq(("pole", 2), ("tree", 1))
    rows(2).worstIds shouldBe None
    rows(2).locations shouldBe Some((0, Seq.empty))
    rows(3).locations shouldBe None
  }

  // ---- A whole report -------------------------------------------------------------------------------------------

  test(
    "a report's rows, fixes and totals all describe the same locations, and a street over the bar still gives a fix"
  ) {
    val low    = (1 to 3).map(i => loc(i, edge = 1))
    val shared = loc(4, NoCurbRamp, edge = 99, crossing = Some(9))
    // Two good curb ramps keep this street over the listing bar, and few enough that its one problem still costs points.
    val high     = loc(5, SurfaceProblem, edge = 2) +: (6 to 7).map(i => loc(i, CurbRamp, Some(1), edge = 2))
    val all      = low ++ high :+ shared
    val evidence = ReportEvidence(all)
    val streets  = Seq(
      edge(1, evidence, way = 1, name = Some("Low St"), start = Some(9)),
      edge(2, evidence, way = 2, name = Some("High St"))
    )
    val labels =
      all.flatMap(l => l.labelIds.map(id => label(id, l.labelType, l.severity, agree = 1, edge = l.streetEdgeId)))
    val byId = labels.map(l => l.labelId -> l).toMap
    // The crossing's label sits on a street outside the region, so the region's own read doesn't return it.
    val (foreign, own) = labels.partition(_.streetEdgeId == 99)
    val data           = service.ReportData(
      Some(models.region.NamedRegionCompletion(1, "R", 1000.0, 900.0)),
      own,
      foreign,
      all
    )
    val selection = service.ReportService.select(streets, evidence, byId, noCrop)
    val report    = service.ReportService.assemble(
      1,
      "R",
      streets,
      all,
      streets.map(s => s.streetEdgeId -> ReportStreet.streetKey(s.streetName, s.osmWayId)).toMap,
      data,
      selection,
      None,
      created
    )

    report.streetsRanked shouldBe 2
    report.streets.map(_.street.worst.name.get) shouldBe Seq("Low St", "High St")
    val row = report.streets.head
    row.evidence.map(e => (e.labelType, e.locations)) shouldBe Seq((NoCurbRamp, 1), (Obstacle, 3))
    row.evidence.flatMap(_.labelIds) should contain theSameElementsAs (low :+ shared).flatMap(_.labelIds)
    row.cards.map(_.label.labelId).toSet.subsetOf(row.evidence.flatMap(_.labelIds).toSet) shouldBe true
    report.fixes.map(_.street.worst.name.get) should contain("High St")
    report.score.score shouldBe AccessScoreCalculator.scoreRegion(streets.map(s => s.score.get -> s.lengthMeters))
    report.coverage.observationIds should contain theSameElementsAs own.map(_.labelId)
    report.coverage.unclusteredIds shouldBe empty
    report.isProvisional shouldBe false
    report.evidenceBox shouldBe defined
  }

  // ---- Links -----------------------------------------------------------------------------------------------------

  test("a count's link lists exactly its labels up to the Gallery's cap, and only past that falls back to a filter") {
    ReportLinks.count(Seq(5, 9), "fallback") shouldBe "/gallery?labelIds=5,9"
    ReportLinks.count(1 to ReportLinks.MaxListedIds, "fallback") should startWith("/gallery?labelIds=1,2,")
    ReportLinks.count(1 to ReportLinks.MaxListedIds + 1, "fallback") shouldBe "fallback"
  }

  test("a Gallery filter selects what the report counts, leaving out only labels marked incorrect") {
    ReportLinks.galleryFilter(7, Some(Obstacle), Seq(3)) shouldBe
      "/gallery?regions=7&labelType=Obstacle&severities=3&validationOptions=correct,unsure,unvalidated"
    ReportLinks.worstFilter(7) should include("severities=3&")
  }

  test("a street's score links to it in the tool, and its data links can reproduce the page") {
    ReportLinks.accessScoreStreet(12) shouldBe "/accessScore?unit=streets&sel=12"
    ReportLinks.streetsCsv(7) shouldBe "/v3/api/accessScoreStreets?regionId=7&filetype=csv"
    ReportLinks.clustersCsv(models.utils.LatLngBBox(1.0, 2.0, 3.0, 4.0)) shouldBe
      "/v3/api/labelClusters?bbox=2.0,1.0,4.0,3.0&filetype=csv"
  }

  test("a preset falls back to the default for a missing or unknown value") {
    ReportPreset.fromParam(Some("coordinator")) shouldBe ReportPreset.Coordinator
    ReportPreset.fromParam(Some("advocate")) shouldBe ReportPreset.Advocate
    ReportPreset.fromParam(Some("<script>")) shouldBe ReportPreset.Advocate
    ReportPreset.fromParam(None) shouldBe ReportPreset.Advocate
  }
}
