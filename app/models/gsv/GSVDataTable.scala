package models.gsv

import models.label.LabelTable
import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.util.{Try, Success, Failure}
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class GSVData(gsvPanoramaId: String, width: Option[Int], height: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], captureDate: String, copyright: String, lat: Option[Float],
                   lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float], expired: Boolean,
                   lastViewed: java.sql.Timestamp, panoHistorySaved: Option[java.sql.Timestamp])

case class GSVDataSlim(gsvPanoramaId: String, width: Option[Int], height: Option[Int], lat: Option[Float],
                       lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float])

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def width = column[Option[Int]]("width")
  def height = column[Option[Int]]("height")
  def tileWidth = column[Option[Int]]("tile_width")
  def tileHeight = column[Option[Int]]("tile_height")
  def captureDate = column[String]("capture_date", O.NotNull)
  def copyright = column[String]("copyright", O.NotNull)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def cameraHeading = column[Option[Float]]("camera_heading", O.Nullable)
  def cameraPitch = column[Option[Float]]("camera_pitch", O.Nullable)
  def expired = column[Boolean]("expired", O.NotNull)
  def lastViewed = column[java.sql.Timestamp]("last_viewed", O.NotNull)
  def panoHistorySaved = column[Option[java.sql.Timestamp]]("pano_history_saved", O.Nullable)

  def * = (gsvPanoramaId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng,
    cameraHeading, cameraPitch, expired, lastViewed, panoHistorySaved) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

object GSVDataTable {
  val db = play.api.db.slick.DB
  val gsvDataRecords = TableQuery[GSVDataTable]

  /**
   * Get a subset of the pano metadata for all panos that have associated labels.
   */
  def getAllPanosWithLabels: List[GSVDataSlim] = db.withSession { implicit session =>
    LabelTable.labelsUnfiltered
      .filter(_.gsvPanoramaId =!= "tutorial")
      .groupBy(_.gsvPanoramaId).map(_._1)
      .innerJoin(gsvDataRecords).on(_ === _.gsvPanoramaId)
      .map { case (panoId, gsv) => (
        gsv.gsvPanoramaId, gsv.width, gsv.height, gsv.lat, gsv.lng, gsv.cameraHeading, gsv.cameraPitch
      )}.list.map(GSVDataSlim.tupled)
  }

  /**
   * Count the number of panos that have associated labels.
   */
  def countPanosWithLabels: Int = db.withSession { implicit session =>
    LabelTable.labelsUnfiltered
      .filter(_.gsvPanoramaId =!= "tutorial")
      .groupBy(_.gsvPanoramaId).map(_._1)
      .innerJoin(gsvDataRecords).on(_ === _.gsvPanoramaId)
      .length.run
  }

  /**
    * This method marks the expired column of a panorama to be true.
    *
    * @param gsvPanoramaId GSV Panorama ID.
    * @return              Boolean value of the expired column.
    */
  def markExpired(gsvPanoramaId: String, expired: Boolean): Int = db.withSession { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId } yield pano.expired
    q.update(expired)
  }

  /**
    * This function records the last time this panorama was successfully viewed.
    *
    * @param gsvPanoramaId  GSV Panorama ID.
    * @param timestamp      Timestamp from the last time this panorama was accessed.
    * @return
    */
  def markLastViewedForPanorama(gsvPanoramaId: String, timestamp: Timestamp): Int = db.withSession { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId } yield pano.lastViewed
    q.update(timestamp)
  }

  /**
   * Get a list of n pano ids that have not been viewed in the last 6 months.
   * @param n
   * @param expired
   * @return
   */
  def getPanoIdsToCheckExpiration(n: Int, expired: Boolean): List[String] = db.withSession { implicit session =>
    val expiryFilter: String = if (expired) "expired = TRUE" else "expired = FALSE"
    Q.queryNA[String](
      s"""SELECT DISTINCT(gsv_panorama_id)
         |FROM (
         |    SELECT gsv_data.gsv_panorama_id, gsv_data.last_viewed
         |    FROM gsv_data
         |    INNER JOIN label ON gsv_data.gsv_panorama_id = label.gsv_panorama_id
         |    WHERE $expiryFilter
         |        AND last_viewed::date < now()::date - interval '6 months'
         |    ORDER BY last_viewed
         |) AS x
         |LIMIT $n""".stripMargin
    ).list
  }

  /**
   * Updates the data from the GSV API for a pano that sometimes changes.
   */
  def updateFromExplore(gsvPanoramaId: String, lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], expired: Boolean, lastViewed: java.sql.Timestamp, panoHistorySaved: Option[java.sql.Timestamp]): Int = db.withSession { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId }
      yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.expired, pano.lastViewed, pano.panoHistorySaved)
    q.update((lat, lng, heading, pitch, expired, lastViewed, panoHistorySaved))
  }

  /**
    * This method checks if the given panorama id already exists in the table.
    *
    * @param panoramaId Google Street View panorama Id
    * @return
    */
  def panoramaExists(panoramaId: String): Boolean = db.withSession { implicit session =>
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).list.nonEmpty
  }

  /**
    * This method updates a given panorama's panoHistorySaved field
    *
    * @param panoramaId Google Street View panorama Id
    * @param panoHistorySaved Timestamp that this panorama was last viewed by any user
    * @return
    */
  def updatePanoHistorySaved(panoramaId: String, panoHistorySaved: Option[java.sql.Timestamp]): Int = db.withSession { implicit session =>
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).map(_.panoHistorySaved).update(panoHistorySaved)
  }

  def save(data: GSVData): String = db.withSession { implicit session =>
    gsvDataRecords += data
    data.gsvPanoramaId
  }
}
