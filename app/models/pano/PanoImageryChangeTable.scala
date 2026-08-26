package models.pano

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * What moved a pano across the expired boundary, backing the `pano_imagery_change_source` Postgres enum type.
 *
 * NOTE: if changing these values, update the `pano_imagery_change_source` Postgres enum type as well (see 364.sql).
 */
object PanoImageryChangeSource extends Enumeration {
  type PanoImageryChangeSource = Value

  /** An imagery-provider existence check, whether the nightly sweep's or an on-demand one. */
  val ProviderCheck: Value = Value("provider_check")

  /** A labeler loaded the pano, which is itself proof the imagery is there. */
  val PanoView: Value = Value("pano_view")

  /**
   * A healed event from the nightly reconciliation pass (#5007): the newest log row disagreed with
   * `pano_data.expired`, so a writer missed a transition. Carries detection time, not the real transition time.
   */
  val Reconciliation: Value = Value("reconciliation")

  /** Parses a string into a change source, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}

/**
 * One recorded crossing of the expired boundary for one pano.
 *
 * @param expired The state moved *into*: true when the imagery went away, false when it came back.
 */
case class PanoImageryChange(
    panoImageryChangeId: Int,
    panoId: String,
    expired: Boolean,
    changedAt: OffsetDateTime,
    source: PanoImageryChangeSource.Value
)

/** Panos whose imagery went away, and whose imagery came back, during one week. */
case class PanoImageryWeek(weekStart: LocalDate, expiredCount: Int, returnedCount: Int)

class PanoImageryChangeTableDef(tag: Tag) extends Table[PanoImageryChange](tag, "pano_imagery_change") {
  def panoImageryChangeId: Rep[Int]              = column[Int]("pano_imagery_change_id", O.PrimaryKey, O.AutoInc)
  def panoId: Rep[String]                        = column[String]("pano_id")
  def expired: Rep[Boolean]                      = column[Boolean]("expired")
  def changedAt: Rep[OffsetDateTime]             = column[OffsetDateTime]("changed_at") // DEFAULT now() in the DB.
  def source: Rep[PanoImageryChangeSource.Value] = column[PanoImageryChangeSource.Value]("source")

  def * = (panoImageryChangeId, panoId, expired, changedAt, source) <> (
    (PanoImageryChange.apply _).tupled,
    PanoImageryChange.unapply
  )

  // ON DELETE CASCADE: once the pano row is gone, its imagery history describes nothing.
  def pano =
    foreignKey("pano_imagery_change_pano_id_fkey", panoId, TableQuery[PanoDataTableDef])(
      _.panoId,
      onDelete = ForeignKeyAction.Cascade
    )
}

@ImplementedBy(classOf[PanoImageryChangeTable])
trait PanoImageryChangeTableRepository {}

/**
 * DAO over the pano imagery-transition log (#4947).
 *
 * The rows are written by `PanoDataTable`, in the same statement as the `expired` flip they describe; the one insert
 * here is `reconcile`, which heals events those writers missed rather than observing transitions itself (#5007).
 * What this table buys over `pano_data.expired_at` is that its rows are never rewritten: `expired_at` is cleared
 * when the imagery returns, which retroactively empties the week the pano expired in, while a log row stays put and
 * the recovery arrives as its own event.
 */
@Singleton
class PanoImageryChangeTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends PanoImageryChangeTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val imageryChanges = TableQuery[PanoImageryChangeTableDef]

  implicit private val getPanoImageryWeek: GetResult[PanoImageryWeek] =
    GetResult(r => PanoImageryWeek(r.nextDate().toLocalDate, r.nextInt(), r.nextInt()))

