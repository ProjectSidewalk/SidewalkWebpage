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
 * NOTE: if changing these values, update the `pano_imagery_change_source` Postgres enum type as well (see 363.sql).
 */
object PanoImageryChangeSource extends Enumeration {
  type PanoImageryChangeSource = Value

  /** An imagery-provider existence check, whether the nightly sweep's or an on-demand one. */
  val ProviderCheck: Value = Value("provider_check")

  /** A labeler loaded the pano, which is itself proof the imagery is there. */
  val PanoView: Value = Value("pano_view")

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
 * Read-only DAO over the pano imagery-transition log (#4947).
 *
 * The rows are written by `PanoDataTable`, in the same statement as the `expired` flip they describe, so nothing here
 * inserts. What this table buys over `pano_data.expired_at` is that its rows are never rewritten: `expired_at` is
 * cleared when the imagery returns, which retroactively empties the week the pano expired in, while a log row stays
 * put and the recovery arrives as its own event.
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
   * @param since Only transitions at or after this instant.
   */
  def transitionsByWeek(since: OffsetDateTime): DBIO[Seq[PanoImageryWeek]] = {
    sql"""SELECT date_trunc('week', changed_at)::date,
                 COUNT(DISTINCT pano_id) FILTER (WHERE expired),
                 COUNT(DISTINCT pano_id) FILTER (WHERE NOT expired)
          FROM pano_imagery_change
          WHERE changed_at >= $since
          GROUP BY date_trunc('week', changed_at)::date
          ORDER BY date_trunc('week', changed_at)::date""".as[PanoImageryWeek]
  }
}
