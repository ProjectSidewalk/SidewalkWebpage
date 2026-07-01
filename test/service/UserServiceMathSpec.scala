package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.LocalDate

/**
 * Pure (no DB, no app boot) unit test for the dashboard's streak and accuracy-by-type math (User Dashboard redesign).
 *
 * `today` is injected into computeStreakStats precisely so this stays deterministic. Pins the streak edge cases
 * (empty, ends-today vs ends-yesterday, longest across a gap) and the accuracy rules (primary-types-only, canonical
 * order, and the "weakest" flag only among types with enough validations).
 */
class UserServiceMathSpec extends AnyFunSuite with Matchers {

  private val today = LocalDate.of(2024, 6, 15)

  test("streak: an empty history is all zeros, and the heatmap grid is 18 weeks x 7 days") {
    val s = UserService.computeStreakStats(Map.empty, today)
    s.currentStreak shouldBe 0
    s.longestStreak shouldBe 0
    s.totalActiveDays shouldBe 0
    s.cells.length shouldBe UserService.HeatmapWeeks * 7
  }

  test("streak: consecutive days ending today count as the current streak") {
    val counts = Map(today -> 3, today.minusDays(1) -> 1, today.minusDays(2) -> 2)
    val s      = UserService.computeStreakStats(counts, today)
    s.currentStreak shouldBe 3
    s.longestStreak shouldBe 3
    s.totalActiveDays shouldBe 3
  }

  test("streak: if today isn't active yet, the current streak counts back from yesterday") {
    val counts = Map(today.minusDays(1) -> 1, today.minusDays(2) -> 1)
    val s      = UserService.computeStreakStats(counts, today)
    s.currentStreak shouldBe 2
  }

  test("streak: longest run is found across a gap, independent of the current streak") {
    val counts = Map(
      today              -> 1,
      today.minusDays(1) -> 1, // current run of 2 ...
      today.minusDays(5) -> 1,
      today.minusDays(6) -> 1,
      today.minusDays(7) -> 1  // ... but the longest run is 3
    )
    val s = UserService.computeStreakStats(counts, today)
    s.currentStreak shouldBe 2
    s.longestStreak shouldBe 3
    s.totalActiveDays shouldBe 5
  }

  test("accuracy: only primary label types are kept, ordered canonically, with correct percentages") {
    val rows = Seq(("Obstacle", 5, 5), ("CurbRamp", 9, 1), ("Other", 8, 2))
    val acc  = UserService.computeAccuracyByType(rows)
    acc.map(_.labelType) shouldBe Seq("CurbRamp", "Obstacle") // canonical order; "Other" dropped
    acc.head.pct shouldBe 90
    acc.head.cssKey shouldBe "curb-ramp"
    acc.head.displayName shouldBe "Curb Ramp"
    acc(1).pct shouldBe 50
  }

  test("accuracy: a type with no validated labels is excluded") {
    UserService.computeAccuracyByType(Seq(("Signal", 0, 0))) shouldBe empty
  }

  test("accuracy: 'weakest' flags the lowest-percentage type, but only among those with >= 5 validations") {
    // Signal is lower (33%) but has only 3 validations, so CurbRamp (the only >= 5) is the weakest.
    val acc = UserService.computeAccuracyByType(Seq(("CurbRamp", 9, 1), ("Signal", 1, 2)))
    acc.find(_.labelType == "CurbRamp").get.weakest shouldBe true
    acc.find(_.labelType == "Signal").get.weakest shouldBe false
  }

  // The public-profile privacy gate — the security-critical decision behind who can see whom's stats/map.
  test("profileVisible: the owner always sees their own profile, public or not") {
    UserService.profileVisible(Some((true, true)), isOwner = true) shouldBe true
    UserService.profileVisible(Some((true, false)), isOwner = true) shouldBe true
    UserService.profileVisible(None, isOwner = true) shouldBe true
  }

  test("profileVisible: a non-owner sees only a public profile") {
    UserService.profileVisible(Some((true, true)), isOwner = false) shouldBe true   // public_profile = true
    UserService.profileVisible(Some((true, false)), isOwner = false) shouldBe false // public_profile = false
  }

  test("profileVisible: a missing user_stat row reads as private for a non-owner (privacy-safe default)") {
    UserService.profileVisible(None, isOwner = false) shouldBe false
  }
}
