package models.gsv

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class PanoHistory(panoId: String, captureDate: String, locationCurrPanoId: String)

class PanoHistoryTableDef(tag: Tag) extends Table[PanoHistory](tag, "pano_history") {
  def panoId: Rep[String] = column[String]("pano_id")
  def captureDate: Rep[String] = column[String]("capture_date")
  def locationCurrPanoId: Rep[String] = column[String]("location_curr_pano_id")

  def * = (panoId, captureDate, locationCurrPanoId) <> ((PanoHistory.apply _).tupled, PanoHistory.unapply)

//  def locationCurrentPano: ForeignKeyQuery[GsvDataTable, GsvData] = foreignKey("pano_history_gsv_panorama_id_fkey", locationCurrPanoId, TableQuery[GsvDataTableDef])(_.gsvPanoramaId)
}

@ImplementedBy(classOf[PanoHistoryTable])
trait PanoHistoryTableRepository { }

@Singleton
class PanoHistoryTable @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  implicit val ec: ExecutionContext
                                ) extends PanoHistoryTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val panoHistoryTable = TableQuery[PanoHistoryTableDef]

  /**
   * Save a pano history object to the PanoHistory table if it isn't already in the table.
   */
  def insertIfNew(history: PanoHistory): DBIO[Int] = {
    panoHistoryTable.filter(h => h.panoId === history.panoId && h.locationCurrPanoId === history.locationCurrPanoId)
      .result.headOption.flatMap {
        case Some(_) => DBIO.successful(0)
        case None => panoHistoryTable += history
      }
  }
}
