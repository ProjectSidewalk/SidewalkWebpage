package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.sql.Timestamp
import java.text.SimpleDateFormat
import java.util.{Date, TimeZone}
import scala.slick.lifted.ForeignKeyQuery
import scala.util.Try

case class PanoramaHistory(panoramaId: String, visitedTimestamp: Option[Timestamp], panoMonth: Int, panoYear: Int, locationCurrentPanoId: String)

class PanoramaHistoryTable(tag: Tag) extends Table[PanoramaHistory](tag, "panorama_history") {
  def panoramaId: Column[String] = column[String]("panorama_id", O.PrimaryKey)
  def visitedTimestamp: Column[Option[Timestamp]] = column[Option[Timestamp]]("visited_timestamp", O.Nullable) 
  def panoMonth: Column[Int] = column[Int]("pano_month", O.NotNull)
  def panoYear: Column[Int] = column[Int]("pano_year", O.NotNull)
  def locationCurrentPanoId: Column[String] = column[String]("location_current_pano_id", O.NotNull)
  def * = (panoramaId, visitedTimestamp, panoMonth, panoYear, locationCurrentPanoId) <> ((PanoramaHistory.apply _).tupled, PanoramaHistory.unapply)
  def pano: ForeignKeyQuery[PanoramaHistoryTable, PanoramaHistory] = foreignKey("panorama_history_location_current_panorama_id_fkey", locationCurrentPanoId, TableQuery[PanoramaHistoryTable])(_.panoramaId)
}

object PanoramaHistoryTable {
  val db = play.api.db.slick.DB
  val panoramaHistoryTable = TableQuery[PanoramaHistoryTable]

  /**
    * Get all panorama histories.
    */
  def selectAllPanoramaHistories(): List[PanoramaHistory] = db.withSession { implicit session =>
    panoramaHistoryTable.list
  }

  /**
    * Save a panorama history object to the PanoramaHistory table.
    */
  def save(currentPanoId: String, visitedTimestamp: Option[String], currentPanoMonth: Int, currentPanoYear: Int, locationCurrentPanoId: String): Int = db.withSession { implicit session =>
    // Cast visitedTimestamp to a Timestamp object.
    var visitedTimestampOption: Option[Timestamp] = None
    if (visitedTimestamp != null) {
        val timestampStringOption: Option[String] = visitedTimestamp
        val timestampString: String = timestampStringOption match {
            case Some(value) => value
            case None => ""
        }
        val inputFormat = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT'Z (zzz)")
        inputFormat.setTimeZone(TimeZone.getTimeZone("GMT"))
        val visitedDateObject: Date = inputFormat.parse(timestampString)
        val visitedTimestampObject: Timestamp = new Timestamp(visitedDateObject.getTime)
        visitedTimestampOption = Some(visitedTimestampObject)
    }
    val newPanoramaHistory: PanoramaHistory = PanoramaHistory(currentPanoId, visitedTimestampOption, currentPanoMonth, currentPanoYear, locationCurrentPanoId)
    panoramaHistoryTable.insertOrUpdate(newPanoramaHistory)
  }

  /** 
   * Delete all records from the PanoramaHistory table.
   */
  def deleteAll(): Int = db.withSession { implicit session =>
    panoramaHistoryTable.delete
  }
}
