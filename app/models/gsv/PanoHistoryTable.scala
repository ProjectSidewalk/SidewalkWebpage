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
  def panoId: Column[String] = column[String]("pano_id", O.PrimaryKey)
  def captureDate: Column[String] = column[String]("capture_date", O.NotNull)
  def locationCurrentPanoId: Column[String] = column[String]("location_current_pano_id", O.NotNull)
  def * = (panoId, captureDate, locationCurrentPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)
  def locationCurrentPano: ForeignKeyQuery[GSVDataTable, GSVData] = foreignKey("pano_history_gsv_panorama_id_fkey", locationCurrentPanoId, TableQuery[GSVDataTable])(_.gsvPanoramaId)
}

object PanoHistoryTable {
  val db = play.api.db.slick.DB
  val panoHistoryTable = TableQuery[PanoHistoryTable]

  /**
    * Get all pano histories.
    */
  def selectAllPanoHistories(): List[PanoHistory] = db.withSession { implicit session =>
    panoHistoryTable.list
  }

  /**
    * Checking if a row exists with a specific panoId.
    */
  def getRowByPanoId(panoId: String): Option[PanoHistory] = db.withSession { implicit session =>
    val query = for {
      row <- panoHistoryTable if row.panoId === panoId
    } yield row

    query.firstOption
  }

  /**
    * For any rows that have a given location_current_pano_id value, update that field to a new value.
    */
  def updateLocationCurrentPanoIds(oldLocationCurrentPanoId: String, newLocationCurrentPanoId: String): Int = db.withSession { implicit session =>
    val query = panoHistoryTable.filter(_.locationCurrentPanoId === oldLocationCurrentPanoId)
    query.map(_.locationCurrentPanoId).update(newLocationCurrentPanoId)
  }
 
  /**
    * Save a pano history object to the PanoHistory table.
    */
  def save(currentPanoId: String, currentCaptureDate: String, locationCurrentPanoId: String): String = db.withSession { implicit session =>
    var existingLocationCurrentPanoId: String = ""
    val existsQuery = panoHistoryTable.filter(_.panoId === currentPanoId)
    val exisitngRow: Option[PanoHistory] = existsQuery.firstOption

    // If this pano has not been added to the history table before, it could be the old location current pano.
    // This means we want to return its id to update the location current pano id of any panos that have its id
    // as their location current pano id.
    exisitngRow match {
      case Some(firstRow) =>
        existingLocationCurrentPanoId = firstRow.locationCurrentPanoId
      case None => {
        existingLocationCurrentPanoId = currentPanoId
      }
    }

    val newPanoHistory: PanoHistory = PanoHistory(currentPanoId, currentCaptureDate, locationCurrentPanoId)
    panoHistoryTable.insertOrUpdate(newPanoHistory)
    existingLocationCurrentPanoId
  }
}
