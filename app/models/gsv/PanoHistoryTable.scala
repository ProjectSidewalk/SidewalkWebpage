package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.sql.Timestamp
import java.text.SimpleDateFormat
import java.util.{Date, TimeZone}
import scala.slick.lifted.ForeignKeyQuery
import scala.util.Try

case class PanoHistory(panoId: String, captureDate: String, locationCurrentPanoId: String)

class PanoHistoryTable(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Column[String] = column[String]("pano_id", O.NotNull)
  def captureDate: Column[String] = column[String]("capture_date", O.NotNull)
  def locationCurrentPanoId: Column[String] = column[String]("location_current_pano_id", O.NotNull)
  def * = (panoId, captureDate, locationCurrentPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)
  def locationCurrentPano: ForeignKeyQuery[GSVDataTable, GSVData] = foreignKey("pano_history_gsv_panorama_id_fkey", locationCurrentPanoId, TableQuery[GSVDataTable])(_.gsvPanoramaId)
}

object PanoHistoryTable {
  val db = play.api.db.slick.DB
  val panoHistoryTable = TableQuery[PanoHistoryTable]

  /**
    * Save a pano history object to the PanoHistory table.
    */
  def save(history: PanoHistory): Unit = db.withSession { implicit session =>
    panoHistoryTable += history
  }
}
