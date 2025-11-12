package models.pano

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class PanoData(
    panoId: String,
    width: Option[Int],
    height: Option[Int],
    tileWidth: Option[Int],
    tileHeight: Option[Int],
    captureDate: String,
    copyright: Option[String],
    lat: Option[Float],
    lng: Option[Float],
    cameraHeading: Option[Float],
    cameraPitch: Option[Float],
    expired: Boolean,
    lastViewed: OffsetDateTime,
    panoHistorySaved: Option[OffsetDateTime],
    lastChecked: OffsetDateTime,
    source: String // TODO actually make this PanoSource type at some point.
)

object PanoSource extends Enumeration {
  type PanoSource = Value
  val Gsv       = Value("gsv")
  val Mapillary = Value("mapillary")
  val Infra3d   = Value("infra3d")
}

case class PanoDataSlim(
    panoId: String,
    hasLabels: Boolean,
    width: Option[Int],
    height: Option[Int],
    lat: Option[Float],
    lng: Option[Float],
    cameraHeading: Option[Float],
    cameraPitch: Option[Float],
    source: String // TODO actually make this PanoSource type at some point.
)

class PanoDataTableDef(tag: Tag) extends Table[PanoData](tag, "pano_data") {
  def panoId: Rep[String]                           = column[String]("pano_id", O.PrimaryKey)
  def width: Rep[Option[Int]]                       = column[Option[Int]]("width")
  def height: Rep[Option[Int]]                      = column[Option[Int]]("height")
  def tileWidth: Rep[Option[Int]]                   = column[Option[Int]]("tile_width")
  def tileHeight: Rep[Option[Int]]                  = column[Option[Int]]("tile_height")
  def captureDate: Rep[String]                      = column[String]("capture_date")
  def copyright: Rep[Option[String]]                = column[Option[String]]("copyright")
  def lat: Rep[Option[Float]]                       = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]]                       = column[Option[Float]]("lng")
  def cameraHeading: Rep[Option[Float]]             = column[Option[Float]]("camera_heading")
  def cameraPitch: Rep[Option[Float]]               = column[Option[Float]]("camera_pitch")
  def expired: Rep[Boolean]                         = column[Boolean]("expired")
  def lastViewed: Rep[OffsetDateTime]               = column[OffsetDateTime]("last_viewed")
  def panoHistorySaved: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("pano_history_saved")
  def lastChecked: Rep[OffsetDateTime]              = column[OffsetDateTime]("last_checked")
  def source: Rep[String]                           = column[String]("source")

  def * = (panoId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng, cameraHeading, cameraPitch,
    expired, lastViewed, panoHistorySaved, lastChecked, source) <>
    ((PanoData.apply _).tupled, PanoData.unapply)
}

@ImplementedBy(classOf[PanoDataTable]) trait PanoDataTableRepository {}

@Singleton
class PanoDataTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends PanoDataTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._
  val panoDataRecords = TableQuery[PanoDataTableDef]
  val labelTable      = TableQuery[LabelTableDef]

  /**
   * Get a pano metadata for all panos with a flag indicating whether they have labels.
   */
  def getAllPanos: DBIO[Seq[PanoDataSlim]] = {
    panoDataRecords
      .filter(_.panoId =!= "tutorial")
      .joinLeft(labelTable)
      .on(_.panoId === _.panoId)
      .distinctOn(_._1.panoId)
      .map { case (g, l) =>
        (g.panoId, l.isDefined, g.width, g.height, g.lat, g.lng, g.cameraHeading, g.cameraPitch, g.source)
      }
      .result
      .map(_.map(PanoDataSlim.tupled))
  }

  /**
   * Count the number of panos that have associated labels. Only including GSV imagery for now.
   */
  def countGsvPanosWithLabels: DBIO[Int] = {
    labelTable
      .join(panoDataRecords)
      .on(_.panoId === _.panoId)
      .filter(_._2.source === PanoSource.Gsv.toString)
      .map(_._2.panoId)
      .countDistinct
      .result
  }

  /**
   * Mark whether the pano was expired with a timestamp. If not expired, also update last_viewed column.
   *
   * @param panoId
   * @param expired
   * @param lastChecked
   * @return
   */
  def updateExpiredStatus(panoId: String, expired: Boolean, lastChecked: OffsetDateTime): DBIO[Int] = {
    if (expired) {
      val q = for { img <- panoDataRecords if img.panoId === panoId } yield (img.expired, img.lastChecked)
      q.update((expired, lastChecked))
    } else {
      val q = for {
        img <- panoDataRecords if img.panoId === panoId
      } yield (img.expired, img.lastChecked, img.lastViewed)
      q.update((expired, lastChecked, lastChecked))
    }
  }

  /**
   * Get a list of n least recently checked pano ids that have not been viewed in the last 3 months.
   *
   * Note: only getting panos from GSV for now; we haven't set up imagery checking for other sources yet
   * @param n Number of least recently checked panos to return.
   * @param expired Whether to check for expired or unexpired panos.
   */
  def getPanoIdsToCheckExpiration(n: Int, expired: Boolean): DBIO[Seq[String]] = {
    panoDataRecords
      .join(labelTable)
      .on(_.panoId === _.panoId)
      .filter(gsv =>
        gsv._1.source === PanoSource.Gsv.toString
          && gsv._1.expired === expired
          && gsv._1.lastChecked < OffsetDateTime.now().minusMonths(3)
      )
      .sortBy(_._1.lastChecked.asc)
      .subquery
      .map(_._1.panoId)
      .distinct
      .take(n)
      .result
  }

  /**
   * Updates the pano data if anything has changed.
   */
  def updateFromExplore(
      panoId: String,
      lat: Option[Float],
      lng: Option[Float],
      heading: Option[Float],
      pitch: Option[Float],
      expired: Boolean,
      lastViewed: OffsetDateTime,
      panoHistorySaved: Option[OffsetDateTime]
  ): DBIO[Int] = {
    val q = for {
      pano <- panoDataRecords if pano.panoId === panoId
    } yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.expired, pano.lastViewed,
      pano.panoHistorySaved, pano.lastChecked)
    q.update((lat, lng, heading, pitch, expired, lastViewed, panoHistorySaved, lastViewed))
  }

  /**
   * Checks if the given panorama id already exists in the table.
   * @param panoId Unique ID for the panorama
   */
  def panoramaExists(panoId: String): DBIO[Boolean] = {
    panoDataRecords.filter(_.panoId === panoId).exists.result
  }

  /**
   * This method updates a given panorama's panoHistorySaved field.
   * @param panoId Unique ID for the panorama
   * @param panoHistorySaved Timestamp that this panorama was last viewed by any user
   * @return
   */
  def updatePanoHistorySaved(panoId: String, panoHistorySaved: Option[OffsetDateTime]): DBIO[Int] = {
    panoDataRecords.filter(_.panoId === panoId).map(_.panoHistorySaved).update(panoHistorySaved)
  }

  def insert(data: PanoData): DBIO[String] = {
    (panoDataRecords returning panoDataRecords.map(_.panoId)) += data
  }
}
