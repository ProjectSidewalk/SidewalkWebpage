package modules

import models.utils.{BackgroundJobRun, JobRunStatus, JobRunTrigger}
import modules.OrphanedJobRunSweep.{bootedAt, describe, sweepsAtBoot}
import play.api.Mode
import util.SidewalkSpec

import java.time.OffsetDateTime

/**
 * The boot sweep's pure pieces (#5236). The wiring is a few lines; what can go wrong is the direction of a condition:
 * a sweep that ran in test mode would close a live dev app's in-flight runs on every spec boot, and an ownership line
 * drawn after this process's own first runs would close them too.
 *
 * Pure logic — no app boot and no database. The sweep's SQL is pinned in `BackgroundJobRunTableSpec`.
 */
class OrphanedJobRunSweepSpec extends SidewalkSpec {

  "sweepsAtBoot" should {
    "skip test mode, where spec boots share the dev database with a live app" in {
      sweepsAtBoot(Mode.Test) mustBe false
    }

    "sweep in dev and prod" in {
      sweepsAtBoot(Mode.Dev) mustBe true
      sweepsAtBoot(Mode.Prod) mustBe true
    }
  }

  "bootedAt" should {
    "fall at or before now, so a run this process opens is never older than it" in {
      bootedAt.isAfter(OffsetDateTime.now) mustBe false
    }

    "be stable across calls, since it is the JVM's start rather than the clock" in {
      bootedAt.toInstant mustBe bootedAt.toInstant
    }
  }

  "describe" should {
    "name the run's id, job, and trigger, and say what was done to it" in {
      val booted = OffsetDateTime.parse("2026-09-07T17:09:00-07:00")
      val run    = BackgroundJobRun(
        42, "crop-generation-actor", JobRunTrigger.Scheduled, OffsetDateTime.parse("2026-09-05T06:00:01-07:00"),
        Some(booted.plusSeconds(5)), JobRunStatus.Interrupted, None, None
      )
      val line = describe(run, booted)
      line must include("#42")
      line must include("crop-generation-actor (scheduled)")
      line must include("2026-09-05T06:00:01-07:00")
      line must include("2026-09-07T17:09-07:00")
      line must include("marked interrupted")
    }
  }
}
