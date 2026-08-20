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
import play.api.libs.json.Json
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * DB-backed tests for the report behind the Imagery page's pipeline section (#4908).
 *
 * The fold from runs to nights has its own unit tests; what this covers is the assembly around it — which jobs are
 * charted, in what order, where the window and the batch size come from, and what a job that has never recorded a run
 * is rendered as. That last one is the point of the whole section: a scheduler that stopped firing leaves no rows, so
 * a report driven by rows rather than by the roster would report the failure as an empty, healthy-looking panel.
 *
 * Seeds its own runs under the real job names and deletes them afterwards, so no case depends on what the connected
 * database happens to hold. Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in
 * dev/CI); the scheduling actors are disabled so a real run can't land mid-test.
 */
class ImageryFreshnessReportServiceSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val reportService = app.injector.instanceOf[ImageryFreshnessReportService]
  private val jobRunTable   = app.injector.instanceOf[BackgroundJobRunTable]
  private val cacheApi      = app.injector.instanceOf[AsyncCacheApi]
  private val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def await[T](f: Future[T]): T  = Await.result(f, 120.seconds)
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val pollJob = ImageryFreshnessReportService.PollJob
  private val syncJob = ImageryFreshnessReportService.SyncJob

  private def cleanUp(): Unit = {
    val _ = run(sqlu"DELETE FROM background_job_run WHERE job_name IN ($pollJob, $syncJob)")
  }

  override def beforeAll(): Unit = { super.beforeAll(); cleanUp() }
  override def afterAll(): Unit  = { cleanUp(); super.afterAll() }

  /** Seeds one finished run with the counts it recorded. */
  private def seed(
      job: String,
      startedAt: OffsetDateTime,
      details: Map[String, Int],
      status: JobRunStatus.Value = JobRunStatus.Succeeded,
      trigger: JobRunTrigger.Value = JobRunTrigger.Scheduled
  ): Unit = {
    val id = run(jobRunTable.insertRunning(job, trigger, startedAt))
    val _  = run(
      jobRunTable.finish(
        id,
        status,
        startedAt.plusMinutes(1),
        if (details.isEmpty) None else Some(Json.toJson(details)),
        if (status == JobRunStatus.Failed) Some("boom") else None
      )
    )
  }

  /**
   * A freshly assembled report.
   *
   * Both the report and the job roster under it are cached, so the cache is dropped first — otherwise every case
   * after the first would assert against the previous one's seeded history.
   */
  private def report(days: Int = 30) = {
    await(cacheApi.removeAll())
    await(reportService.getReport(days))
  }

  "getReport" should {
    "chart exactly the three jobs that produce the re-audit signal, in the order they run" in {
      cleanUp()
      val result = report()
      result.jobs.map(_.jobName) mustBe ImageryFreshnessReportService.JobNames
      // The recalculation is on the roster but records no counts, so a jobs list built from `run_days` would drop it.
      result.jobs.map(_.jobName) must contain(ScheduledJobs.RecalculateStreetPriority.name)
    }

    "report a job that has never run rather than omitting it" in {
      cleanUp()
      // A scheduler that never started leaves no rows at all; a rows-driven listing renders that as a clean panel.
      val poll = report().jobs.find(_.jobName == pollJob).get
      poll.lastStatus mustBe "never_run"
      poll.hoursSinceLastRun mustBe None
      poll.overdue mustBe true
    }

    "fold a night's poll and sync runs into one row of the series" in {
      cleanUp()
      val night = OffsetDateTime.now.minusDays(2)
      seed(pollJob, night, Map("streets_selected" -> 500, "streets_polled" -> 480, "streets_skipped" -> 20))
      seed(syncJob, night.plusHours(1), Map("audits_flagged" -> 7, "audits_unflagged" -> 2))

      val days = report().runDays
      days.size mustBe 1
      days.head.streetsPolled mustBe 480
      days.head.auditsFlagged mustBe 7
    }

    "leave a night nothing ran out of the series, for the client to zero-fill" in {
      cleanUp()
      seed(pollJob, OffsetDateTime.now.minusDays(2), Map("streets_polled" -> 1))
      // A row per silent night would have to be invented here and would say the same thing as its absence; the
      // client draws the axis from `since` and `days`, which is the only place the window is actually known.
      report().runDays.map(_.day.toString).distinct.size mustBe 1
    }

    "exclude a run that started before the window" in {
      cleanUp()
      seed(pollJob, OffsetDateTime.now.minusDays(40), Map("streets_polled" -> 99))
      report(30).runDays mustBe empty
      report(365).runDays.map(_.streetsPolled) mustBe Seq(99)
    }

    "clamp a caller-supplied window rather than erroring on it" in {
      cleanUp()
      report(0).days mustBe ImageryFreshnessReportService.MinDays
      report(100000).days mustBe ImageryFreshnessReportService.MaxDays
      report(45).days mustBe 45
    }

    "start the window at the clamped number of days back, so the client's axis matches the data" in {
      cleanUp()
      val result   = report(0)
      val expected = OffsetDateTime.now.minusDays(ImageryFreshnessReportService.MinDays.toLong)
      // The client builds one slot per day from `since`, so a `since` that ignored the clamp would draw an axis the
      // series cannot fill.
      math.abs(result.since.toEpochSecond - expected.toEpochSecond) must be < 120L
    }

    "quote the batch size the poll actually uses, and the overdue window the roster defines" in {
      cleanUp()
      val result = report()
      result.pollBatchSize mustBe app.configuration.get[Int]("street-imagery-poll.batch-size")
      result.overdueAfterHours mustBe ScheduledJobs.OverdueAfterHours
    }

    "name which of its jobs polls and which flags, so the page needs no copy of the names" in {
      cleanUp()
      val result = report()
      result.pollJob mustBe pollJob
      result.syncJob mustBe syncJob
      result.jobs.map(_.jobName) must contain allOf (result.pollJob, result.syncJob)
    }

    "count a failed night as a failure even though it recorded nothing" in {
      cleanUp()
      seed(pollJob, OffsetDateTime.now.minusDays(1), Map.empty, status = JobRunStatus.Failed)
      val night = report().runDays.head
      night.pollFailures mustBe 1
      night.streetsPolled mustBe 0
    }

    "add a hand-run job to its night rather than letting it stand in for the scheduled run" in {
      cleanUp()
      val day = OffsetDateTime.now.minusDays(1)
      seed(pollJob, day, Map("streets_polled" -> 400))
      seed(pollJob, day.plusHours(8), Map("streets_polled" -> 50), trigger = JobRunTrigger.Manual)
      report().runDays.map(_.streetsPolled) mustBe Seq(450)
    }

    "serve a repeat read of the same window from cache" in {
      cleanUp()
      seed(pollJob, OffsetDateTime.now.minusDays(1), Map("streets_polled" -> 10))
      await(cacheApi.removeAll())
      val first = await(reportService.getReport(30))

      seed(pollJob, OffsetDateTime.now.minusDays(1), Map("streets_polled" -> 10))
      val second = await(reportService.getReport(30))

      // Everything in the report moves once a night, and this is the page an admin leaves open while watching a
      // pipeline they already suspect is broken.
      second.runDays.map(_.streetsPolled) mustBe first.runDays.map(_.streetsPolled)
    }

    "key the cache on the window, so switching windows is not served the previous one" in {
      cleanUp()
      seed(pollJob, OffsetDateTime.now.minusDays(40), Map("streets_polled" -> 7))
      await(cacheApi.removeAll())
      await(reportService.getReport(30)).runDays mustBe empty
      await(reportService.getReport(365)).runDays.map(_.streetsPolled) mustBe Seq(7)
    }

    "key the cache on the clamped window, so a junk value cannot mint unbounded entries" in {
      cleanUp()
      await(cacheApi.removeAll())
      val first = await(reportService.getReport(-1))
      seed(pollJob, OffsetDateTime.now.minusDays(1), Map("streets_polled" -> 3))
      val second = await(reportService.getReport(-99999))
      second.days mustBe first.days
      second.runDays mustBe first.runDays
    }
  }
}
