package service

import actor.ScheduledJobs
import models.utils.MyPostgresProfile.api._
import models.utils.{BackgroundJobRunTable, JobRunStatus, JobRunTrigger, MyPostgresProfile}
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * DB-backed test for how the Health dashboard decides a nightly job is overdue (#4928).
 *
 * The panel exists to catch a scheduler that has silently stopped, so the property that matters is what is allowed to
 * clear its alarm: only a *scheduled* run that *succeeded*. A run someone triggered by hand from /adminapi proves the
 * code works, not that anything is still firing it, and a run that is merely in flight has not proved anything yet.
 * Both are recorded under the same `job_name` as the nightly one, so nothing but this rule separates them.
 *
 * Every case asserts against a seeded history rather than whatever the connected database holds, and the control case
 * pins that `overdue` can be false at all — without it, every assertion here would pass on a bug that hard-coded true.
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so a real run can't land mid-test.
 */
class NightlyJobStatusSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val healthService = app.injector.instanceOf[HealthService]
  private val jobRunTable   = app.injector.instanceOf[BackgroundJobRunTable]
  private val cacheApi      = app.injector.instanceOf[AsyncCacheApi]
  private val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def await[T](f: Future[T]): T  = Await.result(f, 120.seconds)
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  /** The imagery sweep, because it is the one job with a real hand-trigger route (`/adminapi/checkImagery`). */
  private val jobName = ScheduledJobs.CheckImageExpiry.name

  private def clearRuns(): Unit = {
    val _ = run(sqlu"DELETE FROM background_job_run WHERE job_name = $jobName")
  }

  /** Seeds one finished run. */
  private def seedFinished(
      trigger: JobRunTrigger.Value,
      status: JobRunStatus.Value,
      startedAt: OffsetDateTime
  ): Unit = {
    val id    = run(jobRunTable.insertRunning(jobName, trigger, startedAt))
    val error = if (status == JobRunStatus.Failed) Some("seeded failure") else None
    val _     = run(jobRunTable.finish(id, status, startedAt.plusMinutes(1), None, error))
  }

  /** Seeds a run that is still open, as a job the app died in the middle of would be. */
  private def seedRunning(startedAt: OffsetDateTime): Unit = {
    val _ = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, startedAt))
  }

  /**
   * The panel's row for this job.
   *
   * The service caches its job read, so the cache is dropped first — otherwise every case after the first would
   * assert against the previous one's history.
   */
  private def jobStatus(): NightlyJobStatus = {
    await(cacheApi.removeAll())
    await(healthService.getDbHealth).nightlyJobs
      .find(_.jobName == jobName)
      .getOrElse(fail(s"$jobName is missing from the nightly-jobs roster"))
  }

  override def beforeAll(): Unit = { super.beforeAll(); clearRuns() }
  override def afterAll(): Unit  = { clearRuns(); super.afterAll() }

  "the nightly-jobs panel" should {
    "report a job with no runs at all as overdue" in {
      clearRuns()
      val job = jobStatus()
      job.lastStatus mustBe "never_run"
      job.overdue mustBe true
    }

    "clear the alarm for a recent scheduled success" in {
      // The control. Every other case asserts overdue is true, so without this one they would all pass against an
      // implementation that never cleared.
      clearRuns()
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Succeeded, OffsetDateTime.now.minusHours(2))
      val job = jobStatus()
      job.lastStatus mustBe "succeeded"
      job.overdue mustBe false
    }

    "keep the alarm raised when only a hand-triggered run has succeeded recently" in {
      clearRuns()
      seedFinished(
        JobRunTrigger.Scheduled,
        JobRunStatus.Succeeded,
        OffsetDateTime.now.minusHours(ScheduledJobs.OverdueAfterHours + 12)
      )
      seedFinished(JobRunTrigger.Manual, JobRunStatus.Succeeded, OffsetDateTime.now)

      val job = jobStatus()
      // The manual run is reported alongside the scheduled one -- it just can't stand in for the scheduler.
      job.lastStatus mustBe "succeeded"
      job.lastManualStatus mustBe Some("succeeded")
      job.overdue mustBe true
    }

    "not let a hand-triggered success paint over the night the job failed" in {
      clearRuns()
      // Last night's scheduled run failed; an admin clicked "run it now" this morning and it worked. The badge, the
      // error and the counts must all still describe the night, or the panel reports health it doesn't have.
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Failed, OffsetDateTime.now.minusHours(9))
      seedFinished(JobRunTrigger.Manual, JobRunStatus.Succeeded, OffsetDateTime.now)

      val job = jobStatus()
      job.lastStatus mustBe "failed"
      job.lastError mustBe Some("seeded failure")
      job.lastManualStatus mustBe Some("succeeded")
      job.failuresInWindow mustBe 1
      // The hand-triggered run is not a scheduled run, so it belongs in neither side of the ratio.
      job.runsInWindow mustBe 1
    }

    "count a run the app died inside as a failure rather than as a clean record" in {
      clearRuns()
      // Still open long past any plausible duration: nothing ever closed the row, so it recorded no outcome at all.
      seedRunning(OffsetDateTime.now.minusHours(HealthService.JobAbandonedAfterHours + 6))

      val job = jobStatus()
      job.lastStatus mustBe "abandoned"
      job.runsInWindow mustBe 1
      job.failuresInWindow mustBe 1
    }

    "not raise the alarm while a run is in flight, if the last scheduled run succeeded" in {
      clearRuns()
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Succeeded, OffsetDateTime.now.minusHours(2))
      seedRunning(OffsetDateTime.now)

      val job = jobStatus()
      job.lastStatus mustBe "running"
      job.overdue mustBe false
    }

    "keep the alarm raised for a job that has been failing since its last success" in {
      clearRuns()
      seedFinished(
        JobRunTrigger.Scheduled,
        JobRunStatus.Succeeded,
        OffsetDateTime.now.minusHours(ScheduledJobs.OverdueAfterHours + 12)
      )
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Failed, OffsetDateTime.now)

      val job = jobStatus()
      job.lastStatus mustBe "failed"
      job.overdue mustBe true
      job.failuresInWindow must be >= 1
    }
  }
}
