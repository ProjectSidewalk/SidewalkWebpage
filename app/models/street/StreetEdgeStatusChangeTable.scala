package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * What changed a street's status, backing the `street_edge_status_change_source` Postgres enum type.
 *
 * Most values name one of the hand-run scripts in `db/scripts` that write `street_edge.status`; `admin_reopen` is
 * the one in-app writer, the Reopen button on /admin/street-status (#4929). Since script runs are otherwise
 * untraced, this is what tells a later reader whether a batch of streets went dark because the imagery checker found
 * nothing there or because someone closed the whole neighborhood.
 *
 * NOTE: if changing these values, update the `street_edge_status_change_source` Postgres enum type as well (see
 * 358.sql and 365.sql) and the script or service that emits it.
 */
object StreetEdgeStatusChangeSource extends Enumeration {
  type StreetEdgeStatusChangeSource = Value
  val HideStreetsWithoutImagery: Value = Value("hide_streets_without_imagery")
  val RevealNeighborhoods: Value       = Value("reveal_neighborhoods")
  val HideNeighborhoods: Value         = Value("hide_neighborhoods")
  val RemoveStreets: Value             = Value("remove_streets")
  val AdminReopen: Value               = Value("admin_reopen")

  /** Parses a string into a status change source, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}

/** One recorded transition of a street between two `street_edge_status` values. */
case class StreetEdgeStatusChange(
    streetEdgeStatusChangeId: Int,
    streetEdgeId: Int,
    oldStatus: StreetEdgeStatus.Value,
    newStatus: StreetEdgeStatus.Value,
    changedAt: OffsetDateTime,
    source: StreetEdgeStatusChangeSource.Value
)

/** Streets that entered one status during one week. */
case class StatusChangeWeek(weekStart: LocalDate, newStatus: StreetEdgeStatus.Value, streetCount: Int)

class StreetEdgeStatusChangeTableDef(tag: Tag) extends Table[StreetEdgeStatusChange](tag, "street_edge_status_change") {
  def streetEdgeStatusChangeId: Rep[Int] =
    column[Int]("street_edge_status_change_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int]                          = column[Int]("street_edge_id")
  def oldStatus: Rep[StreetEdgeStatus.Value]          = column[StreetEdgeStatus.Value]("old_status")
  def newStatus: Rep[StreetEdgeStatus.Value]          = column[StreetEdgeStatus.Value]("new_status")
  def changedAt: Rep[OffsetDateTime]                  = column[OffsetDateTime]("changed_at") // DEFAULT now() in the DB.
  def source: Rep[StreetEdgeStatusChangeSource.Value] = column[StreetEdgeStatusChangeSource.Value]("source")

  // CHECK constraint, which Slick can't express: old_status <> new_status, so only real transitions are recorded.
  def * = (streetEdgeStatusChangeId, streetEdgeId, oldStatus, newStatus, changedAt, source) <> (
    (StreetEdgeStatusChange.apply _).tupled,
    StreetEdgeStatusChange.unapply
  )

  // ON DELETE CASCADE, which remove_streets.sql relies on: once the street row is gone, its status history describes
  // nothing, so that script deletes no rows here of its own.
  def streetEdge =
    foreignKey("street_edge_status_change_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(
      _.streetEdgeId,
      onDelete = ForeignKeyAction.Cascade
    )
}

@ImplementedBy(classOf[StreetEdgeStatusChangeTable])
trait StreetEdgeStatusChangeTableRepository {}

/**
 * Read-only DAO over the street status-change log (#4928).
 *
 * Writers insert their own rows in the same transaction as the status update itself: the `db/scripts` shell scripts
 * for every transition except `no_imagery -> open`, which the admin Reopen action performs in-app
 * (StreetLifecycleService.reopenStreet, #4929). This DAO only reads the log back for the admin trend charts.
 */
@Singleton
class StreetEdgeStatusChangeTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetEdgeStatusChangeTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val statusChanges = TableQuery[StreetEdgeStatusChangeTableDef]

  implicit private val getStatusChangeWeek: GetResult[StatusChangeWeek] = GetResult { r =>
    StatusChangeWeek(r.nextDate().toLocalDate, StreetEdgeStatus.withName(r.nextString()), r.nextInt())
  }

  /**
   * Streets entering each status, bucketed by ISO week, for the "recently changed" chart.
   *
   * Counts distinct streets rather than rows: a street bounced between two statuses inside one week is one street
   * that ended up somewhere, not two events worth charting. Weeks with no transitions are simply absent — the client
   * zero-fills, matching the other admin time series.
   *
   * @param since Only transitions at or after this instant.
   */
  def transitionsByWeek(since: OffsetDateTime): DBIO[Seq[StatusChangeWeek]] = {
    sql"""SELECT date_trunc('week', changed_at)::date, new_status, COUNT(DISTINCT street_edge_id)
          FROM street_edge_status_change
          WHERE changed_at >= $since
          GROUP BY date_trunc('week', changed_at)::date, new_status
          ORDER BY date_trunc('week', changed_at)::date""".as[StatusChangeWeek]
  }
}
