package models.pano

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class PanoHistory(panoId: String, captureDate: String, locationCurrPanoId: String)

class PanoHistoryTableDef(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Rep[String]             = column[String]("pano_id")
  def captureDate: Rep[String]        = column[String]("capture_date")
  def locationCurrPanoId: Rep[String] = column[String]("location_curr_pano_id")

  def * = (panoId, captureDate, locationCurrPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)

  def locationCurrentPano =
    foreignKey("pano_history_location_curr_pano_id_fkey", locationCurrPanoId, TableQuery[PanoDataTableDef])(_.panoId)
  def pk = primaryKey("pano_history_pkey", (panoId, locationCurrPanoId))
}

@ImplementedBy(classOf[PanoHistoryTable])
trait PanoHistoryTableRepository {}

@Singleton
class PanoHistoryTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends PanoHistoryTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val panoHistoryTable = TableQuery[PanoHistoryTableDef]

  /**
   * Save a pano history object to the PanoHistory table if it isn't already in the table.
   *
   * `ON CONFLICT DO NOTHING` rather than a check-then-insert, so concurrent submissions of the same history entry
   * (e.g. a `pagehide` flush racing a mission-complete POST) can't fail on a duplicate key (#4587).
   *
   * @return Number of rows inserted (0 if the history entry was already recorded).
   */
  def insertIfNew(history: PanoHistory): DBIO[Int] = {
    sqlu"""
      INSERT INTO pano_history (pano_id, capture_date, location_curr_pano_id)
      VALUES (${history.panoId}, ${history.captureDate}, ${history.locationCurrPanoId})
      ON CONFLICT DO NOTHING
    """
  }
}
