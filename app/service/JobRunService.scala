package service

import com.google.inject.ImplementedBy
import models.utils.{BackgroundJobRun, BackgroundJobRunTable, JobRunStatus, JobRunTrigger, MyPostgresProfile}
import play.api.Logger
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.JsObject

import java.time.{Duration, OffsetDateTime}
import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

@ImplementedBy(classOf[JobRunServiceImpl])
trait JobRunService {
  def record[T](jobName: String, trigger: JobRunTrigger)(work: => Future[T])(details: T => JsObject): Future[T]
  def interruptOrphanedRuns(bootedAt: OffsetDateTime): Future[Seq[BackgroundJobRun]]
}

/**
 * Brackets a background job's run with a `background_job_run` row (#4928).
 *
 * Whether the nightly pipeline is healthy is otherwise only visible in the application log, where a poller that
 * stopped firing leaves no evidence at all — the absence of a log line is not something anyone notices. Wrapping each
 * job here turns "did it run, how much did it cover, is its error rate climbing" into a query.
 *
 * The bookkeeping is strictly subordinate to the job: a failure to write a run row is logged and swallowed, and a
 * failed job's original exception propagates unchanged, so adding the wrapper cannot change what any job does.
 */
@Singleton
class JobRunServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    backgroundJobRunTable: BackgroundJobRunTable
)(using ec: ExecutionContext)
    extends JobRunService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  /** Cap on a recorded error message, so a pathological exception can't bloat the table. */
  private val MaxErrorMessageChars: Int = 2000

  /**
   * Runs `work`, recording its start and outcome.
   *
   * @param jobName The job's pekko actor name, so job identity has a single source of truth.
   * @param trigger Whether the scheduler or a person set this run going.
   * @param work    The job. Evaluated after the run row is opened, so a synchronous throw is still recorded.
   * @param details Per-job counts to store against a successful run. An empty object records no details.
   * @return        Exactly what `work` returned, or its original failure.
   */
  def record[T](jobName: String, trigger: JobRunTrigger)(work: => Future[T])(details: T => JsObject): Future[T] = {
    val startedAt = OffsetDateTime.now
    openRun(jobName, trigger, startedAt).flatMap { runId =>
      // Future.delegate so that a `work` that throws synchronously is recorded as a failed run rather than escaping
      // past the bracket -- the actors' calls resolve config and API keys eagerly, which is exactly where that throw
      // would come from.
      Future.delegate(work).transformWith {
        case Success(result) =>
          // Logged as well as recorded (#5236): several jobs log only their start, so without this line the log
          // cannot tell a job that is still working from one that died the moment it began.
          logger.info(s"$jobName (${trigger.name}) run succeeded in ${secondsSince(startedAt)}s.")
          closeRun(jobName, runId, JobRunStatus.Succeeded, buildDetails(jobName, result, details), None)
            .map(_ => result)
        case Failure(e) =>
          val error = describe(e)
          logger.warn(s"$jobName (${trigger.name}) run failed after ${secondsSince(startedAt)}s: $error")
          closeRun(jobName, runId, JobRunStatus.Failed, None, Some(error)).flatMap(_ => Future.failed(e))
      }
    }
  }

  /**
   * Closes, as `Interrupted`, every run still open from before this process started (#5236).
   *
   * Only the process that opened a run ever closes it, so one that dies mid-run (a deploy, a crash, an OOM kill)
   * leaves its row reading `running` forever. Called once at boot by `OrphanedJobRunSweep`.
   *
   * @param bootedAt When this process started. Every run it has opened itself started at or after this instant.
   * @return         The runs closed, as they now read.
   */
  def interruptOrphanedRuns(bootedAt: OffsetDateTime): Future[Seq[BackgroundJobRun]] = {
    db.run(backgroundJobRunTable.interruptRunsStartedBefore(bootedAt, OffsetDateTime.now))
  }

  /** Whole seconds since `start`, for the outcome log lines. */
  private def secondsSince(start: OffsetDateTime): Long = Duration.between(start, OffsetDateTime.now).getSeconds

  /**
   * Runs the caller's details builder, keeping a broken one from costing the job its run record.
   *
   * A throw is logged rather than swallowed silently: an empty `details` is also what a job with nothing to report
   * writes, so without the log line "the builder is broken" and "the job had nothing to say" are the same row.
   *
   * @return The details to store, or None when the builder threw or produced nothing.
   */
  private def buildDetails[T](jobName: String, result: T, details: T => JsObject): Option[JsObject] = {
    Try(details(result)) match {
      case Success(json) => Some(json).filter(_.fields.nonEmpty)
      case Failure(e)    =>
        logger.warn(s"Could not build run details for $jobName; recording the run without them.", e)
        None
    }
  }

  /**
   * Opens the run row before the work starts, so a job the app dies in the middle of still leaves a trace.
   *
   * @return The row's id, or None if the write failed — bookkeeping must never keep a job from running.
   */
  private def openRun(jobName: String, trigger: JobRunTrigger, startedAt: OffsetDateTime): Future[Option[Int]] = {
    db.run(backgroundJobRunTable.insertRunning(jobName, trigger, startedAt))
      .map(Option(_))
      .recover { case NonFatal(e) =>
        logger.error(s"Could not record the start of $jobName; running it unrecorded.", e)
        None
      }
  }

  /** Closes the run row with its outcome. A no-op when the run was never opened. */
  private def closeRun(
      jobName: String,
      runId: Option[Int],
      status: JobRunStatus,
      details: Option[JsObject],
      errorMessage: Option[String]
  ): Future[Unit] = {
    runId match {
      case None     => Future.successful(())
      case Some(id) =>
        db.run(backgroundJobRunTable.finish(id, status, OffsetDateTime.now, details, errorMessage))
          .map(_ => ())
          .recover { case NonFatal(e) => logger.error(s"Could not record the outcome of $jobName.", e) }
    }
  }

  /** A one-line, length-capped description of a failure, for the run row. */
  private def describe(e: Throwable): String = {
    val message = Option(e.getMessage).filter(_.nonEmpty).map(m => s": $m").getOrElse("")
    s"${e.getClass.getName}$message".take(MaxErrorMessageChars)
  }
}
