package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsValue, Json}
import slick.jdbc.GetResult

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

/**
 * Outcome of one background-job run, backing the `job_run_status` Postgres enum type.
 *
 * A run is `Running` from the moment it starts until it settles, which is also exactly when `finished_at` is NULL
 * (enforced by `background_job_run_running_check`). A run left `Running` long past the job's normal duration was
 * abandoned — the app was killed or redeployed mid-run — and reads as neither success nor failure.
 *
 * NOTE: if changing these values, update the `job_run_status` Postgres enum type as well (see 358.sql).
 */
object JobRunStatus extends Enumeration {
  type JobRunStatus = Value
  val Running: Value   = Value("running")
  val Succeeded: Value = Value("succeeded")
  val Failed: Value    = Value("failed")

  /** Parses a string into a job run status, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}

/**
 * What set a background-job run going, backing the `job_run_trigger` Postgres enum type.
 *
 * Worth distinguishing because the question these rows answer is "is the nightly schedule alive": a run someone
 * kicked off by hand from /adminapi must not be able to stand in for one the scheduler never fired.
 *
 * NOTE: if changing these values, update the `job_run_trigger` Postgres enum type as well (see 358.sql).
 */
object JobRunTrigger extends Enumeration {
  type JobRunTrigger = Value
  val Scheduled: Value = Value("scheduled")
  val Manual: Value    = Value("manual")

  /** Parses a string into a job run trigger, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}

/**
 * One run of one background job.
 *
 * @param jobName      The job's pekko actor name (`CheckImageExpiryActor.Name` and friends).
 * @param details      Per-job counts, shaped by the job itself. None until the run settles.
 * @param errorMessage Set only on a `Failed` run.
 */
case class BackgroundJobRun(
    backgroundJobRunId: Int,
    jobName: String,
    triggeredBy: JobRunTrigger.Value,
    startedAt: OffsetDateTime,
    finishedAt: Option[OffsetDateTime],
    status: JobRunStatus.Value,
    details: Option[JsValue],
    errorMessage: Option[String]
)

class BackgroundJobRunTableDef(tag: Tag) extends Table[BackgroundJobRun](tag, "background_job_run") {
  def backgroundJobRunId: Rep[Int]            = column[Int]("background_job_run_id", O.PrimaryKey, O.AutoInc)
  def jobName: Rep[String]                    = column[String]("job_name")
  def triggeredBy: Rep[JobRunTrigger.Value]   = column[JobRunTrigger.Value]("triggered_by")
  def startedAt: Rep[OffsetDateTime]          = column[OffsetDateTime]("started_at")
  def finishedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("finished_at")
  def status: Rep[JobRunStatus.Value]         = column[JobRunStatus.Value]("status")
  def details: Rep[Option[JsValue]]           = column[Option[JsValue]]("details")
  def errorMessage: Rep[Option[String]]       = column[Option[String]]("error_message")

  // CHECK constraints, which Slick can't express: finished_at >= started_at, error_message only on a failed run, and
  // status = 'running' exactly while finished_at is NULL.
  def * = (backgroundJobRunId, jobName, triggeredBy, startedAt, finishedAt, status, details, errorMessage) <> (
    (BackgroundJobRun.apply _).tupled,
    BackgroundJobRun.unapply
  )
}

@ImplementedBy(classOf[BackgroundJobRunTable])
trait BackgroundJobRunTableRepository {}

/**
 * DAO for the background-job run log (#4928).
 *
 * A job whose outcome lives only in the application log leaves a poller that silently stopped indistinguishable from
 * one that found nothing to do. `JobRunService.record` brackets each scheduled actor's run with `insertRunning` and
 * `finish` here, and the Health dashboard reads it back.
 */
@Singleton
class BackgroundJobRunTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends BackgroundJobRunTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val backgroundJobRuns = TableQuery[BackgroundJobRunTableDef]