  /**
   * Panos crossing the expired boundary in each direction, bucketed by ISO week, for the admin imagery chart.
   *
   * Counts distinct panos per direction rather than rows: a pano that flickered twice inside one week is one pano
   * that went away and one that came back, not a spike. Weeks with nothing to report are absent — the client
   * zero-fills, matching the other admin time series.
   *
   * Healed rows are left out: a `reconciliation` row's `changed_at` is when the pass noticed, so charting one would
   * put a crossing in a week it did not happen in — the rewriting of history this table exists to stop.
   * `healedSince` counts what the window is therefore missing, and the page owns that gap like the undated one.
   *
   * @param since Only transitions at or after this instant.
   */
  def transitionsByWeek(since: OffsetDateTime): DBIO[Seq[PanoImageryWeek]] = {
    val healed = PanoImageryChangeSource.Reconciliation.toString
    sql"""SELECT date_trunc('week', changed_at)::date,
                 COUNT(DISTINCT pano_id) FILTER (WHERE expired),
                 COUNT(DISTINCT pano_id) FILTER (WHERE NOT expired)
          FROM pano_imagery_change
          WHERE changed_at >= $since
              AND source <> $healed::pano_imagery_change_source
          GROUP BY date_trunc('week', changed_at)::date
          ORDER BY date_trunc('week', changed_at)::date""".as[PanoImageryWeek]
  }

  /**
   * Panos the reconciliation pass healed inside the window: real crossings `transitionsByWeek` cannot place.
   *
   * Counts distinct panos, the unit that series reports in, so the page can set the two side by side.
   *
   * @param since Only healed rows at or after this instant.
   */
  def healedSince(since: OffsetDateTime): DBIO[Int] = {
    val healed = PanoImageryChangeSource.Reconciliation.toString
    sql"""SELECT COUNT(DISTINCT pano_id)
          FROM pano_imagery_change
          WHERE changed_at >= $since
              AND source = $healed::pano_imagery_change_source""".as[Int].head
  }

  /**
   * Inserts the missing event for every pano whose log disagrees with its current `pano_data.expired`.
   *
   * The log depends on every writer of `pano_data.expired` recording its own transition in-statement, and a miss —
   * a writer that forgets to log, or the snapshot race documented on `PanoDataTable.updateExpiredStatus` — leaves
   * one of two footprints. Run nightly after the expiry sweep, this turns each into a row marked `reconciliation`,
   * whose `changed_at` (the column's DEFAULT now()) is detection time rather than the real transition time — which
   * is why the marker exists, and why `transitionsByWeek` leaves these rows out.
   *
   * The first footprint is a newest log row contradicting the flag. The second is a dated expiry with no log rows
   * at all: 364 seeded a row for every pano `expired_at` had a date for, so one arriving since then went unlogged.
   * That second shape is the likelier one — only panos that have already crossed carry log history, so a new
   * writer's first miss lands on a pano with none.
   *
   * Undated expiries stay excluded: those are the pre-358 ones 364 had no date to seed from (the chart's
   * undated-expiries footnote), where nothing claims a transition happened. A writer that skips `expired_at` too is
   * indistinguishable from them, so it stays invisible here.
   *
   * One statement means one snapshot, so each pano row and its log are read consistently. A flip committing
   * concurrently can still make an inserted event stale by the time it lands; the next night's pass detects and
   * heals that, the same self-correcting posture as the race this exists to repair. Do not add `FOR UPDATE` — see
   * the trap documented on `updateExpiredStatus`.
   *
   * @return The ids of the panos healed. Non-empty means a writer skipped the log or the snapshot race fired.
   */
  def reconcile(): DBIO[Seq[String]] = {
    val source = PanoImageryChangeSource.Reconciliation.toString
    sql"""WITH latest AS (
            SELECT DISTINCT ON (pano_id) pano_id, expired
            FROM pano_imagery_change
            ORDER BY pano_id, changed_at DESC, pano_imagery_change_id DESC
          )
          INSERT INTO pano_imagery_change (pano_id, expired, source)
          SELECT pano_data.pano_id, pano_data.expired, $source::pano_imagery_change_source
          FROM pano_data
          LEFT JOIN latest ON pano_data.pano_id = latest.pano_id
          WHERE (latest.pano_id IS NOT NULL AND latest.expired <> pano_data.expired)
              OR (latest.pano_id IS NULL AND pano_data.expired AND pano_data.expired_at IS NOT NULL)
          RETURNING pano_id""".as[String]
  }
}
