package service

import actor.ScheduledJobs
import models.utils.{BackgroundJobRun, JobRunStatus, JobRunTrigger}
import org.scalatest.matchers.must.Matchers
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.Json

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Unit tests for how the admin Imagery page's pipeline series is folded out of recorded job runs (#4908).
 *
 * No DB and no app boot: the interesting logic is the fold itself, and it has to be right about the cases a real
 * night produces -- the poll and the flag sync record separately an hour apart, a hand-run job adds to the night it
 * ran on, and a failed run reports no counts at all while still needing to be visible as a failure.
 */
class ImageryFreshnessReportSpec extends AnyWordSpec with Matchers {

  private val pollJob = ImageryFreshnessReportService.PollJob
  private val syncJob = ImageryFreshnessReportService.SyncJob

  private def at(day: String, hour: Int): OffsetDateTime =
    OffsetDateTime.of(java.time.LocalDate.parse(day), java.time.LocalTime.of(hour, 0), ZoneOffset.UTC)

  private def run(
      jobName: String,
      day: String,
      hour: Int,
      details: Map[String, Int],
      status: JobRunStatus.Value = JobRunStatus.Succeeded,
      trigger: JobRunTrigger.Value = JobRunTrigger.Scheduled
  ): BackgroundJobRun = {
    BackgroundJobRun(
      0,
      jobName,
      trigger,
      at(day, hour),
      Some(at(day, hour).plusMinutes(3)),
      status,
      if (details.isEmpty) None else Some(Json.toJson(details)),
      None
    )
  }

  private def buildDays(runs: Seq[BackgroundJobRun]) =
    ImageryFreshnessReportService.buildRunDays(runs, pollJob, syncJob)

  "buildRunDays" should {
    "merge a night's poll and flag-sync runs into one row" in {
      val days = buildDays(
        Seq(
          run(
            pollJob,
            "2026-08-10",
            0,
            Map("streets_selected" -> 500, "streets_polled" -> 480, "streets_skipped" -> 20)
          ),
          run(syncJob, "2026-08-10", 1, Map("streets_refreshed" -> 12, "audits_flagged" -> 7, "audits_unflagged" -> 2))
        )
      )

      days.size mustBe 1
      days.head.streetsSelected mustBe 500
      days.head.streetsPolled mustBe 480
      days.head.streetsSkipped mustBe 20
      days.head.streetsRefreshed mustBe 12
      days.head.auditsFlagged mustBe 7
      days.head.auditsUnflagged mustBe 2
    }

    "sum a hand-run job into the night it ran on rather than replacing the scheduled run" in {
      val days = buildDays(
        Seq(
          run(pollJob, "2026-08-10", 0, Map("streets_polled" -> 480)),
          run(pollJob, "2026-08-10", 14, Map("streets_polled" -> 20), trigger = JobRunTrigger.Manual)
        )
      )

      days.size mustBe 1
      days.head.streetsPolled mustBe 500
    }

    "keep a failed run visible even though it recorded no counts" in {
      val days = buildDays(
        Seq(
          run(pollJob, "2026-08-11", 0, Map.empty, status = JobRunStatus.Failed),
          run(syncJob, "2026-08-11", 1, Map("audits_flagged" -> 0, "audits_unflagged" -> 0))
        )
      )

      days.size mustBe 1
      days.head.streetsPolled mustBe 0
      days.head.pollFailures mustBe 1
      days.head.syncFailures mustBe 0
    }

    "report nights oldest first, and only nights something ran" in {
      val days = buildDays(
        Seq(
          run(syncJob, "2026-08-12", 1, Map("audits_flagged" -> 1)),
          run(pollJob, "2026-08-10", 0, Map("streets_polled" -> 1))
        )
      )

      days.map(_.day.toString) mustBe Seq("2026-08-10", "2026-08-12")
    }

    "ignore runs of jobs it does not chart" in {
      val days = buildDays(Seq(run("clustering-actor", "2026-08-10", 4, Map("streets_polled" -> 999))))
      days mustBe empty
    }
  }

  "clampDays" should {
    "hold a caller-supplied window inside the supported range" in {
      ImageryFreshnessReportService.clampDays(0) mustBe ImageryFreshnessReportService.MinDays
      ImageryFreshnessReportService.clampDays(-30) mustBe ImageryFreshnessReportService.MinDays
      ImageryFreshnessReportService.clampDays(100000) mustBe ImageryFreshnessReportService.MaxDays
      ImageryFreshnessReportService.clampDays(45) mustBe 45
    }
  }

  "the charted jobs" should {
    // Every name here is looked up in the roster the Health panel builds, so one that is not on it silently drops a
    // job off this page -- an absent row, which reads as a job that does not exist rather than one nothing can find.
    "all be on the nightly roster" in {
      val roster = ScheduledJobs.All.map(_.name)
      ImageryFreshnessReportService.JobNames.foreach(name => roster must contain(name))
    }

    "name the poll and the sync among them, since the page points at them by role" in {
      ImageryFreshnessReportService.JobNames must contain(ImageryFreshnessReportService.PollJob)
      ImageryFreshnessReportService.JobNames must contain(ImageryFreshnessReportService.SyncJob)
      ImageryFreshnessReportService.PollJob must not be ImageryFreshnessReportService.SyncJob
    }

    "run the poll earlier in the night than the sync that consumes it" in {
      val poll = ScheduledJobs.All.find(_.name == ImageryFreshnessReportService.PollJob).get
      val sync = ScheduledJobs.All.find(_.name == ImageryFreshnessReportService.SyncJob).get
      (poll.hour * 60 + poll.minute) must be < (sync.hour * 60 + sync.minute)
    }
  }

  "reading a run's counts" should {
    "treat a key the run did not record as zero rather than dropping the night" in {
      val days = buildDays(Seq(run(pollJob, "2026-08-10", 0, Map("streets_polled" -> 3))))
      days.head.streetsSelected mustBe 0
      days.head.streetsSkipped mustBe 0
    }

    "treat a non-numeric value as zero, since details is free-form JSON" in {
      // `details` is whatever the job stored; a string where a count is expected must not sink the whole series.
      val polled = run(pollJob, "2026-08-10", 0, Map.empty)
        .copy(details = Some(Json.obj("streets_polled" -> "many", "streets_skipped" -> 4)))
      val days = buildDays(Seq(polled))
      days.head.streetsPolled mustBe 0
      days.head.streetsSkipped mustBe 4
    }
  }

  "the report writer" should {
    "emit snake_case keys, including for nights with no run of one job" in {
      val report = ImageryFreshnessReport(
        days = 30,
        since = at("2026-07-20", 0),
        jobs = Seq.empty,
        runDays = buildDays(Seq(run(pollJob, "2026-08-10", 0, Map("streets_polled" -> 3)))),
        pollBatchSize = 500,
        overdueAfterHours = 36L,
        pollJob = pollJob,
        syncJob = syncJob
      )
      val json = Json.toJson(report)

      (json \ "poll_batch_size").as[Int] mustBe 500
      (json \ "overdue_after_hours").as[Long] mustBe 36L
      // The client points at the poll and the sync by role rather than keeping its own copy of their names.
      (json \ "poll_job").as[String] mustBe pollJob
      (json \ "sync_job").as[String] mustBe syncJob
      val night = (json \ "run_days" \ 0).get
      (night \ "day").as[String] mustBe "2026-08-10"
      (night \ "streets_polled").as[Int] mustBe 3
      (night \ "audits_flagged").as[Int] mustBe 0
    }
  }
}
