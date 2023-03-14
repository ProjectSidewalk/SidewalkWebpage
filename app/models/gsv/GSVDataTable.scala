package models.gsv

import models.label.LabelTable
import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVData(gsvPanoramaId: String, imageWidth: Option[Int], imageHeight: Option[Int], tileWidth: Option[Int],
                   tileHeight: Option[Int], imageDate: String, copyright: String, expired: Boolean,
                   lastViewed: Option[java.sql.Timestamp])

case class GSVDataExtended(gsvPanoramaId: String, imageWidth: Option[Int], imageHeight: Option[Int],
                           panoramaLat: Option[Float], panoramaLng: Option[Float], photographerHeading: Option[Float],
                           photographerPitch: Option[Float])

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

  /**
   * List all panos with labels with some metadata. For the metadata that we get from the label table (panorama_lat,
   * panorama_lng, photographer_heading, and photographer_pitch), we are getting different values from Google's API over
   * time. We are not totally sure why, but for now we are grabbing the most recent metadata we've gotten from Google.
   */
  def getAllPanosWithLabels: List[GSVDataExtended] = db.withSession { implicit session =>
    // Get most recent labels for each pano_id so that we have the most recent metadata from Google.
    val mostRecentLabels = LabelTable.labelsUnfiltered
      .filter(_.gsvPanoramaId =!= "tutorial")
      .groupBy(_.gsvPanoramaId).map(_._2.map(_.labelId).max)
      .leftJoin(LabelTable.labelsUnfiltered).on(_ === _.labelId)
      .map(_._2)

    // Left join with the most recent labels that we found above, grabbing the metadata.
    gsvDataRecords
      .filter(_.gsvPanoramaId =!= "tutorial")
      .innerJoin(mostRecentLabels).on(_.gsvPanoramaId === _.gsvPanoramaId)
      .map { case (g, l) => (
        g.gsvPanoramaId, g.imageWidth, g.imageHeight, l.panoramaLat.?, l.panoramaLng.?, l.photographerPitch.?, l.photographerHeading.?
      )}.list.map(GSVDataExtended.tupled)
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
