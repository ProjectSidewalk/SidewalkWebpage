package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/** Pure unit test for the `n` limits on the admin feeds and the user dashboard's mistakes list (#5599). */
class FeedLimitClampSpec extends AnyFunSuite with Matchers {

  test("clampRecentActivity keeps n between 1 and MaxRecentActivity") {
    AdminService.clampRecentActivity(-1) shouldBe 1
    AdminService.clampRecentActivity(0) shouldBe 1
    AdminService.clampRecentActivity(25) shouldBe 25
    AdminService.clampRecentActivity(Int.MaxValue) shouldBe AdminService.MaxRecentActivity
  }

  test("the activity feed never outgrows the comments it pulls in") {
    AdminService.MaxRecentActivity should be <= AdminService.RecentCommentLimit
  }

  test("clampLeaderboardRows keeps n between 1 and MaxLeaderboardRows") {
    AdminService.clampLeaderboardRows(-1) shouldBe 1
    AdminService.clampLeaderboardRows(15) shouldBe 15
    AdminService.clampLeaderboardRows(Int.MaxValue) shouldBe AdminService.MaxLeaderboardRows
  }

  test("clampMistakesPerType keeps n between 1 and MaxMistakesPerType") {
    LabelServiceImpl.clampMistakesPerType(-1) shouldBe 1
    LabelServiceImpl.clampMistakesPerType(6) shouldBe 6
    LabelServiceImpl.clampMistakesPerType(Int.MaxValue) shouldBe LabelServiceImpl.MaxMistakesPerType
  }
}
