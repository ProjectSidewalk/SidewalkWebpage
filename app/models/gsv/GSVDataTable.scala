package models.gsv

import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVData(gsvPanoramaId: String, imageWidth: Option[Int], imageHeight: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], imageDate: String, copyright: String, expired: Boolean,
                   lastViewed: Option[java.sql.Timestamp])

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def imageWidth = column[Option[Int]]("image_width")
  def imageHeight = column[Option[Int]]("image_height")
  def tileWidth = column[Option[Int]]("tile_width")
  def tileHeight = column[Option[Int]]("tile_height")
  def imageDate = column[String]("image_date", O.NotNull)
  def copyright = column[String]("copyright", O.NotNull)
  def expired = column[Boolean]("expired", O.NotNull)
  def lastViewed = column[Option[java.sql.Timestamp]]("last_viewed", O.Nullable)

  def * = (gsvPanoramaId, imageWidth, imageHeight, tileWidth, tileHeight, imageDate, copyright, expired, lastViewed) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

object GSVDataTable {
  val db = play.api.db.slick.DB
  val gsvDataRecords = TableQuery[GSVDataTable]

  def getAllPanos(): List[(String, Option[Int], Option[Int])] = db.withSession { implicit session =>
    gsvDataRecords.filter(_.gsvPanoramaId =!= "tutorial").map(p => (p.gsvPanoramaId, p.imageWidth, p.imageHeight)).list
  }

  /**
    * This method gets the image date associated with the given panorama Id.
    *
    * @param panoramaId GSV Panorama ID.
    * @return           String representing the image date in form "yyyy-MM". If panoramaId is not
                        in the GSV Data, return is an empty string.
    */
  def getImageDate(panoramaId: String): String = db.withSession { implicit session =>
    val imagesWithGivenPanoId = for {
      _gsv <- gsvDataRecords if _gsv.gsvPanoramaId === panoramaId
    } yield (
      _gsv
    )
    if (imagesWithGivenPanoId.length.run == 0) "" else imagesWithGivenPanoId.first.imageDate
  }

  /**
    * This method gets the age of the image associated with the given panorama Id.
    *
    * @param panoramaId GSV Panorama ID.
    * @return           Long representing the image age in seconds. If panoramaId is not in the
                        GSV Data, return is 0.
    */
  def getImageAge(panoramaId: String): Long = {
    val imageDateString: String = getImageDate(panoramaId)
    if (!imageDateString.isEmpty) {
      val format = new java.text.SimpleDateFormat("yyyy-MM")
      val now: Long = System.currentTimeMillis();
      val imageDate: Long = format.parse(imageDateString).getTime()
      now - imageDate
    } else {
      0
    }
  }

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
