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

import java.time.{LocalDate, OffsetDateTime}
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
 * The runs are seeded under the real job names, because the roster the report is assembled from names those and
 * nothing else. So every case has to share the two names with whatever the connected database already records under
 * them — a developer's database carries the app's own nightly runs, which the Health panel and this very report read.
 * The seeds are therefore deleted by id, and each case asserts against the night it seeded rather than against the
 * whole series (#5041).
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling
 * actors are disabled so a real run can't land mid-test.
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

  /** The runs this suite has seeded and not yet deleted. */
  private var seededRunIds: List[Int] = Nil

  /** Deletes this suite's own runs, by id: a delete by job name would take the city's real nightly history with it. */
  private def cleanUp(): Unit = {
    if (seededRunIds.nonEmpty) {
      val _ = run(jobRunTable.backgroundJobRuns.filter(_.backgroundJobRunId.inSet(seededRunIds)).delete)
      seededRunIds = Nil
    }
  }

  override def afterAll(): Unit = { cleanUp(); super.afterAll() }

  /**
   * The dates the database already records a poll or sync run on, read before this suite seeds anything.
   *
   * A case that seeded onto one of those dates would be asserting against that night's real counts as well as its
   * own, so the seeds steer around them.
   */
  private lazy val occupiedDays: Set[LocalDate] = run(
    jobRunTable.backgroundJobRuns.filter(_.jobName.inSet(Seq(pollJob, syncJob))).map(_.startedAt).result
  ).map(_.toLocalDate).toSet

  /**
   * `count` nights with no run recorded on them, the most recent of them no less than `daysBack` nights ago.
   *
   * Anchored at 02:00 rather than at `now`, because a case that adds a second run to the same night needs hours left
   * in the date to add it to.
   */
  private def freeNights(count: Int, daysBack: Int = 2): Seq[OffsetDateTime] = Iterator
    .from(daysBack)
    .map(days => OffsetDateTime.now.minusDays(days.toLong).withHour(2).withMinute(0).withSecond(0).withNano(0))
    .filterNot(night => occupiedDays.contains(night.toLocalDate))
    .take(count)
    .toSeq

  /** The charted jobs the database records at least one run for, this suite's own seeds included. */
  private def recordedJobs: Set[String] = run(
    jobRunTable.backgroundJobRuns
      .filter(_.jobName.inSet(ImageryFreshnessReportService.JobNames))
      .map(_.jobName)
      .distinct
      .result
  ).toSet

  /** Seeds one finished run with the counts it recorded. */
  private def seed(
      job: String,
      startedAt: OffsetDateTime,
      details: Map[String, Int],
      status: JobRunStatus.Value = JobRunStatus.Succeeded,
      trigger: JobRunTrigger.Value = JobRunTrigger.Scheduled
  ): Unit = {
    val id = run(jobRunTable.insertRunning(job, trigger, startedAt))
    seededRunIds ::= id
    val _ = run(
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

  /** The series row for one seeded night, which is the only row a case has any claim on. */
  private def runDay(result: ImageryFreshnessReport, night: OffsetDateTime): ImageryRunDay =
    result.runDays.find(_.day == night.toLocalDate).getOrElse(fail(s"no run day for ${night.toLocalDate}"))

  "getReport" should {
    "chart exactly the three jobs that produce the re-audit signal, in the order they run" in {
      val result = report()
      result.jobs.map(_.jobName) mustBe ImageryFreshnessReportService.JobNames
      // The recalculation is on the roster but records no counts, so a jobs list built from `run_days` would drop it.
      result.jobs.map(_.jobName) must contain(ScheduledJobs.RecalculateStreetPriority.name)
    }

    "report a job that has never run rather than omitting it" in {
      cleanUp()
      // Asserted on whichever charted job the database has no run for, rather than on the poll by name. What is under
      // test is that the roster carries a job the rows don't, and pinning a name would need the database to hold none
      // of that one job's runs -- which is true of CI's seed but not of a developer's database, where deleting them to
      // make it true is what #5041 was about. Cancels only if every charted job has run, which no seed makes true.
      val unused = ImageryFreshnessReportService.JobNames.filterNot(recordedJobs.contains)
      assume(unused.nonEmpty, "every charted job has runs recorded in this database")

      // A scheduler that never started leaves no rows at all; a rows-driven listing renders that as a clean panel.
      val job = report().jobs.find(_.jobName == unused.head).get
      job.lastStatus mustBe "never_run"
      job.hoursSinceLastRun mustBe None
      job.overdue mustBe true
    }

    "fold a night's poll and sync runs into one row of the series" in {
      cleanUp()
      val night = freeNights(1).head
      seed(pollJob, night, Map("streets_selected" -> 500, "streets_polled" -> 480, "streets_skipped" -> 20))
      seed(syncJob, night.plusHours(1), Map("audits_flagged" -> 7, "audits_unflagged" -> 2))

      val result = report()
      result.runDays.count(_.day == night.toLocalDate) mustBe 1
      runDay(result, night).streetsPolled mustBe 480
      runDay(result, night).auditsFlagged mustBe 7
    }

    "leave a night nothing ran out of the series, for the client to zero-fill" in {
      cleanUp()
      val nights = freeNights(2)
      seed(pollJob, nights.head, Map("streets_polled" -> 1))

      // A row per silent night would have to be invented here and would say the same thing as its absence; the
      // client draws the axis from `since` and `days`, which is the only place the window is actually known.
      val days = report().runDays.map(_.day)
      days must contain(nights.head.toLocalDate)
      days must not contain nights(1).toLocalDate
    }

    "exclude a run that started before the window" in {
      cleanUp()
      // Seeded deeper than the default window, so one night answers both halves of the question.
      val night = freeNights(1, 200).head
      seed(pollJob, night, Map("streets_polled" -> 99))
      report(30).runDays.map(_.day) must not contain night.toLocalDate
      runDay(report(365), night).streetsPolled mustBe 99
    }

    "clamp a caller-supplied window rather than erroring on it" in {
      report(0).days mustBe ImageryFreshnessReportService.MinDays
      report(100000).days mustBe ImageryFreshnessReportService.MaxDays
      report(45).days mustBe 45
    }

    "start the window at the clamped number of days back, so the client's axis matches the data" in {
      val result   = report(0)
      val expected = OffsetDateTime.now.minusDays(ImageryFreshnessReportService.MinDays.toLong)
      // The client builds one slot per day from `since`, so a `since` that ignored the clamp would draw an axis the
      // series cannot fill.
      math.abs(result.since.toEpochSecond - expected.toEpochSecond) must be < 120L
    }

    "quote the batch size the poll actually uses, and the overdue window the roster defines" in {
      val result = report()
      result.pollBatchSize mustBe app.configuration.get[Int]("street-imagery-poll.batch-size")
      result.overdueAfterHours mustBe ScheduledJobs.OverdueAfterHours
    }

    "name which of its jobs polls and which flags, so the page needs no copy of the names" in {
      val result = report()
      result.pollJob mustBe pollJob
      result.syncJob mustBe syncJob
      result.jobs.map(_.jobName) must contain allOf (result.pollJob, result.syncJob)
    }

    "count a failed night as a failure even though it recorded nothing" in {
      cleanUp()
      val night = freeNights(1).head
      seed(pollJob, night, Map.empty, status = JobRunStatus.Failed)
      val day = runDay(report(), night)
      day.pollFailures mustBe 1
      day.streetsPolled mustBe 0
    }

    "add a hand-run job to its night rather than letting it stand in for the scheduled run" in {
      cleanUp()
      val night = freeNights(1).head
      seed(pollJob, night, Map("streets_polled" -> 400))
      seed(pollJob, night.plusHours(6), Map("streets_polled" -> 50), trigger = JobRunTrigger.Manual)
      runDay(report(), night).streetsPolled mustBe 450
    }

    "serve a repeat read of the same window from cache" in {
      cleanUp()
      val night = freeNights(1).head
      seed(pollJob, night, Map("streets_polled" -> 10))
      await(cacheApi.removeAll())
      val first = await(reportService.getReport(30))

      seed(pollJob, night, Map("streets_polled" -> 10))
      val second = await(reportService.getReport(30))

      // Everything in the report moves once a night, and this is the page an admin leaves open while watching a
      // pipeline they already suspect is broken.
      second.runDays.map(_.streetsPolled) mustBe first.runDays.map(_.streetsPolled)
    }

    "key the cache on the window, so switching windows is not served the previous one" in {
      cleanUp()
      val night = freeNights(1, 200).head
      seed(pollJob, night, Map("streets_polled" -> 7))
      await(cacheApi.removeAll())
      await(reportService.getReport(30)).runDays.map(_.day) must not contain night.toLocalDate
      runDay(await(reportService.getReport(365)), night).streetsPolled mustBe 7
    }

    "key the cache on the clamped window, so a junk value cannot mint unbounded entries" in {
      cleanUp()
      await(cacheApi.removeAll())
      val first = await(reportService.getReport(-1))
      seed(pollJob, freeNights(1).head, Map("streets_polled" -> 3))
      val second = await(reportService.getReport(-99999))
      second.days mustBe first.days
      second.runDays mustBe first.runDays
    }
  }
}