  implicit private val getBackgroundJobRun: GetResult[BackgroundJobRun] = GetResult { r =>
    BackgroundJobRun(
      r.nextInt(),
      r.nextString(),
      JobRunTrigger.withName(r.nextString()),
      r.nextOffsetDateTime(),
      r.nextOffsetDateTimeOption(),
      JobRunStatus.withName(r.nextString()),
      r.nextStringOption().map(Json.parse),
      r.nextStringOption()
    )
  }

  implicit private val getJobSuccess: GetResult[(String, OffsetDateTime)] =
    GetResult(r => (r.nextString(), r.nextOffsetDateTime()))

  /**
   * Opens a run row, before the work starts, so a job that dies mid-run still leaves a trace.
   *
   * @return The new row's id, which `finish` needs to close it.
   */
  def insertRunning(jobName: String, triggeredBy: JobRunTrigger.Value, startedAt: OffsetDateTime): DBIO[Int] = {
    (backgroundJobRuns returning backgroundJobRuns.map(_.backgroundJobRunId)) +=
      BackgroundJobRun(0, jobName, triggeredBy, startedAt, None, JobRunStatus.Running, None, None)
  }

  /**
   * Closes a run row with its outcome.
   *
   * @param status       Anything but `Running` — the CHECK constraint rejects a finished row that claims to be running.
   * @param details      Per-job counts, or None when the job reports none.
   * @param errorMessage Set only alongside a `Failed` status.
   */
  def finish(
      runId: Int,
      status: JobRunStatus.Value,
      finishedAt: OffsetDateTime,
      details: Option[JsValue],
      errorMessage: Option[String]
  ): DBIO[Int] = {
    backgroundJobRuns
      .filter(_.backgroundJobRunId === runId)
      .map(run => (run.status, run.finishedAt, run.details, run.errorMessage))
      .update((status, Some(finishedAt), details, errorMessage))
  }

  /**
   * The most recent run of each job that has ever run, newest job first.
   *
   * DISTINCT ON rather than a group-by-then-join: the (job_name, started_at DESC) index serves it directly, and a job
   * that has never run simply has no row — the caller decides whether that means "new" or "the scheduler is dead".
   */
  def latestRunPerJob: DBIO[Seq[BackgroundJobRun]] = {
    sql"""SELECT DISTINCT ON (job_name)
                 background_job_run_id, job_name, triggered_by, started_at, finished_at, status, details, error_message
          FROM background_job_run
          ORDER BY job_name, started_at DESC""".as[BackgroundJobRun]
  }

  /**
   * When each job's most recent successful *scheduled* run started, which is the clock the overdue check runs on.
   *
   * Scoped to scheduled runs because the question the Health panel asks is whether the nightly schedule is still
   * alive: a sweep an admin kicked off by hand from /adminapi proves the code works, not that anything is firing it,
   * so it must not be able to clear the alarm. Scoped to successful runs because a job that has failed every night
   * for a week is overdue for one that worked — and keying on success also means a run still in flight neither sets
   * nor clears the alarm, leaving the previous night's success to carry the job through its own next run.
   *
   * A job absent from the result has never succeeded on schedule, which the caller reads as overdue.
   */
  def lastScheduledSuccessPerJob: DBIO[Seq[(String, OffsetDateTime)]] = {
    sql"""SELECT DISTINCT ON (job_name) job_name, started_at
          FROM background_job_run
          WHERE triggered_by = 'scheduled' AND status = 'succeeded'
          ORDER BY job_name, started_at DESC""".as[(String, OffsetDateTime)]
  }

  /**
   * Run counts per (job, outcome) since a cutoff, for the recent-failure-rate column.
   *
   * @param since Runs that *started* at or after this instant, so a long run is counted on the night it began.
   */
  def outcomeCountsSince(since: OffsetDateTime): DBIO[Seq[(String, JobRunStatus.Value, Int)]] = {
    backgroundJobRuns
      .filter(_.startedAt >= since)
      .groupBy(run => (run.jobName, run.status))
      .map { case ((jobName, status), group) => (jobName, status, group.length) }
      .result
  }
}
