package controllers

import org.scalatestplus.play.PlaySpec

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit

/**
 * The grace window that keeps the story-media loss tripwire from crying wolf at its own upload path (#4925, #4926).
 *
 * `StoryService` commits the media row before the file move lands, so for a moment a perfectly healthy upload looks
 * exactly like a destroyed one. Reporting it would cost more than noise: the loss log reports once per media id, so a
 * false alarm spends the single line that id will ever get, and the real loss — if it ever comes — passes in silence.
 * A window too generous is the opposite failure, a stretch of time in which real loss goes unannounced.
 *
 * No app or database boot: the interesting cases are the two boundaries, which a live clock can't pin down.
 */
class StoryUploadWindowSpec extends PlaySpec {

  private val committed = OffsetDateTime.parse("2026-08-20T10:00:00Z")

  "StoryController.withinUploadWindow" should {
    "treat a row committed moments ago as an upload still landing" in {
      StoryController.withinUploadWindow(committed, committed.plus(200, ChronoUnit.MILLIS)) mustBe true
    }

    "still cover a row a few seconds old, since the window is slack over a sub-second race" in {
      StoryController.withinUploadWindow(committed, committed.plusSeconds(30)) mustBe true
    }

    "call a row past the window loss, which is the whole point of having one" in {
      StoryController.withinUploadWindow(committed, committed.plusSeconds(61)) mustBe false
    }

    "close the window on the minute rather than leaving it ambiguous" in {
      StoryController.withinUploadWindow(committed, committed.plusMinutes(1)) mustBe false
    }

    "call a row committed long ago loss, however far back it goes" in {
      StoryController.withinUploadWindow(committed, committed.plusDays(30)) mustBe false
    }

    "treat a row timestamped ahead of the clock as still landing, since skew is not evidence of loss" in {
      // Self-correcting rather than permanent: once the clock passes the row's timestamp by a minute, it reports.
      StoryController.withinUploadWindow(committed.plusMinutes(5), committed) mustBe true
      StoryController.withinUploadWindow(committed.plusMinutes(5), committed.plusMinutes(7)) mustBe false
    }
  }
}
