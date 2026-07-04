package models.utils

import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * One precomputed funnel row: the (up to six) monotonic step counts for a single funnel type, window, and segment (#288).
 *
 * @param funnelType "mapping" (6 steps) or "contribution" (3 steps; step4..6 are 0).
 * @param window     The funnel time window: "30d", "90d", or "all".
 * @param segment    The population slice: "all", "role:registered", "role:anon", "device:desktop", "device:mobile",
 *                   or "device:unknown".
 * @param steps      Six funnel counts (distinct users reaching each step), index 0 = step 1; trailing entries are 0 for
 *                   funnels with fewer than six steps.
 * @param computedAt When this row was last recomputed (for the page's "data as of" freshness label).
 */
case class FunnelStat(funnelType: String, window: String, segment: String, steps: Seq[Int], computedAt: OffsetDateTime)

/**
 * The raw per-segment output of a funnel computation, before it is stamped with a funnel type, window, and recompute
 * time (#288).
 *
 * @param segment One of the segment keys (see [[FunnelStat]]).
 * @param steps   The monotonic step counts for that segment (length matches the funnel's step count).
 */
case class FunnelSegmentCounts(segment: String, steps: Seq[Int])

class FunnelStatTableDef(tag: Tag) extends Table[FunnelStat](tag, "funnel_stat") {
  def funnelType: Rep[String]         = column[String]("funnel_type")
  def timeWindow: Rep[String]         = column[String]("time_window")
  def segment: Rep[String]            = column[String]("segment")
  def step1: Rep[Int]                 = column[Int]("step1")
  def step2: Rep[Int]                 = column[Int]("step2")
  def step3: Rep[Int]                 = column[Int]("step3")
  def step4: Rep[Int]                 = column[Int]("step4")
  def step5: Rep[Int]                 = column[Int]("step5")
  def step6: Rep[Int]                 = column[Int]("step6")
  def computedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("computed_at")

  // steps is a fixed six-slot Seq, so the projection maps the six step columns to/from it explicitly.
  override def * = (funnelType, timeWindow, segment, step1, step2, step3, step4, step5, step6, computedAt) <> (
    { case (funnelType, window, segment, s1, s2, s3, s4, s5, s6, computedAt) =>
      FunnelStat(funnelType, window, segment, Seq(s1, s2, s3, s4, s5, s6), computedAt)
    },
    (f: FunnelStat) => {
      val s = f.steps.padTo(6, 0) // contribution funnel has 3 steps; pad the unused slots with 0.
      Some((f.funnelType, f.window, f.segment, s(0), s(1), s(2), s(3), s(4), s(5), f.computedAt))
    }
  )
}

/**
 * DAO for the per-deployment precomputed engagement funnels (#288): a "mapping" funnel (the Explore onboarding flow)
 * and a "contribution" funnel (any labeling-or-validation contribution).
 *
 * The funnels are too heavy to compute live across every city schema on each Across Cities page load (they scan the
 * large `webpage_activity` log), so each deployment recomputes ITS OWN funnels nightly into the local `funnel_stat`
 * table (mirroring the user_stat precompute), and the cross-city page reads each schema's tiny precomputed table
 * cheaply. Hence the split: [[computeMappingFunnelBySchema]] / [[computeContributionFunnelBySchema]] + [[replaceAll]]
 * write the local table; [[getFunnelStatsBySchema]] reads any schema's precomputed table.
 */
@Singleton
class FunnelStatTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends HasDatabaseConfigProvider[MyPostgresProfile] {

  private val funnelStats = TableQuery[FunnelStatTableDef]

  /**
   * Replaces the entire local `funnel_stat` table with a fresh set of rows, transactionally (#288).
   *
   * The table is tiny (<= 36 rows) and recomputed wholesale, so a delete-then-insert is simpler and safer than an
   * upsert and avoids leaving stale (funnel_type, window, segment) combinations behind.
   *
   * @param stats The full set of rows to persist.
   * @return      The number of rows written.
   */
  def replaceAll(stats: Seq[FunnelStat]): DBIO[Int] = {
    (for {
      _ <- funnelStats.delete
      _ <- funnelStats ++= stats
    } yield stats.size).transactionally
  }

  /**
   * Reads one window's precomputed funnel rows (all funnel types) from an arbitrary city schema (#288).
   *
   * Used by the cross-city Across Cities page, which reads every available schema's `funnel_stat`. The schema name is
   * interpolated (it comes from trusted config, not user input); the window is a bound parameter.
   *
   * @param schema The database schema to read from.
   * @param window The funnel window key ("30d", "90d", or "all").
   * @return       The rows for that window across all funnel types; empty if the schema has no funnel_stat yet.
   */
  def getFunnelStatsBySchema(schema: String, window: String): DBIO[Seq[FunnelStat]] = {
    implicit val getResult: GetResult[FunnelStat] = GetResult { r =>
      FunnelStat(
        r.nextString(),
        r.nextString(),
        r.nextString(),
        Seq(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        r.nextTimestamp().toInstant.atOffset(ZoneOffset.UTC)
      )
    }
    sql"""SELECT funnel_type, time_window, segment, step1, step2, step3, step4, step5, step6, computed_at
          FROM "#$schema".funnel_stat
          WHERE time_window = $window""".as[FunnelStat]
  }

  /**
   * The Explore/mapping funnel for a city schema (#288): visited (any site-entry page-view event; see
   * [[WebpageActivityTable.SiteEntryActivityPredicate]], #4380), started the tutorial, finished OR skipped the
   * tutorial (skipping sets completed = true), took a step (walked some distance in a real audit mission via
   * `distance_progress`), placed a real label, completed an audit mission. Validation is deliberately excluded — it is
   * a separate activity and belongs to the contribution funnel. The redundant "clicked Start Mapping" and "started a
   * mission" signals are omitted because they duplicate the tutorial-start and tutorial-finish steps (the missions are
   * auto-created).
   *
   * @param schema     The database schema to compute over.
   * @param windowDays The trailing window in days, or None for all-time.
   * @return           One [[FunnelSegmentCounts]] (6 steps) per non-empty segment.
   */
  def computeMappingFunnelBySchema(schema: String, windowDays: Option[Int]): DBIO[Seq[FunnelSegmentCounts]] = {
    val b      = bounds(windowDays)
    val events =
      s"""
        ${visitedStep1(schema, b.wa)}
        UNION ALL
        SELECT user_id, 2 AS step FROM "$schema".mission WHERE mission_type_id = 1 ${b.mStart}
        UNION ALL
        SELECT user_id, 3 AS step FROM "$schema".mission WHERE mission_type_id = 1 AND completed = TRUE ${b.mEnd}
        UNION ALL
        SELECT user_id, 4 AS step FROM "$schema".mission
            WHERE mission_type_id = 2 AND COALESCE(distance_progress, 0) > 0 ${b.mStart}
        UNION ALL
        SELECT user_id, 5 AS step FROM "$schema".label WHERE deleted = FALSE AND tutorial = FALSE ${b.label}
        UNION ALL
        SELECT user_id, 6 AS step FROM "$schema".mission WHERE mission_type_id = 2 AND completed = TRUE ${b.mEnd}
      """
    computeFunnel(schema, events, numSteps = 6)
  }

  /**
   * The contribution funnel for a city schema (#288): visited (any site-entry page-view event; see
   * [[WebpageActivityTable.SiteEntryActivityPredicate]], #4380), contributed (placed at least one real label OR cast
   * at least one validation), completed a labeling (type 2) or validation (type 4) mission. This is the broad "did
   * they contribute anything and finish something" view, complementing the mapping funnel.
   *
   * @param schema     The database schema to compute over.
   * @param windowDays The trailing window in days, or None for all-time.
   * @return           One [[FunnelSegmentCounts]] (3 steps) per non-empty segment.
   */
  def computeContributionFunnelBySchema(schema: String, windowDays: Option[Int]): DBIO[Seq[FunnelSegmentCounts]] = {
    val b      = bounds(windowDays)
    val events =
      s"""
        ${visitedStep1(schema, b.wa)}
        UNION ALL
        SELECT user_id, 2 AS step FROM "$schema".label WHERE deleted = FALSE AND tutorial = FALSE ${b.label}
        UNION ALL
        SELECT user_id, 2 AS step FROM "$schema".label_validation WHERE TRUE ${b.validation}
        UNION ALL
        SELECT user_id, 3 AS step FROM "$schema".mission
            WHERE mission_type_id IN (2, 4) AND completed = TRUE ${b.mEnd}
      """
    computeFunnel(schema, events, numSteps = 3)
  }

  /**
   * The shared step-1 ("visited") SELECT for both funnels: users with an in-window site-entry page-view event
   * ([[WebpageActivityTable.SiteEntryActivityPredicate]]). Both funnels must use the identical definition so step 1
   * stays a true superset of every later step and both funnels report the same visitor total (#288/#4380). The schema
   * is trusted config, so it is spliced literally.
   *
   * @param schema  The database schema to read from.
   * @param waBound The window-bound fragment for `webpage_activity.timestamp` (empty for all-time).
   * @return        A `SELECT user_id, 1 AS step ...` fragment for the funnel's UNION ALL body.
   */
  private def visitedStep1(schema: String, waBound: String): String =
    s"""SELECT user_id, 1 AS step FROM "$schema".webpage_activity
            WHERE ${WebpageActivityTable.SiteEntryActivityPredicate} $waBound"""

  /** Per-source window-bound SQL fragments (empty for all-time). windowDays is an Int, so it is safe to interpolate. */
  private case class Bounds(wa: String, mStart: String, mEnd: String, label: String, validation: String)
  private def bounds(windowDays: Option[Int]): Bounds = {
    def bound(col: String): String =
      windowDays.map(d => s"AND $col >= NOW() - ($d * INTERVAL '1 day')").getOrElse("")
    Bounds(
      wa = bound("webpage_activity.timestamp"), mStart = bound("mission.mission_start"),
      mEnd = bound("mission.mission_end"), label = bound("label.time_created"),
      validation = bound("label_validation.end_timestamp")
    )
  }

  /**
   * Runs a funnel: from a per-step `events` body (each row is a (user_id, step) for a step the user reached), reduce to
   * each user's DEEPEST step, classify role and device, then count per segment with `COUNT(*) FILTER (WHERE deepest >=
   * k)`. The max-reached-step method guarantees a monotonic, nested funnel even though the source events are not
   * naturally nested. Device is all-time (a user attribute), not windowed. The AI user is excluded; anonymous users are
   * a real per-cookie population, kept and counted. The schema and events body are trusted (config + code), so they are
   * spliced in literally.
   *
   * @param schema   The database schema (already validated as a configured city schema).
   * @param events   The UNION ALL body producing (user_id, step) rows.
   * @param numSteps How many step columns to aggregate (6 for mapping, 3 for contribution).
   * @return         One [[FunnelSegmentCounts]] per non-empty segment.
   */
  private def computeFunnel(schema: String, events: String, numSteps: Int): DBIO[Seq[FunnelSegmentCounts]] = {
    implicit val getResult: GetResult[FunnelSegmentCounts] =
      GetResult(r => FunnelSegmentCounts(r.nextString(), Vector.fill(numSteps)(r.nextInt())))
    val filterCols =
      (1 to numSteps).map(k => s"COUNT(*) FILTER (WHERE deepest >= $k) AS s$k").mkString(",\n             ")
    val query =
      s"""
        WITH events AS ( $events ),
        device AS (
            SELECT DISTINCT ON (user_id) user_id, dev
            FROM (
                SELECT mission.user_id AS user_id,
                       CASE WHEN audit_task_environment.operating_system ~* 'android|iphone|ipad|ios|mobile'
                                 OR COALESCE(audit_task_environment.screen_width, audit_task_environment.browser_width) < 768
                                THEN 'mobile'
                            WHEN audit_task_environment.operating_system IS NOT NULL
                                 OR audit_task_environment.screen_width IS NOT NULL
                                 OR audit_task_environment.browser_width IS NOT NULL
                                THEN 'desktop'
                            ELSE NULL END AS dev,
                       2 AS prio
                FROM "$schema".audit_task_environment
                INNER JOIN "$schema".mission ON audit_task_environment.mission_id = mission.mission_id
                UNION ALL
                SELECT user_id,
                       CASE WHEN activity = 'Visit_MobileLanding' THEN 'mobile'
                            WHEN activity = 'Visit_Index' THEN 'desktop'
                            ELSE NULL END AS dev,
                       1 AS prio
                FROM "$schema".webpage_activity
                WHERE activity IN ('Visit_Index', 'Visit_MobileLanding')
            ) hints
            WHERE dev IS NOT NULL
            ORDER BY user_id, prio DESC, (dev = 'desktop') DESC
        ),
        per_user AS (
            SELECT events.user_id,
                   MAX(events.step) AS deepest,
                   CASE WHEN bool_or(role.role = 'Anonymous') THEN 'anon' ELSE 'registered' END AS role_class,
                   COALESCE(MAX(device.dev), 'unknown') AS device_class
            FROM events
            LEFT JOIN sidewalk_login.user_role ON events.user_id = user_role.user_id
            LEFT JOIN sidewalk_login.role ON user_role.role_id = role.role_id
            LEFT JOIN device ON device.user_id = events.user_id
            WHERE role.role IS DISTINCT FROM 'AI'
            GROUP BY events.user_id
            -- A funnel starts at step 1: only count users who actually have the step-1 (visit) event. Without this, a
            -- user with downstream activity but no in-window site-entry event would be counted in step 1 via
            -- deepest >= 1, inflating "visited" and making it differ between funnels that draw from different downstream
            -- tables. Anchoring on step 1 makes step 1 = distinct visitors, identical across funnels and a true superset
            -- of every later step (#288).
            HAVING bool_or(events.step = 1)
        ),
        segmented AS (
            SELECT deepest, 'all' AS segment FROM per_user
            UNION ALL SELECT deepest, 'role:' || role_class FROM per_user
            UNION ALL SELECT deepest, 'device:' || device_class FROM per_user
        )
        SELECT segment,
               $filterCols
        FROM segmented
        GROUP BY segment
      """
    sql"""#$query""".as[FunnelSegmentCounts]
  }
}
