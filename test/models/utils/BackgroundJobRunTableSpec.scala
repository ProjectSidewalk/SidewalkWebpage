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
 * DB-backed contract test for `background_job_run` (#4928, evolution 359) and its DAO.
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

  "latestRunPerJob" should {
    "return the newest run of each job" in {
      cleanUp()
      val older = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(2)))
      run(jobRunTable.finish(older, JobRunStatus.Failed, OffsetDateTime.now.minusDays(2), None, Some("older")))
      val newest = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(newest, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      run(jobRunTable.insertRunning(otherJobName, JobRunTrigger.Scheduled, OffsetDateTime.now))

      val latest = run(jobRunTable.latestRunPerJob)
      latest.find(_.jobName == jobName).map(_.backgroundJobRunId) mustBe Some(newest)
      // A job that has only ever started still reports, which is how an abandoned run stays visible.
      latest.find(_.jobName == otherJobName).map(_.status) mustBe Some(JobRunStatus.Running)
    }
  }

  "outcomeCountsSince" should {
    "count runs per job and outcome inside the window, and nothing outside it" in {
      cleanUp()
      val old = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now.minusDays(30)))
      run(jobRunTable.finish(old, JobRunStatus.Succeeded, OffsetDateTime.now.minusDays(30), None, None))
      val recentOk = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(recentOk, JobRunStatus.Succeeded, OffsetDateTime.now, None, None))
      val recentBad = run(jobRunTable.insertRunning(jobName, JobRunTrigger.Scheduled, OffsetDateTime.now))
      run(jobRunTable.finish(recentBad, JobRunStatus.Failed, OffsetDateTime.now, None, Some("boom")))

      val counts = run(jobRunTable.outcomeCountsSince(OffsetDateTime.now.minusDays(7)))
        .filter(_._1 == jobName)
        .map(count => count._2 -> count._3)
        .toMap
      counts.get(JobRunStatus.Succeeded) mustBe Some(1)
      counts.get(JobRunStatus.Failed) mustBe Some(1)
    }
  }
}
