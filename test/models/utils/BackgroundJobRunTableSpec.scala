package models.utils

import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for `background_job_run` (#4928, evolution 358) and its DAO.
 *
 * The table exists so that a nightly job which stops firing is distinguishable from one that found nothing to do, so
 * the cases that matter are the ones that keep a row honest: a run is open exactly while it is running, a failure
 * carries its message, and the latest-run read returns the newest row per job rather than an arbitrary one.
 *
 * Seeds its own runs under a test-only job name and deletes them afterwards, so it never depends on what the connected
 * database happens to hold. Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in
 * dev/CI); the scheduling actors are disabled so no real job writes rows mid-test.
 */
class BackgroundJobRunTableSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val jobRunTable = app.injector.instanceOf[BackgroundJobRunTable]
  private val dbConfig    = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val jobName      = "test-4928-job"
  private val otherJobName = "test-4928-other-job"

  private def cleanUp(): Unit = {
    val _ = run(sqlu"DELETE FROM background_job_run WHERE job_name IN ($jobName, $otherJobName)")
  }

  override def beforeAll(): Unit = { super.beforeAll(); cleanUp() }
  override def afterAll(): Unit  = { cleanUp(); super.afterAll() }

  private def readRun(runId: Int): BackgroundJobRun =
    run(jobRunTable.backgroundJobRuns.filter(_.backgroundJobRunId === runId).result.head)

  "background_job_run" should {
    "open a run as running, with no finish time" in {
      val runId  = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      val opened = readRun(runId)
      opened.status mustBe JobRunStatus.Running
      opened.finishedAt mustBe None
      opened.details mustBe None
      opened.triggeredBy mustBe JobRunTrigger.Scheduled
    }

    "close a run with its outcome and counts" in {
      val runId   = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      val details = Json.obj("panos_checked" -> 42)
      run(jobRunTable.finish(runId, JobRunStatus.Succeeded, OffsetDateTime.now, Some(details), None))
      val closed = readRun(runId)
      closed.status mustBe JobRunStatus.Succeeded
      closed.finishedAt mustBe defined
      closed.details mustBe Some(details)
      closed.errorMessage mustBe None
    }

    "record a failure with its message" in {
      val runId = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Manual, OffsetDateTime.now))
      run(jobRunTable.finish(runId, JobRunStatus.Failed, OffsetDateTime.now, None, Some("java.io.IOException: boom")))
      val closed = readRun(runId)
      closed.status mustBe JobRunStatus.Failed
      closed.errorMessage mustBe Some("java.io.IOException: boom")
      closed.triggeredBy mustBe JobRunTrigger.Manual
    }

    "refuse a finished run that still claims to be running" in {
      val runId = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      an[Exception] must be thrownBy {
        run(sqlu"UPDATE background_job_run SET finished_at = now() WHERE background_job_run_id = $runId")
      }
    }

    "refuse an error message on a run that did not fail" in {
      val runId = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(runId, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      an[Exception] must be thrownBy {
        run(sqlu"UPDATE background_job_run SET error_message = 'boom' WHERE background_job_run_id = $runId")
      }
    }

    "refuse a run that finished before it started" in {
      val runId = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      an[Exception] must be thrownBy {
        run(jobRunTable.finish(runId, JobRunStatus.Succeeded, OffsetDateTime.now.minusDays(1), None, None))
      }
    }
  }

  "latestRunPerJobAndTrigger" should {
    "return the newest run of each job" in {
      cleanUp()
      val older = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(2)))
      run(jobRunTable.finish(older, JobRunStatus.Failed, OffsetDateTime.now.minusDays(2), None, Some("older")))
      val newest = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(newest, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      run(jobRunTable.insertRunning(otherJobName, JobRunTrigger.Scheduled, OffsetDateTime.now))

      val latest = run(jobRunTable.latestRunPerJobAndTrigger)
      latest.find(_.jobName == jobName).map(_.backgroundJobRunId) mustBe Some(newest)
      // A job that has only ever started still reports, which is how an abandoned run stays visible.
      latest.find(_.jobName == otherJobName).map(_.status) mustBe Some(JobRunStatus.Running)
    }

    "keep a hand-triggered run beside the scheduled one rather than in place of it" in {
      cleanUp()
      val scheduled = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusHours(9)))
      run(jobRunTable.finish(scheduled, JobRunStatus.Failed, OffsetDateTime.now.minusHours(9), None, Some("boom")))
      val manual = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Manual, OffsetDateTime.now))
      run(jobRunTable.finish(manual, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))

      // The morning-after "run it now" click is newer, so a single latest-run-per-job read would return only it and
      // lose the night's failure entirely.
      val byTrigger = run(jobRunTable.latestRunPerJobAndTrigger).filter(_.jobName == jobName)
      byTrigger.find(_.triggeredBy == JobRunTrigger.Scheduled).map(_.status) mustBe Some(JobRunStatus.Failed)
      byTrigger.find(_.triggeredBy == JobRunTrigger.Manual).map(_.status) mustBe Some(JobRunStatus.Succeeded)
    }
  }

  "lastScheduledSuccessPerJob" should {
    "ignore a hand-triggered run, so it can't clear a dead scheduler's overdue alarm" in {
      cleanUp()
      val scheduled = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(3)))
      run(jobRunTable.finish(scheduled, JobRunStatus.Succeeded, OffsetDateTime.now.minusDays(3), None, None))
      val manual = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Manual, OffsetDateTime.now))
      run(jobRunTable.finish(manual, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))

      // The three-day-old scheduled run, not today's manual one: an admin running the job by hand says nothing about
      // whether the schedule is still firing it.
      val lastGood = run(jobRunTable.lastScheduledSuccessPerJob).toMap.get(jobName)
      lastGood.map(_.toLocalDate) mustBe Some(OffsetDateTime.now.minusDays(3).toLocalDate)
    }

    "ignore a run that is still in flight, leaving the previous success standing" in {
      cleanUp()
      val done = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(1)))
      run(jobRunTable.finish(done, JobRunStatus.Succeeded, OffsetDateTime.now.minusDays(1), None, None))
      run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))

      // Without this the panel would call every job overdue for as long as it was running.
      val lastGood = run(jobRunTable.lastScheduledSuccessPerJob).toMap.get(jobName)
      lastGood.map(_.toLocalDate) mustBe Some(OffsetDateTime.now.minusDays(1).toLocalDate)
    }

    "omit a job whose only scheduled runs failed" in {
      cleanUp()
      val failed = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(failed, JobRunStatus.Failed, OffsetDateTime.now, None, Some("boom")))
      run(jobRunTable.lastScheduledSuccessPerJob).toMap.get(jobName) mustBe None
    }
  }

  "outcomeCountsSince" should {

    /** The counts for `jobName`, keyed by (status, whether an open run is old enough to read as abandoned). */
    def counts(): Map[(JobRunStatus.Value, Boolean), Int] = {
      run(jobRunTable.outcomeCountsSince(OffsetDateTime.now.minusDays(7), OffsetDateTime.now.minusHours(12)))
        .filter(_._1 == jobName)
        .map(count => (count._2, count._3) -> count._4)
        .toMap
    }

    "count runs per job and outcome inside the window, and nothing outside it" in {
      cleanUp()
      val old = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(30)))
      run(jobRunTable.finish(old, JobRunStatus.Succeeded, OffsetDateTime.now.minusDays(30), None, None))
      val recentOk = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(recentOk, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      val recentBad = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(recentBad, JobRunStatus.Failed, OffsetDateTime.now, None, Some("boom")))

      counts().get((JobRunStatus.Succeeded, false)) mustBe Some(1)
      counts().get((JobRunStatus.Failed, false)) mustBe Some(1)
    }

    "ignore hand-triggered runs, so a debugging session can't invent or dilute a failure rate" in {
      cleanUp()
      val scheduled = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(scheduled, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      val manual = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Manual, OffsetDateTime.now))
      run(jobRunTable.finish(manual, JobRunStatus.Failed, OffsetDateTime.now, None, Some("boom")))

      // The column reads as a statement about the nightly schedule, so five failed clicks against a provider outage
      // must not show up as five failed nights.
      counts().get((JobRunStatus.Failed, false)) mustBe None
      counts().values.sum mustBe 1
    }

    "separate a run abandoned mid-flight from one genuinely still in flight" in {
      cleanUp()
      run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(2)))
      run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))

      // Without the split, a job the JVM is killed inside every night lands only in the denominator and reads as a
      // perfect record.
      counts().get((JobRunStatus.Running, true)) mustBe Some(1)
      counts().get((JobRunStatus.Running, false)) mustBe Some(1)
    }
  }

  "runsForJobsSince" should {

    /** Seeds one finished run and returns its id. */
    def seed(job: String, startedAt: OffsetDateTime, status: JobRunStatus.Value, details: Option[String]): Int = {
      val id = run(jobRunTable.insertRunning(job, JobRunTrigger.Scheduled, startedAt))
      val _  = run(
        jobRunTable.finish(
          id,
          status,
          startedAt.plusMinutes(1),
          details.map(Json.parse),
          if (status == JobRunStatus.Failed) Some("boom") else None
        )
      )
      id
    }

    def since(days: Int): Seq[BackgroundJobRun] =
      run(jobRunTable.runsForJobsSince(Seq(jobName, otherJobName), OffsetDateTime.now.minusDays(days.toLong)))

    "return every run of the named jobs inside the window, newest first" in {
      cleanUp()
      seed(jobName, OffsetDateTime.now.minusDays(3), JobRunStatus.Succeeded, None)
      seed(otherJobName, OffsetDateTime.now.minusDays(1), JobRunStatus.Succeeded, None)
      seed(jobName, OffsetDateTime.now.minusDays(2), JobRunStatus.Failed, None)

      val runs = since(7)
      runs.map(_.jobName) mustBe Seq(otherJobName, jobName, jobName)
      runs.map(_.startedAt) mustBe runs.map(_.startedAt).sortBy(-_.toEpochSecond)
    }

    "carry each run's own recorded counts, which live nowhere else" in {
      // The page's whole per-night series is read out of `details`; a read that dropped it would chart zeros against
      // a pipeline that was working.
      cleanUp()
      seed(jobName, OffsetDateTime.now, JobRunStatus.Succeeded, Some("""{"streets_polled": 480}"""))
      (since(1).head.details.get \ "streets_polled").as[Int] mustBe 480
    }

    "keep every run of a night rather than only the last, since a hand-run job adds to it" in {
      cleanUp()
      seed(jobName, OffsetDateTime.now.minusHours(6), JobRunStatus.Succeeded, None)
      seed(jobName, OffsetDateTime.now.minusHours(1), JobRunStatus.Succeeded, None)
      since(1).count(_.jobName == jobName) mustBe 2
    }

    "keep a failed run, which is the night the counts cannot explain on their own" in {
      cleanUp()
      seed(jobName, OffsetDateTime.now, JobRunStatus.Failed, None)
      since(1).map(_.status) mustBe Seq(JobRunStatus.Failed)
    }

    "exclude a run that started before the window" in {
      cleanUp()
      seed(jobName, OffsetDateTime.now.minusDays(40), JobRunStatus.Succeeded, None)
      since(30) mustBe empty
    }

    "exclude jobs it was not asked about" in {
      cleanUp()
      seed(jobName, OffsetDateTime.now, JobRunStatus.Succeeded, None)
      seed(otherJobName, OffsetDateTime.now, JobRunStatus.Succeeded, None)
      run(jobRunTable.runsForJobsSince(Seq(jobName), OffsetDateTime.now.minusDays(1)))
        .map(_.jobName)
        .distinct mustBe Seq(jobName)
    }

    "read nothing at all when asked about no jobs" in {
      // `inSet(Nil)` is a query Slick will happily build; short-circuiting keeps an empty roster from scanning the
      // table and returning every job in it.
      cleanUp()
      seed(jobName, OffsetDateTime.now, JobRunStatus.Succeeded, None)
      run(jobRunTable.runsForJobsSince(Seq.empty, OffsetDateTime.now.minusDays(365))) mustBe empty
    }
  }
}
