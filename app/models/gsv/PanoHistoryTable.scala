package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class PanoHistory(panoId: String, captureDate: String, locationCurrPanoId: String)

class PanoHistoryTable(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Column[String] = column[String]("pano_id", O.NotNull)
  def captureDate: Column[String] = column[String]("capture_date", O.NotNull)
  def locationCurrPanoId: Column[String] = column[String]("location_curr_pano_id", O.NotNull)

  def * = (panoId, captureDate, locationCurrPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)

  def locationCurrentPano: ForeignKeyQuery[GSVDataTable, GSVData] = foreignKey("pano_history_gsv_panorama_id_fkey", locationCurrPanoId, TableQuery[GSVDataTable])(_.gsvPanoramaId)
}

object PanoHistoryTable {
  val db = play.api.db.slick.DB
  val panoHistoryTable = TableQuery[PanoHistoryTable]

  /**
    * Save a pano history object to the PanoHistory table if it isn't already in the table.
    */
  def save(history: PanoHistory): Int = db.withSession { implicit session =>
    if (panoHistoryTable.filter(h => h.panoId === history.panoId && h.locationCurrPanoId === history.locationCurrPanoId).list.isEmpty) {
      panoHistoryTable += history
    } else {
      0
    }
  }
}
