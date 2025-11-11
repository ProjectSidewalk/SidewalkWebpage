package models.gsv

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class GsvData(
    gsvPanoramaId: String,
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

case class GsvDataSlim(
    gsvPanoramaId: String,
    hasLabels: Boolean,
    width: Option[Int],
    height: Option[Int],
    lat: Option[Float],
    lng: Option[Float],
    cameraHeading: Option[Float],
    cameraPitch: Option[Float],
    source: String // TODO actually make this PanoSource type at some point.
)

class GsvDataTableDef(tag: Tag) extends Table[GsvData](tag, "gsv_data") {
  def gsvPanoramaId: Rep[String]                    = column[String]("gsv_panorama_id", O.PrimaryKey)
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

  def * = (gsvPanoramaId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng, cameraHeading,
    cameraPitch, expired, lastViewed, panoHistorySaved, lastChecked, source) <>
    ((GsvData.apply _).tupled, GsvData.unapply)
}

@ImplementedBy(classOf[GsvDataTable])
trait GsvDataTableRepository {}

@Singleton
class GsvDataTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends GsvDataTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._
  val gsvDataRecords = TableQuery[GsvDataTableDef]
  val labelTable     = TableQuery[LabelTableDef]

  /**
   * Get a pano metadata for all panos with a flag indicating whether they have labels.
   */
  def getAllPanos: DBIO[Seq[GsvDataSlim]] = {
    gsvDataRecords
      .filter(_.gsvPanoramaId =!= "tutorial")
      .joinLeft(labelTable)
      .on(_.gsvPanoramaId === _.gsvPanoramaId)
      .distinctOn(_._1.gsvPanoramaId)
      .map { case (g, l) =>
        (g.gsvPanoramaId, l.isDefined, g.width, g.height, g.lat, g.lng, g.cameraHeading, g.cameraPitch, g.source)
      }
      .result
      .map(_.map(GsvDataSlim.tupled))
  }

  /**
   * Count the number of panos that have associated labels.
   */
  def countPanosWithLabels: DBIO[Int] = {
    labelTable.map(_.gsvPanoramaId).countDistinct.result
  }

  /**
   * Mark whether the pano was expired with a timestamp. If not expired, also update last_viewed column.
   *
   * @param gsvPanoramaId
   * @param expired
   * @param lastChecked
   * @return
   */
  def updateExpiredStatus(gsvPanoramaId: String, expired: Boolean, lastChecked: OffsetDateTime): DBIO[Int] = {
    if (expired) {
      val q = for { img <- gsvDataRecords if img.gsvPanoramaId === gsvPanoramaId } yield (img.expired, img.lastChecked)
      q.update((expired, lastChecked))
    } else {
      val q = for {
        img <- gsvDataRecords if img.gsvPanoramaId === gsvPanoramaId
      } yield (img.expired, img.lastChecked, img.lastViewed)
      q.update((expired, lastChecked, lastChecked))
    }
  }

  /**
   * Get a list of n least recently checked pano ids that have not been viewed in the last 3 months.
   * @param n Number of least recently checked panos to return.
   * @param expired Whether to check for expired or unexpired panos.
   */
  def getPanoIdsToCheckExpiration(n: Int, expired: Boolean): DBIO[Seq[String]] = {
    gsvDataRecords
      .join(labelTable)
      .on(_.gsvPanoramaId === _.gsvPanoramaId)
      .filter(gsv => gsv._1.expired === expired && gsv._1.lastChecked < OffsetDateTime.now().minusMonths(3))
      .sortBy(_._1.lastChecked.asc)
      .subquery
      .map(_._1.gsvPanoramaId)
      .distinct
      .take(n)
      .result
  }

  /**
   * Updates the data from the GSV API for a pano that sometimes changes.
   */
  def updateFromExplore(
      gsvPanoramaId: String,
      lat: Option[Float],
      lng: Option[Float],
      heading: Option[Float],
      pitch: Option[Float],
      expired: Boolean,
      lastViewed: OffsetDateTime,
      panoHistorySaved: Option[OffsetDateTime]
  ): DBIO[Int] = {
    val q = for {
      pano <- gsvDataRecords if pano.gsvPanoramaId === gsvPanoramaId
    } yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.expired, pano.lastViewed,
      pano.panoHistorySaved, pano.lastChecked)
    q.update((lat, lng, heading, pitch, expired, lastViewed, panoHistorySaved, lastViewed))
  }

  /**
   * Checks if the given panorama id already exists in the table.
   * @param panoramaId Google Street View panorama Id
   */
  def panoramaExists(panoramaId: String): DBIO[Boolean] = {
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).exists.result
  }

  /**
   * This method updates a given panorama's panoHistorySaved field.
   * @param panoramaId Google Street View panorama Id
   * @param panoHistorySaved Timestamp that this panorama was last viewed by any user
   * @return
   */
  def updatePanoHistorySaved(panoramaId: String, panoHistorySaved: Option[OffsetDateTime]): DBIO[Int] = {
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).map(_.panoHistorySaved).update(panoHistorySaved)
  }

  def insert(data: GsvData): DBIO[String] = {
    (gsvDataRecords returning gsvDataRecords.map(_.gsvPanoramaId)) += data
  }
}
