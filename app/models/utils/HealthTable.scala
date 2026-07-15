package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service._
import slick.jdbc.GetResult

import javax.inject._

/**
 * Read-only DAO of Postgres catalog queries backing the Owner-only Health dashboard (#4561).
 *
 * Every method here reads a system view (`pg_locks`, `pg_stat_activity`, `pg_stat_user_tables`,
 * `pg_stat_database`) or a per-schema `play_evolutions` table; nothing writes. The queries are hand-written raw SQL
 * (rather than Slick table queries) because the catalog views aren't modeled as Slick tables and the shapes are
 * bespoke to each health signal. Cross-schema signals resolve schema names with the `#$schema` literal splice, exactly
 * like [[ConfigTable]]'s per-city aggregates; callers must validate those identifiers first (see [[HealthService]]).
 */
@ImplementedBy(classOf[HealthTable])
trait HealthTableRepository {}

@Singleton
class HealthTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends HealthTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  implicit private val getBlockingSession: GetResult[BlockingSession] = GetResult { r =>
    BlockingSession(r.nextInt(), r.nextStringOption(), r.nextStringOption(), r.nextStringOption(), r.nextLongOption(),
      r.nextLongOption(), r.nextStringOption(), r.nextInt(), r.nextLongOption(), r.nextStringOption())
  }

  implicit private val getIdleTxnSession: GetResult[IdleTxnSession] = GetResult { r =>
    IdleTxnSession(r.nextInt(), r.nextStringOption(), r.nextStringOption(), r.nextStringOption(), r.nextLongOption(),
      r.nextLongOption(), r.nextStringOption())
  }

  implicit private val getStuckEvolution: GetResult[StuckEvolution] = GetResult { r =>
    StuckEvolution(r.nextString(), r.nextInt(), r.nextStringOption(), r.nextStringOption(), r.nextStringOption())
  }

  implicit private val grTableBloat: GetResult[TableBloat] = GetResult { r =>
    TableBloat(r.nextString(), r.nextString(), r.nextLong(), r.nextLong(), r.nextDoubleOption(), r.nextLongOption(),
      r.nextLongOption(), r.nextStringOption())
  }

  implicit private val getConnCount: GetResult[ConnCount] =
    GetResult(r => ConnCount(r.nextStringOption(), r.nextStringOption(), r.nextInt()))

  implicit private val grPanoBackupStats: GetResult[PanoBackupStats] = GetResult { r =>
    PanoBackupStats(r.nextLong(), r.nextLong(), r.nextLong(), r.nextLong(), r.nextLong())
  }

  implicit private val grDbEnvInfo: GetResult[DbEnvInfo] =
    GetResult(r => DbEnvInfo(r.nextString(), r.nextString(), r.nextBoolean()))

  /**
   * Caps a health read so it can never hold a pool connection for long. A monitoring query must not add load — least
   * of all when the database is already stressed, which is exactly when this dashboard gets opened. `statement_timeout`
   * makes the query self-abort after 5s instead of queuing; `.transactionally` scopes the setting to this one query and
   * auto-commits it, so the probe never lingers as an idle-in-transaction of its own.
   */
  private def bounded[T](action: DBIO[T]): DBIO[T] =
    (sqlu"SET LOCAL statement_timeout = 5000" >> action).transactionally

  /**
   * The connecting role's environment: database name, role name, and whether it can read every session's statement
   * text (superuser or `pg_monitor` member). The dashboard uses the last flag to tell the viewer when other sessions'
   * `query` columns are hidden as `<insufficient privilege>` rather than genuinely empty.
   */
  def getDbEnvInfo: DBIO[DbEnvInfo] = bounded {
    sql"""SELECT current_database(),
                 current_user,
                 (current_setting('is_superuser') = 'on'
                  OR pg_has_role(current_user, 'pg_monitor', 'MEMBER'))""".as[DbEnvInfo].head
  }

  /**
   * Sessions that are currently blocking at least one other session — the signal the #4545 outage lacked. For each
   * blocker: who it is, its state (an abandoned lock holder shows as `idle in transaction`), how long its transaction
   * and current state have been open, how many sessions it blocks and the longest wait among them, and the notable
   * (non-read) locks it holds. Ordered so the worst offender is first.
   */
  def getBlockingSessions: DBIO[Seq[BlockingSession]] = bounded {
    sql"""
      WITH blocked AS (
        -- Only a session that is WAITING on a lock can be blocked, so probe pg_blocking_pids() on those alone.
        -- The function briefly takes an exclusive lock on the lock manager's shared state, so calling it once per
        -- backend on every poll would itself add contention — the very anti-pattern this dashboard exists to flag.
        -- wait_event_type = 'Lock' is non-lossy here: the app runs READ COMMITTED, so there are no deferrable-
        -- serializable waiters (the one blocked-but-not-'Lock' case) to miss.
        SELECT pid AS blocked_pid,
               pg_blocking_pids(pid) AS blockers,
               EXTRACT(EPOCH FROM (now() - query_start))::bigint AS wait_seconds
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0
      )
      SELECT a.pid,
             a.usename,
             a.application_name,
             a.state,
             EXTRACT(EPOCH FROM (now() - a.xact_start))::bigint  AS xact_seconds,
             EXTRACT(EPOCH FROM (now() - a.state_change))::bigint AS state_seconds,
             a.query,
             (SELECT count(*)::int  FROM blocked WHERE a.pid = ANY(blocked.blockers)) AS blocking_count,
             (SELECT max(wait_seconds) FROM blocked WHERE a.pid = ANY(blocked.blockers)) AS max_wait_seconds,
             (SELECT string_agg(DISTINCT l.mode || ' on ' || COALESCE(l.relation::regclass::text, l.locktype), ', ')
                FROM pg_locks l
                WHERE l.pid = a.pid AND l.granted
                  AND l.mode NOT IN ('AccessShareLock', 'RowShareLock', 'RowExclusiveLock')) AS held_locks
      FROM pg_stat_activity a
      WHERE a.pid IN (SELECT DISTINCT unnest(blockers) FROM blocked)
      ORDER BY blocking_count DESC, max_wait_seconds DESC NULLS LAST
    """.as[BlockingSession]
  }

  /**
   * Sessions sitting in an open transaction while idle (the #4545 source pattern — a leaked transaction that never
   * commits or rolls back can hold locks for hours). Oldest transaction first; `idle_seconds` is time in the idle
   * state, `xact_seconds` the total transaction age.
   */
  def getIdleInTransactionSessions: DBIO[Seq[IdleTxnSession]] = bounded {
    sql"""
      SELECT pid,
             usename,
             application_name,
             client_addr::text,
             EXTRACT(EPOCH FROM (now() - xact_start))::bigint    AS xact_seconds,
             EXTRACT(EPOCH FROM (now() - state_change))::bigint  AS idle_seconds,
             query
      FROM pg_stat_activity
      WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')
        AND xact_start IS NOT NULL
      ORDER BY xact_start ASC
    """.as[IdleTxnSession]
  }

  /** Every schema in this database that has a `play_evolutions` table (one per city schema). */
  def getEvolutionSchemas: DBIO[Seq[String]] = bounded {
    sql"""SELECT table_schema FROM information_schema.tables
          WHERE table_name = 'play_evolutions' ORDER BY table_schema""".as[String]
  }

  /**
   * Evolution rows that are stuck mid-apply or carry a recorded problem, across the given schemas in ONE query —
   * catches #4557 (evolution 326 failing to apply on a prod city). Built as a `UNION ALL` with one branch per schema
   * so a cluster with ~50 city schemas costs a single query, not one-per-schema: an N-way fan-out would demand ~50
   * pool connections on every poll and become the connection flood (#4559) this dashboard exists to detect.
   *
   * Every `schema` MUST already be validated as a bare identifier by the caller (see [[HealthService]]); the names are
   * spliced literally into the SQL, so an unvalidated name would be an injection vector.
   *
   * @param schemas Validated schema names whose `play_evolutions` tables to inspect. Must be non-empty.
   * @return        One row per stuck/flagged evolution, tagged with its schema; empty if every schema is clean.
   */
  def getStuckEvolutionsForSchemas(schemas: Seq[String]): DBIO[Seq[StuckEvolution]] = {
    val union = schemas
      .map { schema =>
        s"""SELECT text '$schema' AS schema, id, state, last_problem, applied_at::text
            FROM "$schema".play_evolutions
            WHERE state LIKE 'applying%' OR (last_problem IS NOT NULL AND btrim(last_problem) <> '')"""
      }
      .mkString("\nUNION ALL\n")
    bounded(sql"""#$union ORDER BY schema, id""".as[StuckEvolution])
  }

  /**
   * Dead-tuple bloat and last-vacuum age for the heavyweight tables across every city schema (#4558). `n_live_tup`
   * is a planner estimate and can read as 0 right after a dump restore, so `dead_ratio` alone is not trustworthy —
   * the dashboard also gates on the absolute `n_dead_tup` before flagging.
   */
  def getTableBloat: DBIO[Seq[TableBloat]] = bounded {
    sql"""
      SELECT schemaname,
             relname,
             n_live_tup,
             n_dead_tup,
             round((n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)), 4)::float8 AS dead_ratio,
             EXTRACT(EPOCH FROM (now() - GREATEST(last_autovacuum, last_vacuum)))::bigint   AS vacuum_age_seconds,
             EXTRACT(EPOCH FROM (now() - GREATEST(last_autoanalyze, last_analyze)))::bigint AS analyze_age_seconds,
             GREATEST(last_autovacuum, last_vacuum)::text AS last_vacuum
      FROM pg_stat_user_tables
      WHERE relname IN ('street_edge', 'label', 'audit_task_interaction')
      ORDER BY n_dead_tup DESC
    """.as[TableBloat]
  }

  /**
   * Client-backend connection counts grouped by role and state for this database — a per-city view of connection
   * pressure against each instance's pool ceiling (#4559). Cluster-global, so one instance sees every city's role.
   */
  def getConnectionCounts: DBIO[Seq[ConnCount]] = bounded {
    sql"""
      SELECT usename, state, count(*)::int AS cnt
      FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend'
      GROUP BY usename, state
      ORDER BY cnt DESC
    """.as[ConnCount]
  }

  /**
   * Backup-coverage counts for the current city's labeled panos: how many of the panos that carry a label have a
   * locally-hosted backup image vs. are unchecked, missing, or at-risk (source expired AND no backup, so the label
   * has no viewable imagery). `has_backup` is refreshed lazily by the imagery check, so a large `unchecked` (NULL)
   * count is normal and these counts approximate on-disk truth. Schema-local (resolves via the connection search_path).
   */
  def getPanoBackupStats: DBIO[PanoBackupStats] = bounded {
    sql"""
      WITH labeled AS (
        SELECT DISTINCT pano_id FROM label WHERE pano_id IS NOT NULL AND pano_id <> 'tutorial'
      )
      SELECT count(*)::bigint                                                                  AS labeled_panos,
             count(*) FILTER (WHERE pd.has_backup IS TRUE)::bigint                             AS backed_up,
             count(*) FILTER (WHERE pd.has_backup IS FALSE)::bigint                            AS no_backup,
             count(*) FILTER (WHERE pd.has_backup IS NULL)::bigint                             AS unchecked,
             count(*) FILTER (WHERE pd.expired IS TRUE AND pd.has_backup IS NOT TRUE)::bigint  AS at_risk
      FROM labeled
      LEFT JOIN pano_data pd ON pd.pano_id = labeled.pano_id
    """.as[PanoBackupStats].head
  }
}
