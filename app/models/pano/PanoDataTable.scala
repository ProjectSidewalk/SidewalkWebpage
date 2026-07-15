package models.pano

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/** Pano metadata needed to render a backup image in Pannellum. */
case class PanoViewerMetadata(
    width: Option[Int],
    height: Option[Int],
    tileWidth: Option[Int],
    tileHeight: Option[Int],
    cameraHeading: Option[Double],
    cameraPitch: Option[Double],
    cameraRoll: Option[Double],
    copyright: Option[String],
    address: Option[String]
)

case class PanoData(
    panoId: String,
    width: Option[Int],
    height: Option[Int],
    tileWidth: Option[Int],
    tileHeight: Option[Int],
    captureDate: String,
    copyright: Option[String],
    lat: Option[Double],
    lng: Option[Double],
    cameraHeading: Option[Double],
    cameraPitch: Option[Double],
    cameraRoll: Option[Double],
    expired: Boolean,
    lastViewed: OffsetDateTime,
    panoHistorySaved: Option[OffsetDateTime],
    lastChecked: OffsetDateTime,
    source: PanoSource,
    hasBackup: Option[Boolean],
    address: Option[String]
)

// NOTE need to update pano_source enum in postgres as well if changing this Enumeration.
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
    lat: Option[Double],
    lng: Option[Double],
    cameraHeading: Option[Double],
    cameraPitch: Option[Double],
    cameraRoll: Option[Double],
    source: PanoSource
)

class PanoDataTableDef(tag: Tag) extends Table[PanoData](tag, "pano_data") {
  def panoId: Rep[String]                           = column[String]("pano_id", O.PrimaryKey)
  def width: Rep[Option[Int]]                       = column[Option[Int]]("width")
  def height: Rep[Option[Int]]                      = column[Option[Int]]("height")
  def tileWidth: Rep[Option[Int]]                   = column[Option[Int]]("tile_width")
  def tileHeight: Rep[Option[Int]]                  = column[Option[Int]]("tile_height")
  def captureDate: Rep[String]                      = column[String]("capture_date")
  def copyright: Rep[Option[String]]                = column[Option[String]]("copyright")
  def lat: Rep[Option[Double]]                      = column[Option[Double]]("lat")
  def lng: Rep[Option[Double]]                      = column[Option[Double]]("lng")
  def cameraHeading: Rep[Option[Double]]            = column[Option[Double]]("camera_heading")
  def cameraPitch: Rep[Option[Double]]              = column[Option[Double]]("camera_pitch")
  def cameraRoll: Rep[Option[Double]]               = column[Option[Double]]("camera_roll")
  def expired: Rep[Boolean]                         = column[Boolean]("expired")
  def lastViewed: Rep[OffsetDateTime]               = column[OffsetDateTime]("last_viewed")
  def panoHistorySaved: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("pano_history_saved")
  def lastChecked: Rep[OffsetDateTime]              = column[OffsetDateTime]("last_checked")
  def source: Rep[PanoSource]                       = column[PanoSource]("source")
  def hasBackup: Rep[Option[Boolean]]               = column[Option[Boolean]]("has_backup")
  def address: Rep[Option[String]]                  = column[Option[String]]("address")

  def * = (panoId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng, cameraHeading, cameraPitch,
    cameraRoll, expired, lastViewed, panoHistorySaved, lastChecked, source, hasBackup, address) <>
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
        (g.panoId, l.isDefined, g.width, g.height, g.lat, g.lng, g.cameraHeading, g.cameraPitch, g.cameraRoll, g.source)
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
      .filter(_._2.source === PanoSource.Gsv)
      .map(_._2.panoId)
      .countDistinct
      .result
  }

  /**
   * Mark whether the pano was expired with a timestamp. If not expired, also update last_viewed column.
   *
   * @param panoId The ID of the pano
   * @param expired Whether the original source for the image has expired
   * @param hasBackup Whether a locally-hosted backup image exists for this pano.
   * @param lastChecked The last time that we checked for image availability
   * @return
   */
  def updateExpiredStatus(
      panoId: String,
      expired: Boolean,
      hasBackup: Option[Boolean],
      lastChecked: OffsetDateTime
  ): DBIO[Int] = {
    if (expired) {
      val q =
        for { img <- panoDataRecords if img.panoId === panoId } yield (img.expired, img.hasBackup, img.lastChecked)
      q.update((expired, hasBackup, lastChecked))
    } else {
      val q = for {
        img <- panoDataRecords if img.panoId === panoId
      } yield (img.expired, img.hasBackup, img.lastChecked, img.lastViewed)
      q.update((expired, hasBackup, lastChecked, lastChecked))
    }
  }

  /**
   * Sets has_backup = true for the given pano, but only if it isn't already true.
   *
   * @param panoId The ID of the pano whose has_backup flag should be set.
   */
  def markHasBackup(panoId: String): DBIO[Int] = {
    panoDataRecords
      .filter(p => p.panoId === panoId && !p.hasBackup.getOrElse(false: Rep[Boolean]))
      .map(_.hasBackup)
      .update(Some(true))
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
        gsv._1.source === PanoSource.Gsv
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
      lat: Option[Double],
      lng: Option[Double],
      heading: Option[Double],
      pitch: Option[Double],
      roll: Option[Double],
      address: Option[String],
      expired: Boolean,
      lastViewed: OffsetDateTime,
      panoHistorySaved: Option[OffsetDateTime]
  ): DBIO[Int] = {
    val q = for {
      pano <- panoDataRecords if pano.panoId === panoId
    } yield (pano.lat, pano.lng, pano.cameraHeading, pano.cameraPitch, pano.cameraRoll, pano.expired, pano.lastViewed,
      pano.panoHistorySaved, pano.lastChecked)
    val baseUpdate = q.update((lat, lng, heading, pitch, roll, expired, lastViewed, panoHistorySaved, lastViewed))

    // A stored address is only ever replaced, never cleared: submissions without one (e.g. non-GSV sources) leave
    // the column untouched.
    val addressUpdate =
      if (address.isDefined) panoDataRecords.filter(_.panoId === panoId).map(_.address).update(address)
      else DBIO.successful(0)
    for {
      n <- baseUpdate
      _ <- addressUpdate
    } yield n
  }

  /**
   * Checks if the given panorama id already exists in the table.
   * @param panoId Unique ID for the panorama
   */
  def panoramaExists(panoId: String): DBIO[Boolean] = {
    panoDataRecords.filter(_.panoId === panoId).exists.result
  }

  /**
   * Fetches the full metadata row for a single pano.
   * @param panoId Unique ID for the panorama
   */
  def getPano(panoId: String): DBIO[Option[PanoData]] = {
    panoDataRecords.filter(_.panoId === panoId).result.headOption
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
