package modules

import models.utils.BackgroundJobRun
import modules.OrphanedJobRunSweep.{bootedAt, describe, sweepsAtBoot}
import play.api.db.evolutions.ApplicationEvolutions
import play.api.{Environment, Logger, Mode}
import service.JobRunService

import java.lang.management.ManagementFactory
import java.time.{Instant, OffsetDateTime, ZoneId}
import javax.inject.{Inject, Singleton}
import scala.concurrent.Await
import scala.concurrent.duration.*
import scala.util.{Failure, Success, Try}

/**
 * Boot-time close-out of the background-job runs a previous process left open (#5236).
 *
 * `JobRunService.record` closes a run however the job ends, but only from inside the process that opened it, so a
 * process that dies mid-run (a deploy, a crash, an OOM kill) leaves the row `running` for good. Those orphans make the
 * job history unable to answer "was this job actually running at time T", the question an incident needs answered.
 * A boot is the one moment that knowledge is certain: a deployed stage runs exactly one process per city schema, so a
 * run that started before this process did belongs to a process that is gone. Each such row is closed as
 * `interrupted` and logged.
 *
 * Ownership is decided by start time against this JVM's start, not by "every open run", so the sweep can never close a
 * run this process opened. Under `sbt ~run` the JVM is sbt's and outlives each reload, so dev under-sweeps; that is the
 * safe direction. Two apps on one schema (a dev app plus a QA worktree) can over-sweep: the later boot closes the
 * earlier app's live run, and the owner's own close then overwrites the guess when the run settles.
 *
 * Skipped in test mode: specs boot an app per suite against the shared dev database, and a sweep there would close the
 * live dev app's in-flight runs on every spec boot. `ApplicationEvolutions` is injected for ordering and for its
 * `upToDate`, exactly as in [[AiSeedRowsRepair]], since the sweep writes the `interrupted` value an evolution adds.
 *
 * Awaited, so the log line lands with the rest of the boot output; it is one small UPDATE. Nothing here is fatal: a
 * failed sweep leaves orphans for the next boot to close, while an eager singleton that throws keeps the city down.
 */
@Singleton
class OrphanedJobRunSweep @Inject() (
    jobRunService: JobRunService,
    evolutions: ApplicationEvolutions,
    environment: Environment
) {
  private val logger = Logger(this.getClass)

  if (sweepsAtBoot(environment.mode)) {
    if (!evolutions.upToDate) {
      logger.warn("Orphaned job runs: skipped, the schema has evolutions pending; restart once they are applied.")
    } else {
      val booted = bootedAt
      Try(Await.result(jobRunService.interruptOrphanedRuns(booted), 60.seconds)) match {
        case Success(swept) if swept.isEmpty => logger.info("Orphaned job runs: none.")
        case Success(swept)                  => swept.foreach(run => logger.warn(describe(run, booted)))
        case Failure(e)                      =>
          logger.error(s"Could not close orphaned job runs; they stay 'running' until a later boot: ${e.getMessage}", e)
      }
    }
  }
}

/** The sweep's pure pieces, split from the boot wiring so `OrphanedJobRunSweepSpec` can pin them without an app. */
object OrphanedJobRunSweep {

  /**
   * Whether this run sweeps at boot. Test mode is skipped because spec boots share the dev database with a live app.
   * Extracted so a test pins the direction of that condition.
   */
  def sweepsAtBoot(mode: Mode): Boolean = mode != Mode.Test

  /**
   * When this JVM started, which is the ownership line: every run this process opens is stamped later than this.
   *
   * The JVM's start rather than the moment this class is built, because jobs could in principle be scheduled by an
   * eager singleton constructed before this one; the JVM start precedes all of them.
   */
  def bootedAt: OffsetDateTime =
    Instant.ofEpochMilli(ManagementFactory.getRuntimeMXBean.getStartTime).atZone(ZoneId.systemDefault).toOffsetDateTime

  /**
   * The log line for one closed run, naming everything needed to find it again in the table and in older logs.
   *
   * @param run      The run as it reads after the sweep.
   * @param bootedAt When this process started.
   * @return         A one-line description.
   */
  def describe(run: BackgroundJobRun, bootedAt: OffsetDateTime): String =
    s"Orphaned job run: #${run.backgroundJobRunId} ${run.jobName} (${run.triggeredBy.name}) started ${run.startedAt} " +
      s"was still open when this process started at $bootedAt; marked interrupted."
}
