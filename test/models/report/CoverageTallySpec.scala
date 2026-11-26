package models.report

import models.label.LabelType
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}

/**
 * The running tally behind a region's coverage (#6041). The city reports page folds a whole city's labels into one
 * tally per region, label by label, and the neighborhood report computes its coverage from a list; these hold the two to
 * the same numbers, so a row on `/reports` and the report it opens can't disagree about the same region.
 */
class CoverageTallySpec extends AnyFunSuite with Matchers {
  private val today = LocalDate.of(2026, 11, 26)

  private def label(
      id: Int,
      user: String = "u1",
      day: Int = 1,
      capture: Option[String],
      agree: Int = 0,
      disagree: Int = 0,
      unsure: Int = 0
  ): ReportLabel = ReportLabel(
    id,
    LabelType.Obstacle,
    Some(2),
    Nil,
    1,
    None,
    user,
    s"pano$id",
    OffsetDateTime.of(2026, 3, day, 12, 0, 0, 0, ZoneOffset.UTC),
    None,
    agree,
    disagree,
    unsure,
    capture,
    None,
    None,
    None,
    None
  )

  private def folded(labels: Seq[ReportLabel]): CoverageTally = labels.foldLeft(CoverageTally.empty)(_.add(_))

  /** The fields both views state, read off a tally and off the coverage built from the same labels. */
  private def agree(labels: Seq[ReportLabel]): Unit = {
    val tally    = folded(labels)
    val coverage = Coverage.from(labels, Seq.empty, Seq.empty, 1000, 500, today)
    tally.observations shouldBe coverage.observationIds.size
    tally.reviewed shouldBe coverage.reviewedIds.size
    tally.labelers.size shouldBe coverage.labelers
    tally.firstObservation shouldBe coverage.firstObservation
    tally.lastObservation shouldBe coverage.lastObservation
    tally.medianImageryYear shouldBe coverage.medianImageryYear
    tally.oldImageryPercent(today) shouldBe coverage.oldImageryPercent
  }

  test("folding label by label states what the report's coverage states for the same labels") {
    val labels = Seq(
      label(1, user = "a", day = 3, capture = Some("2019-04"), agree = 1),
      label(2, user = "b", day = 9, capture = Some("2023"), unsure = 1),
      label(3, user = "a", day = 1, capture = Some("June 2021")),
      label(4, user = "c", day = 20, capture = Some("2024-11"), disagree = 2)
    )
    agree(labels)
    val tally = folded(labels)
    tally.observations shouldBe 4
    tally.reviewed shouldBe 3
    tally.labelers shouldBe Set("a", "b", "c")
    tally.firstObservation shouldBe Some(LocalDate.of(2026, 3, 1))
    tally.lastObservation shouldBe Some(LocalDate.of(2026, 3, 20))
    // Stated outright too, since the coverage `agree` compares against now folds this same tally: "June 2021" names no
    // usable year, so the dated years are 2019, 2023 and 2024.
    tally.medianImageryYear shouldBe Some(2023)
    tally.oldImageryPercent(today) shouldBe Some(33)
  }

  test("counts imagery as old only before the cutoff year, not in it") {
    val cutoff = today.getYear - Coverage.OldImageryYears
    val labels = Seq(cutoff - 1, cutoff).zipWithIndex.map { case (y, i) => label(i + 1, capture = Some(s"$y-06")) }
    folded(labels).oldImageryPercent(today) shouldBe Some(50)
    folded(labels.drop(1)).oldImageryPercent(today) shouldBe Some(0)
  }

  test("takes the upper median of an even count of imagery years, as the report does") {
    // Years 2018, 2020, 2022, 2024: the report reads index size / 2, so 2022, not 2020 or their mean.
    val labels = Seq(2024, 2018, 2022, 2020).zipWithIndex.map { case (y, i) => label(i + 1, capture = Some(s"$y-01")) }
    agree(labels)
    folded(labels).medianImageryYear shouldBe Some(2022)
    folded(labels).oldImageryPercent(today) shouldBe Some(50)
  }

  test("takes the middle year of an odd count, counting a repeated year once per label") {
    val labels = Seq(2020, 2020, 2025).zipWithIndex.map { case (y, i) => label(i + 1, capture = Some(s"$y")) }
    agree(labels)
    folded(labels).medianImageryYear shouldBe Some(2020)
  }

  test("is empty for no labels, the same as the report's coverage of none") {
    agree(Seq.empty)
    CoverageTally.empty.medianImageryYear shouldBe None
    CoverageTally.empty.oldImageryPercent(today) shouldBe None
    CoverageTally.empty.lastObservation shouldBe None
  }
}
