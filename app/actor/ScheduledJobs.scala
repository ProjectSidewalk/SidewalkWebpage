package actor

/**
 * One nightly background job: how its runs are recorded, what to call it in the admin Health panel, and when it is
 * scheduled.
 *
 * @param name   The job's run-record name in `background_job_run`, which is the actor's pekko name.
 * @param label  Human-readable name for the Health panel.
 * @param hour   Hour it is scheduled for, Pacific, before the per-city offset is applied.
 * @param minute Minute it is scheduled for.
 */
case class ScheduledJob(name: String, label: String, hour: Int, minute: Int) {

  /** The scheduled time as `HH:mm`, for display. */
  def scheduledAt: String = f"$hour%02d:$minute%02d"
}

/**
 * The nightly job schedule, in one readable place (#4928).
 *
 * Each actor reads its own time from here rather than holding a literal, so this list is the schedule rather than a
 * copy of it — and it doubles as the roster the Health panel checks, which is what lets the panel report a job that
 * has *never* run. Every job repeats every 24 hours; the times are staggered so the night's work doesn't land at once,
 * and each city shifts the whole schedule by its own offset (`ConfigService.getOffsetHours`) so deployments don't
 * contend for the same database and provider quotas.
 *
 * Ordering matters in one place only: the imagery-freshness sync runs at the top of the street-priority sequence, so
 * the imagery-age poll that feeds it has to come earlier in the night.
 */
object ScheduledJobs {
  val CheckImageExpiry: ScheduledJob = ScheduledJob(CheckImageExpiryActor.Name, "Imagery expiry sweep", 0, 15)
  val GetAiValidations: ScheduledJob = ScheduledJob(GetAiValidationsActor.Name, "AI validations", 0, 30)
  val CheckImageryAge: ScheduledJob  = ScheduledJob(CheckImageryAgeActor.Name, "Imagery-age poll", 0, 45)
  val UserStats: ScheduledJob        = ScheduledJob(UserStatActor.Name, "User stats", 1, 30)

  /** Runs inside the street-priority sequence below, so it shares that job's scheduled time. */
  val ImageryFreshnessSync: ScheduledJob =
    ScheduledJob(RecalculateStreetPriorityActor.FreshnessSyncJobName, "Imagery freshness sync", 1, 45)

  val RecalculateStreetPriority: ScheduledJob =
    ScheduledJob(RecalculateStreetPriorityActor.Name, "Street priority recalculation", 1, 45)

  val OsmWayRefresh: ScheduledJob    = ScheduledJob(OsmWayRefreshActor.Name, "OSM way refresh", 2, 0)
  val AuthTokenCleaner: ScheduledJob = ScheduledJob(AuthTokenCleanerActor.Name, "Auth token cleanup", 2, 30)
  val FunnelStats: ScheduledJob      = ScheduledJob(FunnelStatActor.Name, "Engagement funnel stats", 3, 15)
  val Clustering: ScheduledJob       = ScheduledJob(ClusteringActor.Name, "Label clustering", 4, 0)

  /** Every job the Health panel expects to see a recent run of, in the order they run. */
  val All: Seq[ScheduledJob] = Seq(CheckImageExpiry, GetAiValidations, CheckImageryAge, UserStats, ImageryFreshnessSync,
    RecalculateStreetPriority, OsmWayRefresh, AuthTokenCleaner, FunnelStats, Clustering)

  /**
   * How long after a job's last successful run it counts as overdue, in hours.
   *
   * Every job repeats daily, so 36 hours leaves room for a slow run or a deploy-time restart that pushes one night's
   * firing late without crying wolf, while still catching a scheduler that has stopped.
   */
  val OverdueAfterHours: Long = 36
}
