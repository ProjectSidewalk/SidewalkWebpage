package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.sql.Timestamp
import java.text.SimpleDateFormat
import java.util.{Date, TimeZone}
import scala.slick.lifted.ForeignKeyQuery
import scala.util.Try

case class PanoHistory(panoId: String, visitedTimestamp: Option[Timestamp], panoDate: String, locationCurrentPanoId: String)

class PanoHistoryTable(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Column[String] = column[String]("pano_id", O.PrimaryKey)
  def visitedTimestamp: Column[Option[Timestamp]] = column[Option[Timestamp]]("visited_timestamp", O.Nullable) 
  def panoDate: Column[String] = column[String]("pano_date", O.NotNull)
  def locationCurrentPanoId: Column[String] = column[String]("location_current_pano_id", O.NotNull)
  def * = (panoId, visitedTimestamp, panoDate, locationCurrentPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)
  def pano: ForeignKeyQuery[PanoHistoryTable, PanoHistory] = foreignKey("pano_history_location_current_pano_id_fkey", locationCurrentPanoId, TableQuery[PanoHistoryTable])(_.panoId)
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
    * Save a pano history object to the PanoHistory table. If a pano history is submitted with a null visitedTimestamp, 
    * check to see if a timestamp entry exists for that row already and keep existing timestamp.
    */
  def save(currentPanoId: String, visitedTimestamp: Option[Long], currentPanoDate: String, locationCurrentPanoId: String): Int = db.withSession { implicit session =>
    var visitedTimestampOption: Option[Timestamp] = None
    if (visitedTimestamp != null) {
        val timestampValue: Long = visitedTimestamp match {
            case Some(value) => value
            case None => 0
        }
        val visitedTimestampObject: Timestamp = new Timestamp(timestampValue)
        visitedTimestampOption = Some(visitedTimestampObject)
    } else {
      val rowOption = getRowByPanoId(currentPanoId)
      rowOption match {
        case Some(row) => {
          if (row.visitedTimestamp != null) {
            visitedTimestampOption = row.visitedTimestamp
          }
        }
        case None => {}
      }
    }
    val newPanoHistory: PanoHistory = PanoHistory(currentPanoId, visitedTimestampOption, currentPanoDate, locationCurrentPanoId)
    val rowsAffected = panoHistoryTable.insertOrUpdate(newPanoHistory)
    rowsAffected
  }
}
