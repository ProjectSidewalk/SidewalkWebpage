package models.gsv

import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVData(gsvPanoramaId: String, imageWidth: Int, imageHeight: Int, tileWidth: Int, tileHeight: Int,
                   centerHeading: Option[Float], originHeading: Option[Float], originPitch: Option[Float],
                   imageDate: String, imageryType: Int, copyright: String, expired: Boolean,
                   lastViewed: Option[java.sql.Timestamp])

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def imageWidth = column[Int]("image_width", O.NotNull)
  def imageHeight = column[Int]("image_height", O.NotNull)
  def tileWidth = column[Int]("tile_width", O.NotNull)
  def tileHeight = column[Int]("tile_height", O.NotNull)
  def centerHeading = column[Option[Float]]("center_heading")
  def originHeading = column[Option[Float]]("origin_heading")
  def originPitch = column[Option[Float]]("origin_pitch")
  def imageDate = column[String]("image_date", O.NotNull)
  def imageryType = column[Int]("imagery_type", O.NotNull)
  def copyright = column[String]("copyright", O.NotNull)
  def expired = column[Boolean]("expired", O.NotNull)
  def lastViewed = column[Option[java.sql.Timestamp]]("last_viewed", O.Nullable)

  def * = (gsvPanoramaId, imageWidth, imageHeight, tileWidth, tileHeight, centerHeading,
    originHeading, originPitch, imageDate, imageryType, copyright, expired, lastViewed) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

object GSVDataTable {
  val db = play.api.db.slick.DB
  val gsvDataRecords = TableQuery[GSVDataTable]

  /**
    * This method marks the expired column of a panorama to be true.
    *
    * @param gsvPanoramaId GSV Panorama ID.
    * @return              Boolean value of the expired column.
    */
  def markExpired(gsvPanoramaId: String, expired: Boolean): Int = db.withTransaction { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId } yield pano.expired
    q.update(expired)
  }

  /**
    * This function records the last time this panorama was viewed.
    *
    * @param gsvPanoramaId  GSV Panorama ID.
    * @param timestamp      Timestamp from the last time this panorama was accessed.
    * @return
    */
  def markLastViewedForPanorama(gsvPanoramaId: String, timestamp: Timestamp): Int = db.withTransaction { implicit session =>
    val q = for { pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId } yield pano.lastViewed
    q.update(Some(timestamp))
  }

  /**
    * This method checks if the given panorama id already exists in the table.
    *
    * @param panoramaId Google Street View panorama Id
    * @return
    */
  def panoramaExists(panoramaId: String): Boolean = db.withTransaction { implicit session =>
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).list.nonEmpty
  }

  def save(data: GSVData): String = db.withTransaction { implicit session =>
    gsvDataRecords += data
    data.gsvPanoramaId
  }
}
