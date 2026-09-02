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
import play.api.libs.json.{JsArray, Json}
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
 * The seeds go under the real job name, because that is the name the roster the panel is built from carries. They are
 * deleted by id rather than by that name, which on a developer's database would take the app's own nightly runs — the
 * history this very panel reports on (#5041).
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

  /** The runs this suite has seeded and not yet deleted. */
  private var seededRunIds: List[Int] = Nil

  /** Deletes this suite's own runs, by id: a delete by job name would take the city's real nightly history with it. */
  private def cleanUp(): Unit = {
    if (seededRunIds.nonEmpty) {
      val _ = run(jobRunTable.backgroundJobRuns.filter(_.backgroundJobRunId.inSet(seededRunIds)).delete)
      seededRunIds = Nil
    }
  }

  /** The jobs the database records at least one run for, this suite's own seeds included. */
  private def recordedJobs: Set[String] = run(jobRunTable.backgroundJobRuns.map(_.jobName).distinct.result).toSet

  /** How many runs this job has inside the window the panel counts over, that this suite did not seed. */
  private def foreignRunsInWindow: Int = run(
    jobRunTable.backgroundJobRuns
      .filter(row =>
        row.jobName === jobName && row.startedAt >= OffsetDateTime.now.minusDays(HealthService.JobWindowDays.toLong)
      )
      .length
      .result
  )

  /**
   * Drops this suite's own seeds and confirms the job's recent history is still its to assert against.
   *
   * Every case reads the job's latest run and its counts over the panel's window, so a run the connected database
   * recorded inside that window would be read as one of the seeds. The case is cancelled rather than run against it,
   * because deleting that run to make the assertion pass is exactly what #5041 was about. Runs older than the window
   * cost nothing here: the seeds are hours old, so they stay the latest. CI's schema records neither.
   */
  private def resetHistory(): Unit = {
    cleanUp()
    val _ = assume(
      foreignRunsInWindow == 0,
      s"$jobName has runs recorded in the last ${HealthService.JobWindowDays} days"
    )
  }

  /** Seeds one finished run. */
  private def seedFinished(
      trigger: JobRunTrigger.Value,
      status: JobRunStatus.Value,
      startedAt: OffsetDateTime
  ): Unit = {
    val id = run(jobRunTable.insertRunning(jobName, trigger, startedAt))
    seededRunIds ::= id
    val error = if (status == JobRunStatus.Failed) Some("seeded failure") else None
    val _     = run(jobRunTable.finish(id, status, startedAt.plusMinutes(1), None, error))
  }

  /** Seeds a run that is still open, as a job the app died in the middle of would be. */
  private def seedRunning(startedAt: OffsetDateTime): Unit = {
    seededRunIds ::= run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, startedAt))
  }

  /**
   * The panel's row for this job.
   *
   * The service caches its job read, so the cache is dropped first — otherwise every case after the first would
   * assert against the previous one's history.
   */
  private def roster(): Seq[NightlyJobStatus] = {
    await(cacheApi.removeAll())
    await(healthService.getDbHealth).nightlyJobs
  }

  /** This job's row on the panel. */
  private def jobStatus(): NightlyJobStatus =
    roster().find(_.jobName == jobName).getOrElse(fail(s"$jobName is missing from the nightly-jobs roster"))

  override def afterAll(): Unit = { cleanUp(); super.afterAll() }

  "the nightly-jobs panel" should {
    "report a job with no runs at all as overdue" in {
      cleanUp()
      // Asserted on whichever nightly job the database has no run for, rather than on the sweep this suite otherwise
      // pins. What is under test is that the roster carries a job the rows don't, and pinning a name would need the
      // database to hold none of that one job's runs -- true of CI's seed, but not of a developer's database, where
      // deleting them to make it true is what #5041 was about. Cancels only if every nightly job has run.
      val unused = roster().filterNot(job => recordedJobs.contains(job.jobName))
      assume(unused.nonEmpty, "every nightly job has runs recorded in this database")

      unused.head.lastStatus mustBe "never_run"
      unused.head.overdue mustBe true
    }

    "clear the alarm for a recent scheduled success" in {
      // The control. Every other case asserts overdue is true, so without this one they would all pass against an
      // implementation that never cleared.
      resetHistory()
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Succeeded, OffsetDateTime.now.minusHours(2))
      val job = jobStatus()
      job.lastStatus mustBe "succeeded"
      job.overdue mustBe false
    }

    "keep the alarm raised when only a hand-triggered run has succeeded recently" in {
      resetHistory()
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
      resetHistory()
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
      resetHistory()
      // Still open long past any plausible duration: nothing ever closed the row, so it recorded no outcome at all.
      seedRunning(OffsetDateTime.now.minusHours(HealthService.JobAbandonedAfterHours + 6))

      val job = jobStatus()
      job.lastStatus mustBe "abandoned"
      job.runsInWindow mustBe 1
      job.failuresInWindow mustBe 1
    }

    "not raise the alarm while a run is in flight, if the last scheduled run succeeded" in {
      resetHistory()
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Succeeded, OffsetDateTime.now.minusHours(2))
      seedRunning(OffsetDateTime.now)

      val job = jobStatus()
      job.lastStatus mustBe "running"
      job.overdue mustBe false
    }

    "publish every field the panel reads, in snake_case" in {
      resetHistory()
      seedFinished(JobRunTrigger.Scheduled, JobRunStatus.Failed, OffsetDateTime.now.minusHours(9))
      seedFinished(JobRunTrigger.Manual, JobRunStatus.Succeeded, OffsetDateTime.now)

      // The JS renders from its own fixtures, so nothing else would notice a field being renamed here until the
      // panel quietly started drawing blank cells against a live database.
      await(cacheApi.removeAll())
      val row = (Json.toJson(await(healthService.getDbHealth))(HealthService.dbHealthDataWrites) \ "nightly_jobs")
        .as[JsArray]
        .value
        .find(entry => (entry \ "job_name").as[String] == jobName)
        .getOrElse(fail(s"$jobName is missing from the serialized roster"))

      (row \ "label").as[String] must not be empty
      (row \ "scheduled_at").as[String] must fullyMatch regex """\d{2}:\d{2}"""
      (row \ "last_started_at").asOpt[String] mustBe defined
      (row \ "last_finished_at").asOpt[String] mustBe defined
      (row \ "last_duration_seconds").asOpt[Long] mustBe defined
      (row \ "last_status").as[String] mustBe "failed"
      (row \ "last_error").asOpt[String] mustBe Some("seeded failure")
      (row \ "hours_since_last_run").asOpt[Long] mustBe defined
      // True because the only scheduled run in this history failed, so the job has no successful one to date from.
      (row \ "overdue").as[Boolean] mustBe true
      (row \ "last_manual_run_at").asOpt[String] mustBe defined
      (row \ "last_manual_status").as[String] mustBe "succeeded"
      (row \ "runs_in_window").as[Int] mustBe 1
      (row \ "failures_in_window").as[Int] mustBe 1
      // The trigger of the last *scheduled* run is not published: every last_* field is already scoped to it, so a
      // field saying which trigger it was could only ever say "scheduled".
      (row \ "last_triggered_by").asOpt[String] mustBe None
    }

    "keep the alarm raised for a job that has been failing since its last success" in {
      resetHistory()
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
