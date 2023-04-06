package models.gsv

import models.label.LabelTable
import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVData(gsvPanoramaId: String, imageWidth: Option[Int], imageHeight: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], imageDate: String, copyright: String, lat: Option[Float],
                   lng: Option[Float], photographerHeading: Option[Float], photographerPitch: Option[Float],
                   expired: Boolean, lastViewed: Option[java.sql.Timestamp])

case class GSVDataSlim(gsvPanoramaId: String, imageWidth: Option[Int], imageHeight: Option[Int], lat: Option[Float],
                       lng: Option[Float], photographerHeading: Option[Float], photographerPitch: Option[Float])

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def imageWidth = column[Option[Int]]("image_width")
  def imageHeight = column[Option[Int]]("image_height")
  def tileWidth = column[Option[Int]]("tile_width")
  def tileHeight = column[Option[Int]]("tile_height")
  def imageDate = column[String]("image_date", O.NotNull)
  def copyright = column[String]("copyright", O.NotNull)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def photographerHeading = column[Option[Float]]("photographer_heading", O.Nullable)
  def photographerPitch = column[Option[Float]]("photographer_pitch", O.Nullable)
  def expired = column[Boolean]("expired", O.NotNull)
  def lastViewed = column[Option[java.sql.Timestamp]]("last_viewed", O.Nullable)

  def * = (gsvPanoramaId, imageWidth, imageHeight, tileWidth, tileHeight, imageDate, copyright,
    lat, lng, photographerHeading, photographerPitch, expired, lastViewed) <>
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
        gsv.gsvPanoramaId, gsv.imageWidth, gsv.imageHeight, gsv.lat, gsv.lng, gsv.photographerHeading, gsv.photographerPitch
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
    q.update(Some(timestamp))
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
