package service

import actor.ScheduledJobs
import com.google.inject.ImplementedBy
import models.utils.{BackgroundJobRun, BackgroundJobRunTable, JobRunStatus, MyPostgresProfile}
import play.api.Configuration
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
import scala.concurrent.duration.Duration
import scala.concurrent.{ExecutionContext, Future}

/**
 * One night's work by the imagery-freshness pipeline, assembled from the poll's and the sync's recorded run details.
 *
 * A night with a row for one job and not the other is normal — the poll runs at 00:45 and the sync at 01:45 — so
 * every count defaults to zero rather than to "missing", and the failure counts carry whether the night's numbers can
 * be trusted at all.
 *
 * @param streetsSelected  Streets the rotation picked to poll.
 * @param streetsPolled    Streets that answered conclusively, i.e. how far the rotation actually advanced.
 * @param streetsSkipped   Streets left for the next night after an inconclusive answer.
 * @param streetsRefreshed street_imagery rows the sync refreshed from panos labelers happened to view.
 * @param auditsFlagged    Audits newly marked as needing a re-audit.
 * @param auditsUnflagged  Audits whose re-audit flag cleared.
 * @param pollFailures     Failed poll runs that night; a night of zeros with a failure means "broken", not "quiet".
 * @param syncFailures     Failed sync runs that night.
 * @param noImagerySelected no_imagery streets picked by the regained-imagery re-check rotation (#4929). Zero for
 *                          runs recorded before that rotation existed.
 * @param noImageryPolled   Of those, streets that answered conclusively.
 * @param reopenCandidates  Of those, streets recorded as reopen candidates for admin review.
 */
case class ImageryRunDay(
    day: LocalDate,
    streetsSelected: Int,
    streetsPolled: Int,
    streetsSkipped: Int,
    streetsRefreshed: Int,
    auditsFlagged: Int,
    auditsUnflagged: Int,
    pollFailures: Int,
    syncFailures: Int,
    noImagerySelected: Int = 0,
    noImageryPolled: Int = 0,
    reopenCandidates: Int = 0
)

/**
 * Everything the admin Imagery page shows about the freshness *pipeline*, as opposed to the streets it acts on.
 *
 * @param days              Length of the reported window.
 * @param since             Start of that window.
 * @param jobs              Roster state for the three jobs that make up the pipeline, including never-run ones.
 * @param runDays           Per-night counts across the window.
 * @param pollBatchSize     Streets the poll asks for per night, which sets the rotation's pace.
 * @param overdueAfterHours How long without a successful scheduled run before a job reads as overdue.
 * @param pollJob           Name of the job in `jobs` that polls capture dates, so the page can point at it by role
 *                          rather than keeping its own copy of the name.
 * @param syncJob           Name of the job in `jobs` that turns those dates into re-audit flags.
 */
case class ImageryFreshnessReport(
    days: Int,
    since: OffsetDateTime,
    jobs: Seq[NightlyJobStatus],
    runDays: Seq[ImageryRunDay],
    pollBatchSize: Int,
    overdueAfterHours: Long,
    pollJob: String,
    syncJob: String
)

object ImageryFreshnessReport {

  /** snake_case per the admin dashboard convention. Nights with no recorded run are absent; the client zero-fills. */
  implicit val writes: Writes[ImageryFreshnessReport] = Writes { report =>
    Json.obj(
      "days"     -> report.days,
      "since"    -> report.since.toString,
      "jobs"     -> JsArray(report.jobs.map(Json.toJson(_)(HealthService.nightlyJobStatusWrites))),
      "run_days" -> JsArray(report.runDays.map { day =>
        Json.obj(
          "day"                 -> day.day.toString,
          "streets_selected"    -> day.streetsSelected,
          "streets_polled"      -> day.streetsPolled,
          "streets_skipped"     -> day.streetsSkipped,
          "streets_refreshed"   -> day.streetsRefreshed,
          "audits_flagged"      -> day.auditsFlagged,
          "audits_unflagged"    -> day.auditsUnflagged,
          "poll_failures"       -> day.pollFailures,
          "sync_failures"       -> day.syncFailures,
          "no_imagery_selected" -> day.noImagerySelected,
          "no_imagery_polled"   -> day.noImageryPolled,
          "reopen_candidates"   -> day.reopenCandidates
        )
      }),
      "poll_batch_size"     -> report.pollBatchSize,
      "overdue_after_hours" -> report.overdueAfterHours,
      "poll_job"            -> report.pollJob,
      "sync_job"            -> report.syncJob
    )
  }
}

@ImplementedBy(classOf[ImageryFreshnessReportServiceImpl])
trait ImageryFreshnessReportService {
  def getReport(days: Int): Future[ImageryFreshnessReport]
}

object ImageryFreshnessReportService {

  /** Window the page opens on. A month covers several rotations of the nightly poll at any city's size. */
  val DefaultDays: Int = 30

  /** Bounds on the requested window: a week is the shortest read that shows a pattern, a year the longest we chart. */
  val MinDays: Int = 7
  val MaxDays: Int = 365

  /**
   * How long an assembled report is served from cache.
   *
   * Everything in it moves once a night, so a reader loses no actionable freshness — and the page is the one an admin
   * leaves open while watching a pipeline they already suspect is broken.
   */
  val CacheTtl: Duration = Duration(10, "minutes")

  /** The job whose capture-date poll is the only thing that can raise a re-audit flag. */
  val PollJob: String = ScheduledJobs.CheckImageryAge.name

