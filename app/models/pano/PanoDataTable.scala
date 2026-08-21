package models.pano

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsValue, Json}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/** Panos whose imagery went away during one week. */
case class PanoExpiryWeek(weekStart: LocalDate, panoCount: Int)

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
    address: Option[String],
    // Verbatim imagery-provider metadata blob (e.g. the Mapillary Graph API response). Only AI submissions carry it;
    // crowd submissions leave it untouched (#4806).
    sourceMetadata: Option[JsValue]
)

// NOTE need to update pano_source enum in postgres as well if changing this Enumeration.
object PanoSource extends Enumeration {
  type PanoSource = Value
  val Gsv       = Value("gsv")
  val Mapillary = Value("mapillary")
  val Infra3d   = Value("infra3d")

  /**
   * The tutorial's locally-served panos, whose imagery is app assets. They carry rows so that every label has one
   * (#4587), and this value is what keeps them out of the scraper's work list and every provider call (#4773).
   */
  val Tutorial = Value("tutorial")

  /**
   * Sources whose imagery `PanoDataService.panoExists` can actually verify against a provider API.
   */
  val providerCheckedSources: Set[Value] = Set(Gsv, Mapillary)
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
  def panoId: Rep[String]                = column[String]("pano_id", O.PrimaryKey)
  def width: Rep[Option[Int]]            = column[Option[Int]]("width")
  def height: Rep[Option[Int]]           = column[Option[Int]]("height")
  def tileWidth: Rep[Option[Int]]        = column[Option[Int]]("tile_width")
  def tileHeight: Rep[Option[Int]]       = column[Option[Int]]("tile_height")
  def captureDate: Rep[String]           = column[String]("capture_date")
  def copyright: Rep[Option[String]]     = column[Option[String]]("copyright")
  def lat: Rep[Option[Double]]           = column[Option[Double]]("lat")
  def lng: Rep[Option[Double]]           = column[Option[Double]]("lng")
  def cameraHeading: Rep[Option[Double]] = column[Option[Double]]("camera_heading")
  def cameraPitch: Rep[Option[Double]]   = column[Option[Double]]("camera_pitch")
  def cameraRoll: Rep[Option[Double]]    = column[Option[Double]]("camera_roll")
  def expired: Rep[Boolean]              = column[Boolean]("expired", O.Default(false))
  // last_viewed and last_checked are DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def lastViewed: Rep[OffsetDateTime]               = column[OffsetDateTime]("last_viewed")
  def panoHistorySaved: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("pano_history_saved")
  def lastChecked: Rep[OffsetDateTime]              = column[OffsetDateTime]("last_checked")
  def source: Rep[PanoSource]                       = column[PanoSource]("source")
  def hasBackup: Rep[Option[Boolean]]               = column[Option[Boolean]]("has_backup")
  def address: Rep[Option[String]]                  = column[Option[String]]("address")
  def sourceMetadata: Rep[Option[JsValue]]          = column[Option[JsValue]]("source_metadata")
  // When the imagery went away (#4928). Deliberately outside the default projection below: it is derived from the
  // `expired` transition and belongs only to the queries that own that transition, so no caller can hand it a value.
  // CHECK constraint, which Slick can't express: NULL unless `expired`.
  def expiredAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("expired_at")

  def * = (panoId, width, height, tileWidth, tileHeight, captureDate, copyright, lat, lng, cameraHeading, cameraPitch,
    cameraRoll, expired, lastViewed, panoHistorySaved, lastChecked, source, hasBackup, address, sourceMetadata) <>
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

  implicit private val getPanoExpiryWeek: GetResult[PanoExpiryWeek] =
    GetResult(r => PanoExpiryWeek(r.nextDate().toLocalDate, r.nextInt()))

  /**
   * Panos already expired when `expired_at` started being recorded, so the trend can say how much it can't show.
   */
  def countExpiredWithoutExpiryDate: DBIO[Int] = {
    panoDataRecords.filter(pano => pano.expired && pano.expiredAt.isEmpty).length.result
  }

  /**
   * Panos whose imagery went away, bucketed by ISO week, for the admin imagery-trend chart.
   *
   * Only counts panos that expired after `expired_at` started being recorded (358.sql): earlier expiries have no
   * flip date to bucket, so they are absent rather than piled onto the first week.
   *
   * Note that `expired_at` is current state, not an event log — a re-check or a user view that finds the imagery
   * back clears it — so this reads "panos still missing, by when they went" and a pano that expired and later
   * returned leaves the week it was counted in. Past weeks can therefore shrink between two loads of the chart,
   * which the page says out loud. Turning this into a true series would mean logging expiries the way
   * `street_edge_status_change` logs status moves.
   *
   * @param since Only expiries at or after this instant.
   */
  def newlyExpiredByWeek(since: OffsetDateTime): DBIO[Seq[PanoExpiryWeek]] = {
    sql"""SELECT date_trunc('week', expired_at)::date, COUNT(*)
          FROM pano_data
          WHERE expired_at >= $since
          GROUP BY date_trunc('week', expired_at)::date
          ORDER BY date_trunc('week', expired_at)::date""".as[PanoExpiryWeek]
  }

