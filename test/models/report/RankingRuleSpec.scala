package models.report

import models.label.LabelType
import models.label.LabelType.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}

/**
 * The published rules behind a neighborhood report (#5876), with no database attached. These are what the page prints
 * and what a reader is trusting: which end of each type's scale counts against a street, what's left out, how ties
 * break so the list can't reshuffle between two page loads, and when a headline is allowed to say what it says.
 */
class RankingRuleSpec extends AnyFunSuite with Matchers {
  private val created: OffsetDateTime          = OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.UTC)
  private val noCrop: ReportLabel => Boolean   = _ => false
  private val allCrops: ReportLabel => Boolean = _ => true

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

  private def street(name: String, labels: ReportLabel*): ReportStreet =
    ReportStreet(Some(name), labels.map(_.streetEdgeId).distinct, 100.0, labels)

  test("the bad end of the rating scale is the same for a quality-rated and a severity-rated type") {
    RankingRule.isWorst(label(1, CurbRamp, Some(3))) shouldBe true
    RankingRule.isWorst(label(2, Obstacle, Some(3))) shouldBe true
    RankingRule.isWorst(label(3, CurbRamp, Some(1))) shouldBe false
    RankingRule.isOneStepFromWorst(label(4, CurbRamp, Some(2))) shouldBe true
    RankingRule.isOneStepFromWorst(label(5, Obstacle, Some(2))) shouldBe true
  }

  test("every unrated type contributes nothing to a street's score, whatever a row holds") {
    for (unrated <- Seq(NoSidewalk, Signal, Occlusion)) {
      RankingRule.labelScore(label(1, unrated, None)) shouldBe 0
      RankingRule.labelScore(label(2, unrated, Some(3))) shouldBe 0
    }
  }

  test("a street's score weighs worst ratings double, the next rating once, and low ratings not at all") {
    val labels = Seq(label(1, severity = Some(3)), label(2, severity = Some(2)), label(3, severity = Some(1)))
    RankingRule.streetScore(labels) shouldBe RankingRule.WorstRatingWeight + RankingRule.NextRatingWeight
  }

  test("the no-alternate-route bonus applies only to a missing curb ramp carrying the tag") {
    val tag     = List(RankingRule.NoAlternateRouteTag)
    val base    = RankingRule.labelScore(label(1, NoCurbRamp, Some(3)))
    val withTag = RankingRule.labelScore(label(2, NoCurbRamp, Some(3), tags = tag))
    withTag shouldBe base + RankingRule.NoAlternateRouteBonus
    RankingRule.labelScore(label(3, Obstacle, Some(3), tags = tag)) shouldBe RankingRule.WorstRatingWeight
    // The bonus doesn't depend on the rating: a labeler can record no way around a ramp they rated low.
    RankingRule.labelScore(label(4, NoCurbRamp, Some(1), tags = tag)) shouldBe RankingRule.NoAlternateRouteBonus
  }

  test("only labels review marked incorrect are left out of the counts") {
    RankingRule.isCounted(label(1, correct = Some(false))) shouldBe false
    RankingRule.isCounted(label(2, correct = Some(true))) shouldBe true
    RankingRule.isCounted(label(3, correct = None)) shouldBe true
  }

  test("streets rank by score, then label count, then length, then name, so the order is stable") {
    val high      = street("High", label(1), label(2))
    val manyLower = street("ManyLower", label(3), label(4, severity = Some(1)))
    val fewLower  = street("FewLower", label(5))
    val longer    = street("Longer", label(6)).copy(lengthMeters = 900)
    RankingRule.rank(Seq(fewLower, longer, manyLower, high)).flatMap(_.name) shouldBe
      Seq("High", "ManyLower", "Longer", "FewLower")
    val alpha = street("Alpha", label(7))
    val beta  = street("Beta", label(8))
    RankingRule.rank(Seq(beta, alpha)).flatMap(_.name) shouldBe Seq("Alpha", "Beta")
  }

  test("photos come worst first, confirmed before unchecked, and a well-rated feature isn't evidence of a barrier") {
    val worstConfirmed = label(1, severity = Some(3), agree = 2)
    val worstUnchecked = label(2, severity = Some(3))
    val worstDisputed  = label(3, severity = Some(3), disagree = 1)
    val next           = label(4, severity = Some(2), agree = 5)
    val noSidewalk     = label(5, NoSidewalk, None)
    val goodRamp       = label(6, CurbRamp, Some(1))
    val occlusion      = label(7, Occlusion, None)
    val photos         = RankingRule.selectPhotos(
      Seq(goodRamp, occlusion, noSidewalk, next, worstDisputed, worstUnchecked, worstConfirmed),
      limit = 10,
      allCrops
    )
    photos.map(_.labelId) shouldBe Seq(1, 2, 3, 4, 5)
  }

  test("a label with a crop beats a worse one without, and the strip only falls back to no-image panels to fill up") {
    val worstNoCrop = label(1, severity = Some(3))
    val nextHasCrop = label(2, severity = Some(2))
    val hasCrop     = (l: ReportLabel) => l.labelId == 2
    RankingRule.selectPhotos(Seq(worstNoCrop, nextHasCrop), 1, hasCrop).map(_.labelId) shouldBe Seq(2)
    RankingRule.selectPhotos(Seq(worstNoCrop, nextHasCrop), 2, hasCrop).map(_.labelId) shouldBe Seq(2, 1)
    RankingRule.selectPhotos(Seq(worstNoCrop, nextHasCrop), 4, noCrop).map(_.labelId) shouldBe Seq(1, 2)
  }

  test("the punch list needs a human Agree and no Disagree, and takes one label per street down the ranking") {
    val first  = street("First", label(1, agree = 1), label(2, agree = 3), label(3, agree = 9, disagree = 1))
    val second = street("Second", label(4, disagree = 1, agree = 2))
    val third  = street("Third", label(5))
    val fourth = street("Fourth", label(6, severity = Some(2), agree = 4))
    val fifth  = street("Fifth", label(7, agree = 1))
    val picks  = RankingRule.punchList(Seq(first, second, third, fourth, fifth), 5, noCrop)
    picks.map { case (s, l) => (s.name.get, l.labelId) } shouldBe Seq(("First", 2), ("Fifth", 7))
  }

  test("the punch list stops at its size and prefers a label with a photo over a more-agreed one without") {
    val streets = (1 to 7).map(i => street(s"S$i", label(i, agree = 1)))
    RankingRule.punchList(streets, 5, noCrop).size shouldBe 5
    val both    = street("Both", label(10, agree = 5), label(11, agree = 1))
    val hasCrop = (l: ReportLabel) => l.labelId == 11
    RankingRule.punchList(Seq(both), 5, hasCrop).map(_._2.labelId) shouldBe Seq(11)
  }

  test("between equally agreed labels the punch list takes the higher-scoring one, whatever the ids say") {
    val pole  = label(1, Obstacle, agree = 2, tags = List("pole"))
    val noWay = label(2, NoCurbRamp, agree = 2, tags = List(RankingRule.NoAlternateRouteTag))
    val picks = RankingRule.punchList(Seq(street("A", pole, noWay)), 5, noCrop)
    picks.map(_._2.labelId) shouldBe Seq(2)
  }

  test("a headline about no alternate route needs both enough observations and a large enough share") {
    val tag      = List(RankingRule.NoAlternateRouteTag)
    val noWay    = (1 to 5).map(i => label(i, NoCurbRamp, tags = tag))
    val withWay  = (6 to 20).map(i => label(i, NoCurbRamp))
    val headline = HeadlineRule.select(Seq(street("A", (noWay ++ withWay)*)))
    headline.key shouldBe "report.headline.noalternate"
    headline.args shouldBe Seq(4, 20, 5)
    headline.labelIds should contain theSameElementsAs noWay.map(_.labelId)

    val tooFew = HeadlineRule.select(Seq(street("A", (noWay.take(4) ++ withWay)*)))
    tooFew.key should not be "report.headline.noalternate"
    val tooRare = (21 to 60).map(i => label(i, NoCurbRamp))
    HeadlineRule
      .select(Seq(street("A", (noWay ++ withWay ++ tooRare)*)))
      .key should not be "report.headline.noalternate"
  }

  test("a concentration headline needs enough worst-rated labels and a real concentration on the top streets") {
    val top      = (1 to 3).map(i => street(s"T$i", (0 until 4).map(j => label(i * 10 + j))*))
    val headline = HeadlineRule.select(top ++ (100 to 110).map(i => street(s"S$i", label(i))))
    headline.key shouldBe "report.headline.concentration"
    headline.args shouldBe Seq(3, 52)
    headline.labelIds.size shouldBe 12

    val evenlySpread = (100 to 130).map(i => street(s"S$i", label(i)))
    HeadlineRule.select(evenlySpread).key shouldBe "report.headline.worst"
  }

  test("the headline falls back to the worst-rated count, and says so plainly when there are none") {
    val few = HeadlineRule.select(Seq(street("A", label(1), label(2)), street("B", label(3))))
    few.key shouldBe "report.headline.worst"
    few.args shouldBe Seq(3, 2)
    val none = HeadlineRule.select(Seq(street("A", label(1, severity = Some(1)))))
    none.key shouldBe "report.headline.none"
    none.args shouldBe Seq(1)
    none.labelIds shouldBe empty
    HeadlineRule.select(Seq.empty).key shouldBe "report.headline.none"
  }

  test("coverage counts people and human review, and reads imagery age from free-text capture dates") {
    val counted = Seq(
      label(1, user = "a", agree = 2, capture = Some("2015-06")),
      label(2, user = "a", disagree = 1, capture = Some("2022-02")),
      label(3, user = "b", unsure = 1, capture = Some("2024")),
      label(4, user = "c", capture = Some("not a date")),
      label(5, user = "c", capture = None)
    )
    val excluded = Seq(label(6, correct = Some(false)))
    val coverage = Coverage.from(counted, excluded, 2000, 500, LocalDate.of(2026, 11, 1))
    coverage.percentAudited shouldBe 25
    coverage.observationIds shouldBe Seq(1, 2, 3, 4, 5)
    coverage.excludedIds shouldBe Seq(6)
    coverage.labelers shouldBe 3
    coverage.reviewedIds shouldBe Seq(1, 2, 3)
    coverage.confirmedIds shouldBe Seq(1)
    coverage.medianImageryYear shouldBe Some(2022)
    coverage.oldImageryPercent shouldBe Some(33)
  }

  test("coverage of an empty region has no imagery figures and doesn't divide by zero") {
    val coverage = Coverage.from(Seq.empty, Seq.empty, 0, 0, LocalDate.of(2026, 11, 1))
    coverage.percentAudited shouldBe 0
    coverage.medianImageryYear shouldBe None
    coverage.oldImageryPercent shouldBe None
    coverage.firstObservation shouldBe None
  }

  test("the inventory lists types canonically, has no worst count for an unrated type, and ranks tags by use") {
    val rows = InventoryRow.from(
      Seq(
        label(1, NoSidewalk, None),
        label(2, Obstacle, tags = List("pole", "tree")),
        label(3, Obstacle, Some(1), tags = List("pole"), agree = 1),
        label(4, CurbRamp, Some(1))
      )
    )
    rows.map(_.labelType) shouldBe Seq(CurbRamp, Obstacle, NoSidewalk)
    val obstacle = rows(1)
    obstacle.observedIds shouldBe Seq(2, 3)
    obstacle.worstIds shouldBe Some(Seq(2))
    obstacle.confirmedIds shouldBe Seq(3)
    obstacle.topTags shouldBe Seq(("pole", 2), ("tree", 1))
    rows(2).worstIds shouldBe None
  }

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

  test("a preset falls back to the default for a missing or unknown value") {
    ReportPreset.fromParam(Some("coordinator")) shouldBe ReportPreset.Coordinator
    ReportPreset.fromParam(Some("advocate")) shouldBe ReportPreset.Advocate
    ReportPreset.fromParam(Some("<script>")) shouldBe ReportPreset.Advocate
    ReportPreset.fromParam(None) shouldBe ReportPreset.Advocate
  }
}
