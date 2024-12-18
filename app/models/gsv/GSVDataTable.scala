package models.gsv

import com.google.inject.ImplementedBy
import models.label.LabelTable
import models.utils.MyPostgresDriver

import java.sql.Timestamp
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class GSVData(gsvPanoramaId: String, width: Option[Int], height: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], captureDate: String, copyright: String, lat: Option[Float],
                   lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float], expired: Boolean,
                   lastViewed: Timestamp, panoHistorySaved: Option[Timestamp], lastChecked: Timestamp)

case class GSVDataSlim(gsvPanoramaId: String, width: Option[Int], height: Option[Int], lat: Option[Float],
                       lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float])

class GSVDataTableDef(tag: Tag) extends Table[GSVData](tag, "gsv_data") {
  def gsvPanoramaId: Rep[String] = column[String]("gsv_panorama_id", O.PrimaryKey)
  def width: Rep[Option[Int]] = column[Option[Int]]("width")
  def height: Rep[Option[Int]] = column[Option[Int]]("height")
  def tileWidth: Rep[Option[Int]] = column[Option[Int]]("tile_width")
  def tileHeight: Rep[Option[Int]] = column[Option[Int]]("tile_height")
  def captureDate: Rep[String] = column[String]("capture_date")
  def copyright: Rep[String] = column[String]("copyright")
  def lat: Rep[Option[Float]] = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]] = column[Option[Float]]("lng")
  def cameraHeading: Rep[Option[Float]] = column[Option[Float]]("camera_heading")
  def cameraPitch: Rep[Option[Float]] = column[Option[Float]]("camera_pitch")
  def expired: Rep[Boolean] = column[Boolean]("expired")
  def lastViewed: Rep[Timestamp] = column[Timestamp]("last_viewed")
  def panoHistorySaved: Rep[Option[Timestamp]] = column[Option[Timestamp]]("pano_history_saved")
  def lastChecked: Rep[Timestamp] = column[Timestamp]("last_checked")

  def * = (gsvPanoramaId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng,
    cameraHeading, cameraPitch, expired, lastViewed, panoHistorySaved, lastChecked) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

@ImplementedBy(classOf[GSVDataTable])
trait GSVDataTableRepository {
}

@Singleton
class GSVDataTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GSVDataTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val gsvDataRecords = TableQuery[GSVDataTableDef]

  /**
   * Get a subset of the pano metadata for all panos that have associated labels.
   */
//  def getAllPanosWithLabels: List[GSVDataSlim] = {
//    LabelTable.labelsUnfiltered
//      .filter(_.gsvPanoramaId =!= "tutorial")
//      .groupBy(_.gsvPanoramaId).map(_._1)
//      .innerJoin(gsvDataRecords).on(_ === _.gsvPanoramaId)
//      .map { case (panoId, gsv) => (
//        gsv.gsvPanoramaId, gsv.width, gsv.height, gsv.lat, gsv.lng, gsv.cameraHeading, gsv.cameraPitch
//      )}.list.map(GSVDataSlim.tupled)
//  }
//
//  /**
//   * Count the number of panos that have associated labels.
//   */
//  def countPanosWithLabels: Int = {
//    LabelTable.labelsUnfiltered
//      .filter(_.gsvPanoramaId =!= "tutorial")
//      .groupBy(_.gsvPanoramaId).map(_._1)
//      .size.run
//  }
//
//  /**
//   * Mark whether the pano was expired with a timestamp. If not expired, also update last_viewed column.
//   * @param gsvPanoramaId
//   * @param expired
//   * @param lastChecked
//   * @return
//   */
//  def updateExpiredStatus(gsvPanoramaId: String, expired: Boolean, lastChecked: Timestamp): Int = {
//    if (expired) {
//      val q = for { img <- gsvDataRecords if img.gsvPanoramaId === gsvPanoramaId } yield (img.expired, img.lastChecked)
//      q.update((expired, lastChecked))
//    } else {
//      val q = for { img <- gsvDataRecords if img.gsvPanoramaId === gsvPanoramaId } yield (img.expired, img.lastChecked, img.lastViewed)
//      q.update((expired, lastChecked, lastChecked))
//    }
//  }
//
//  /**
//   * Get a list of n pano ids that have not been viewed in the last 6 months.
//   * @param n
//   * @param expired
//   * @return
//   */
//  def getPanoIdsToCheckExpiration(n: Int, expired: Boolean): List[String] = {
//    val expiryFilter: String = if (expired) "expired = TRUE" else "expired = FALSE"
//    Q.queryNA[String](
//      s"""SELECT DISTINCT(gsv_panorama_id)
//         |FROM (
//         |    SELECT gsv_data.gsv_panorama_id, gsv_data.last_checked
//         |    FROM gsv_data
//         |    INNER JOIN label ON gsv_data.gsv_panorama_id = label.gsv_panorama_id
//         |    WHERE $expiryFilter
//         |        AND last_checked::date < now()::date - interval '6 months'
//         |    ORDER BY last_checked
//         |) AS x
//         |LIMIT $n""".stripMargin
//    ).list
//  }
//
//  /**
//   * Updates the data from the GSV API for a pano that sometimes changes.
//   */
//  def updateFromExplore(gsvPanoramaId: String, lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], expired: Boolean, lastViewed: Timestamp, panoHistorySaved: Option[Timestamp]): Int = {
//    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId }
//      yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.expired, pano.lastViewed, pano.panoHistorySaved, pano.lastChecked)
//    q.update((lat, lng, heading, pitch, expired, lastViewed, panoHistorySaved, lastViewed))
//  }
//
//  /**
//    * This method checks if the given panorama id already exists in the table.
//    *
//    * @param panoramaId Google Street View panorama Id
//    * @return
//    */
//  def panoramaExists(panoramaId: String): Boolean = {
//    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).list.nonEmpty
//  }
//
//  /**
//    * This method updates a given panorama's panoHistorySaved field
//    *
//    * @param panoramaId Google Street View panorama Id
//    * @param panoHistorySaved Timestamp that this panorama was last viewed by any user
//    * @return
//    */
//  def updatePanoHistorySaved(panoramaId: String, panoHistorySaved: Option[Timestamp]): Int = {
//    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).map(_.panoHistorySaved).update(panoHistorySaved)
//  }
//
//  def save(data: GSVData): String = {
//    gsvDataRecords += data
//    data.gsvPanoramaId
//  }
}