  /** The job that turns the poll's capture dates into per-audit re-audit flags. */
  val SyncJob: String = ScheduledJobs.ImageryFreshnessSync.name

  /** The three jobs that together produce the re-audit signal, in the order they run each night. */
  val JobNames: Seq[String] = Seq(PollJob, SyncJob, ScheduledJobs.RecalculateStreetPriority.name)

  /** Clamps a caller-supplied window into the supported range. */
  def clampDays(days: Int): Int = math.max(MinDays, math.min(MaxDays, days))

  /** Reads one integer out of a run's recorded details, treating an absent or non-numeric key as zero. */
  private def count(details: Option[JsValue], key: String): Int =
    details.flatMap(json => (json \ key).asOpt[Int]).getOrElse(0)

  /**
   * Folds poll and sync runs into one row per night.
   *
   * Keyed on the date the run *started*, so a job that crosses midnight is reported on the night it belongs to rather
   * than split across two. Runs are summed rather than replaced, so an admin re-running a job by hand adds to the
   * night's totals instead of hiding what the scheduled run did.
   *
   * @param runs    Poll and sync runs, in any order.
   * @param pollJob Job name whose details carry the poll counts.
   * @param syncJob Job name whose details carry the flag-sync counts.
   * @return        One row per night that has at least one run, oldest first.
   */
  def buildRunDays(runs: Seq[BackgroundJobRun], pollJob: String, syncJob: String): Seq[ImageryRunDay] = {
    runs
      .filter(run => run.jobName == pollJob || run.jobName == syncJob)
      .groupBy(_.startedAt.toLocalDate)
      .toSeq
      .map { case (day, dayRuns) =>
        val polls = dayRuns.filter(_.jobName == pollJob)
        val syncs = dayRuns.filter(_.jobName == syncJob)
        ImageryRunDay(
          day = day,
          streetsSelected = polls.map(run => count(run.details, "streets_selected")).sum,
          streetsPolled = polls.map(run => count(run.details, "streets_polled")).sum,
          streetsSkipped = polls.map(run => count(run.details, "streets_skipped")).sum,
          streetsRefreshed = syncs.map(run => count(run.details, "streets_refreshed")).sum,
          auditsFlagged = syncs.map(run => count(run.details, "audits_flagged")).sum,
          auditsUnflagged = syncs.map(run => count(run.details, "audits_unflagged")).sum,
          pollFailures = polls.count(_.status == JobRunStatus.Failed),
          syncFailures = syncs.count(_.status == JobRunStatus.Failed),
          // Absent in runs recorded before the #4929 rotation existed; count() reads those as zero.
          noImagerySelected = polls.map(run => count(run.details, "no_imagery_streets_selected")).sum,
          noImageryPolled = polls.map(run => count(run.details, "no_imagery_streets_polled")).sum,
          reopenCandidates = polls.map(run => count(run.details, "reopen_candidates_found")).sum
        )
      }
      .sortBy(_.day)
  }
}

/**
 * Assembles the pipeline half of the admin Imagery page (#4908).
 *
 * The page's map and tables answer "where does the re-audit work sit"; this answers whether the machinery that
 * produces that work is still running. Under the ≥50% median rule a re-audit flag can only originate in the nightly
 * poll, so a poll that silently stopped is indistinguishable from a city whose imagery never changes — the difference
 * shows only in how much of the rotation each night covered, which lives in `background_job_run.details` and nowhere
 * else.
 *
 * Job state is read through [[HealthService.getNightlyJobs]] rather than recomputed here, so "overdue" keeps one
 * definition (last *scheduled successful* run) across the Health and Imagery pages.
 */
@Singleton
class ImageryFreshnessReportServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    cacheApi: AsyncCacheApi,
    healthService: HealthService,
    backgroundJobRunTable: BackgroundJobRunTable
)(implicit ec: ExecutionContext)
    extends ImageryFreshnessReportService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  // The rotation's pace, from the same config key the poller sizes its batch with, so the page can never quote a
  // batch size the poll doesn't use.
  private val pollBatchSize: Int = config.get[Int]("street-imagery-poll.batch-size")

  /**
   * @param days How far back the nightly series reaches. Clamped to the supported range.
   */
  def getReport(days: Int): Future[ImageryFreshnessReport] = {
    val window = ImageryFreshnessReportService.clampDays(days)
    // Keyed on the clamped window so a junk value can't mint unbounded cache entries.
    cacheApi.getOrElseUpdate[ImageryFreshnessReport](
      s"imagery.report.$window",
      ImageryFreshnessReportService.CacheTtl
    )(assembleReport(window))
  }

  /** Reads the roster state and the window's run history that back one report. */
  private def assembleReport(window: Int): Future[ImageryFreshnessReport] = {
    val since = OffsetDateTime.now.minusDays(window.toLong)
    for {
      allJobs <- healthService.getNightlyJobs
      runs    <- db.run(backgroundJobRunTable.runsForJobsSince(ImageryFreshnessReportService.JobNames, since))
    } yield ImageryFreshnessReport(
      days = window,
      since = since,
      jobs = ImageryFreshnessReportService.JobNames.flatMap(name => allJobs.find(_.jobName == name)),
      runDays = ImageryFreshnessReportService
        .buildRunDays(runs, ImageryFreshnessReportService.PollJob, ImageryFreshnessReportService.SyncJob),
      pollBatchSize = pollBatchSize,
      overdueAfterHours = ScheduledJobs.OverdueAfterHours,
      pollJob = ImageryFreshnessReportService.PollJob,
      syncJob = ImageryFreshnessReportService.SyncJob
    )
  }
}