  /**
   * Get a pano metadata for all panos with a flag indicating whether they have labels.
   *
   * Tutorial panos are excluded: this feeds `/adminapi/panos`, the scraper's work list, and their imagery is app
   * assets with no provider to download from.
   */
  def getAllPanos: DBIO[Seq[PanoDataSlim]] = {
    panoDataRecords
      .filter(_.source =!= PanoSource.Tutorial)
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
   * Count the panos that have associated labels and an imagery source we can verify against a provider API.
   *
   * Sizes the nightly expiry sample, so it counts the same population `getPanoIdsToCheckExpiration` draws from.
   */
  def countCheckablePanosWithLabels: DBIO[Int] = {
    labelTable
      .join(panoDataRecords)
      .on(_.panoId === _.panoId)
      .filter(_._2.source inSet PanoSource.providerCheckedSources)
      .map(_._2.panoId)
      .countDistinct
      .result
  }

  /**
   * Mark whether the pano was expired with a timestamp. If not expired, also update last_viewed column.
   *
   * `expired_at` records when the imagery went away, so it is stamped only on the false -> true edge and left alone
   * by the nightly re-checks that keep confirming an already-expired pano. That is what separates it from
   * `last_checked`, which every check bumps whether or not anything changed — and without the separation, "what
   * newly expired this week" is unanswerable.
   *
   * The expiring branch is one raw statement rather than a Slick pair because the edge test and the flip have to
   * happen together: `pano_data_expired_at_check` is evaluated per statement, so stamping first fails on a row that
   * is still unexpired, and flipping first destroys the very condition the stamp depends on.
   *
   * @param panoId The ID of the pano
   * @param expired Whether the original source for the image has expired
   * @param hasBackup Whether a locally-hosted backup image exists for this pano.
   * @param lastChecked The last time that we checked for image availability
   * @return        Rows updated (0 if the pano isn't recorded).
   */
  def updateExpiredStatus(
      panoId: String,
      expired: Boolean,
      hasBackup: Option[Boolean],
      lastChecked: OffsetDateTime
  ): DBIO[Int] = {
    if (expired) {
      sqlu"""UPDATE pano_data
             SET expired = TRUE,
                 has_backup = $hasBackup,
                 last_checked = $lastChecked,
                 expired_at = CASE WHEN expired THEN expired_at ELSE $lastChecked END
             WHERE pano_id = $panoId"""
    } else {
      val q = for {
        img <- panoDataRecords if img.panoId === panoId
      } yield (img.expired, img.hasBackup, img.lastChecked, img.lastViewed, img.expiredAt)
      q.update((expired, hasBackup, lastChecked, lastChecked, None))
    }
  }

  /**
   * Looks up the imagery-existence answers we can reuse for the given panos instead of asking the provider (#3004).
   *
   * A row qualifies when either:
   *   - `expired` is true. Imagery loss is effectively permanent, and `CheckImageExpiryActor` re-checks expired panos
   *     nightly to catch ones marked so incorrectly, so the foreground call only ever confirms what we know.
   *   - `expired` is false and `last_checked` is at or after `liveCheckedSince`. Liveness *can* lapse at any moment, so
   *     this side carries a TTL that bounds how long we'd keep handing out a pano that has since gone away.
   *
   * Restricted to `PanoSource.providerCheckedSources`: Infra3d imagery is never asked about, so its `expired` and
   * `last_checked` hold no real answer to reuse.
   *
   * @param panoIds          Panos to look up.
   * @param liveCheckedSince Cutoff for reusing a non-expired result; older ones are re-checked.
   * @return                 Pano ID -> whether its imagery exists, holding only the panos an answer is reusable for.
   */
  def getReusableImageryStatus(panoIds: Set[String], liveCheckedSince: OffsetDateTime): DBIO[Map[String, Boolean]] = {
    panoDataRecords
      .filter(_.panoId inSet panoIds)
      .filter(_.source inSet PanoSource.providerCheckedSources)
      .filter(pano => pano.expired || pano.lastChecked >= liveCheckedSince)
      .map(pano => (pano.panoId, pano.expired))
      .result
      .map(_.map { case (panoId, expired) => panoId -> !expired }.toMap)
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
   * Get the n least recently checked panos that haven't been checked in the last 3 months; providerCheckedSources only.
   *
   * @param n       Number of least recently checked panos to return.
   * @param expired Whether to check for expired or unexpired panos.
   * @return        Pano ID paired with its imagery source, least recently checked first.
   */
  def getPanoIdsToCheckExpiration(n: Int, expired: Boolean): DBIO[Seq[(String, PanoSource)]] = {
    // Dedup on (pano_id, source, last_checked) triples — equivalent to deduping pano_id alone, since all three come
    // from the same pano_data row — so that the sort sits at/above the DISTINCT. An ORDER BY buried in a subquery
    // below a DISTINCT is one Postgres is free to discard, which would break "least-recently-checked-first".
    panoDataRecords
      .join(labelTable)
      .on(_.panoId === _.panoId)
      .filter(pano =>
        (pano._1.source inSet PanoSource.providerCheckedSources)
          && pano._1.expired === expired
          && pano._1.lastChecked < OffsetDateTime.now().minusMonths(3)
      )
      .map(pano => (pano._1.panoId, pano._1.source, pano._1.lastChecked))
      .distinct
      .sortBy(_._3.asc)
      .map(pano => (pano._1, pano._2))
      .take(n)
      .result
  }

  /**
   * Inserts the pano's metadata, or refreshes it if the pano is already recorded.
   *
   * A single `INSERT ... ON CONFLICT` statement rather than an exists-check + insert/update pair, so two concurrent
   * submissions of the same new pano (e.g. a `pagehide` flush racing a mission-complete POST, or two open tabs) can't
   * fail on a duplicate key and leave labels without their pano row (#4587).
   *
   * Update semantics when the pano is already recorded:
   *   - Position/camera fields take the submitted value but are never cleared.
   *   - Intrinsic fields (dims, copyright) keep their existing value and only fill in NULLs, as they never change.
   *   - `address` and `source_metadata` are only ever replaced, never cleared.
   *   - The pano was just viewed, so `expired` resets to false and the viewed/checked timestamps refresh.
   *
   * @param data The pano metadata to save.
   * @return Number of rows inserted/updated (always 1).
   */
  def upsert(data: PanoData): DBIO[Int] = {
    sqlu"""
      INSERT INTO pano_data (pano_id, width, height, tile_width, tile_height, capture_date, copyright, lat, lng,
                             camera_heading, camera_pitch, camera_roll, expired, last_viewed, pano_history_saved,
                             last_checked, source, has_backup, address, source_metadata)
      VALUES (${data.panoId}, ${data.width}, ${data.height}, ${data.tileWidth}, ${data.tileHeight},
              ${data.captureDate}, ${data.copyright}, ${data.lat}, ${data.lng}, ${data.cameraHeading},
              ${data.cameraPitch}, ${data.cameraRoll}, ${data.expired}, ${data.lastViewed}, ${data.panoHistorySaved},
              ${data.lastChecked}, ${data.source.toString}::pano_source, ${data.hasBackup}, ${data.address},
              ${data.sourceMetadata.map(m => Json.stringify(m))}::jsonb)
      ON CONFLICT (pano_id) DO UPDATE SET
        lat = COALESCE(EXCLUDED.lat, pano_data.lat),
        lng = COALESCE(EXCLUDED.lng, pano_data.lng),
        camera_heading = COALESCE(EXCLUDED.camera_heading, pano_data.camera_heading),
        camera_pitch = COALESCE(EXCLUDED.camera_pitch, pano_data.camera_pitch),
        camera_roll = COALESCE(EXCLUDED.camera_roll, pano_data.camera_roll),
        width = COALESCE(pano_data.width, EXCLUDED.width),
        height = COALESCE(pano_data.height, EXCLUDED.height),
        tile_width = COALESCE(pano_data.tile_width, EXCLUDED.tile_width),
        tile_height = COALESCE(pano_data.tile_height, EXCLUDED.tile_height),
        copyright = COALESCE(pano_data.copyright, EXCLUDED.copyright),
        address = COALESCE(EXCLUDED.address, pano_data.address),
        source_metadata = COALESCE(EXCLUDED.source_metadata, pano_data.source_metadata),
        expired = false,
        expired_at = NULL,
        last_viewed = EXCLUDED.last_viewed,
        pano_history_saved = EXCLUDED.pano_history_saved,
        last_checked = EXCLUDED.last_checked
    """
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
}
