package models.gsv

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class PanoHistory(panoId: String, captureDate: String, locationCurrPanoId: String)

class PanoHistoryTableDef(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Rep[String] = column[String]("pano_id")
  def captureDate: Rep[String] = column[String]("capture_date")
  def locationCurrPanoId: Rep[String] = column[String]("location_curr_pano_id")

  def * = (panoId, captureDate, locationCurrPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)

//  def locationCurrentPano: ForeignKeyQuery[GSVDataTable, GSVData] = foreignKey("pano_history_gsv_panorama_id_fkey", locationCurrPanoId, TableQuery[GSVDataTableDef])(_.gsvPanoramaId)
}

@ImplementedBy(classOf[PanoHistoryTable])
trait PanoHistoryTableRepository {
}

@Singleton
class PanoHistoryTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends PanoHistoryTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val panoHistoryTable = TableQuery[PanoHistoryTableDef]

  /**
    * Save a pano history object to the PanoHistory table if it isn't already in the table.
   * TODO should this sort of functionality be in a service?
    */
//  def insert(history: PanoHistory): Int = {
//    if (panoHistoryTable.filter(h => h.panoId === history.panoId && h.locationCurrPanoId === history.locationCurrPanoId).list.isEmpty) {
//      panoHistoryTable += history
//    } else {
//      0
//    }
//  }
}
