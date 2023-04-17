package models.gsv

import models.label.LabelTable
import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVData(gsvPanoramaId: String, width: Option[Int], height: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], captureDate: String, copyright: String, lat: Option[Float],
                   lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float], expired: Boolean,
                   lastViewed: java.sql.Timestamp)

case class GSVDataSlim(gsvPanoramaId: String, width: Option[Int], height: Option[Int], lat: Option[Float],
                       lng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float])

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
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
  def lastViewed = column[java.sql.Timestamp]("last_viewed", O.Nullable)

  def * = (gsvPanoramaId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng,
    cameraHeading, cameraPitch, expired, lastViewed) <>
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
   * Updates the data from the GSV API for a pano that sometimes changes.
   */
  def updateFromExplore(gsvPanoramaId: String, lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], expired: Boolean, lastViewed: java.sql.Timestamp): Int = db.withSession { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId }
      yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.expired, pano.lastViewed)
    q.update((lat, lng, heading, pitch, expired, lastViewed))
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

  def save(data: GSVData): String = db.withSession { implicit session =>
    gsvDataRecords += data
    data.gsvPanoramaId
  }
}
