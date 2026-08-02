package service

import org.scalatestplus.play.PlaySpec

import java.time.OffsetDateTime

/**
 * Unit tests for the pure retry-wait math behind the daily story cap's 429 (#4740). No app/DB boot: the interesting
 * cases are sub-second roundings that the DB-backed StoryControllerSpec (which asserts only coarse bounds on a live
 * clock) cannot pin down.
 */
class StoryServiceSpec extends PlaySpec {

  // A story posted at 10:00:00Z counts against the rolling 24h cap until 10:00:00Z the next day.
  private val posted = Some(OffsetDateTime.parse("2026-08-01T10:00:00Z"))

  "StoryServiceImpl.secondsUntilFree" should {
    "report the whole seconds until the oldest counting story leaves the window" in {
      val now = OffsetDateTime.parse("2026-08-02T07:00:00Z") // 3h before the slot frees.
      StoryServiceImpl.secondsUntilFree(posted, now) mustBe Some(3L * 3600)
    }

    "ceil a fractional second up, so the quoted wait is never before the slot opens" in {
      val now = OffsetDateTime.parse("2026-08-02T09:59:58.700Z") // 1.3s left: quoting 1 would be 300ms early.
      StoryServiceImpl.secondsUntilFree(posted, now) mustBe Some(2L)
    }

    "floor at one second once the slot has (just) opened" in {
      // The count query and this computation see slightly different "now"s, so the story can age out in between;
      // never say zero (the composer would render "in 0 minutes").
      val now = OffsetDateTime.parse("2026-08-02T10:00:00.500Z")
      StoryServiceImpl.secondsUntilFree(posted, now) mustBe Some(1L)
    }

    "report nothing when the cap isn't hit" in {
      StoryServiceImpl.secondsUntilFree(None, OffsetDateTime.parse("2026-08-02T10:00:00Z")) mustBe None
    }
  }
}
