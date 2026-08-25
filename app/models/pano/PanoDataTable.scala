package models.pano

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json.{__, JsValue, Json, Writes}

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

  /**
   * Sources a client may name in a submission. `Tutorial` is server-owned.
   */
  val clientSubmittableSources: Set[Value] = Set(Gsv, Mapillary, Infra3d)
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

object PanoDataSlim {
  implicit val panoDataSlimWrites: Writes[PanoDataSlim] = (
    (__ \ "pano_id").write[String] and
      (__ \ "has_labels").write[Boolean] and
      (__ \ "width").writeNullable[Int] and
      (__ \ "height").writeNullable[Int] and
      (__ \ "lat").writeNullable[Double] and
      (__ \ "lng").writeNullable[Double] and
      (__ \ "camera_heading").writeNullable[Double] and
      (__ \ "camera_pitch").writeNullable[Double] and
      (__ \ "camera_roll").writeNullable[Double] and
      (__ \ "source").write[PanoSource.Value]
  )(unlift(PanoDataSlim.unapply))
}

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

  /**
   * Panos that were already expired before any of this was recorded, so the trend can say how much it can't show.
   *
   * These are the rows `pano_imagery_change` has no event for and never will: they expired before 358 added
   * `expired_at`, so 363's backfill of the log from that column had no date to seed them with.
   */
  def countExpiredWithoutExpiryDate: DBIO[Int] = {
    panoDataRecords.filter(pano => pano.expired && pano.expiredAt.isEmpty).length.result
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
      .map(_.map((PanoDataSlim.apply _).tupled))
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
   * Both branches carry two edge-triggered side effects on top of the flip itself. `expired_at` is stamped on the
   * false -> true edge and cleared on the way back, so it dates the imagery that is missing now — which
   * `last_checked` cannot, since every re-check bumps that whether or not anything changed. And a row goes into
   * `pano_imagery_change` on either edge, which is what survives the round trip: `expired_at` is destroyed when the
   * imagery returns, taking the week the pano expired in with it (#4947).
   *
   * Both branches are single raw statements rather than Slick updates because each needs the pre-update value of
   * `expired` and can't read it back afterwards — `UPDATE ... RETURNING` hands back the new row. A CTE that reads
   * the row sees the statement's snapshot, so `edge` holds the state as it was before the flip. It also settles the
   * expiring branch's other constraint: `pano_data_expired_at_check` is evaluated per statement, so stamping in a
   * separate statement first fails on a row that is still unexpired, and flipping first destroys the very condition
   * the stamp depends on.
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
    val source = PanoImageryChangeSource.ProviderCheck.toString
    if (expired) {
      sqlu"""WITH edge AS (
               SELECT pano_id FROM pano_data WHERE pano_id = $panoId AND NOT expired
             ), logged AS (
               INSERT INTO pano_imagery_change (pano_id, expired, changed_at, source)
               SELECT pano_id, TRUE, $lastChecked, $source::pano_imagery_change_source FROM edge
             )
             UPDATE pano_data
             SET expired = TRUE,
                 has_backup = $hasBackup,
                 last_checked = $lastChecked,
                 expired_at = CASE WHEN expired THEN expired_at ELSE $lastChecked END
             WHERE pano_id = $panoId"""
    } else {
      sqlu"""WITH edge AS (
               SELECT pano_id FROM pano_data WHERE pano_id = $panoId AND expired
             ), logged AS (
               INSERT INTO pano_imagery_change (pano_id, expired, changed_at, source)
               SELECT pano_id, FALSE, $lastChecked, $source::pano_imagery_change_source FROM edge
             )
             UPDATE pano_data
             SET expired = FALSE,
                 has_backup = $hasBackup,
                 last_checked = $lastChecked,
                 last_viewed = $lastChecked,
                 expired_at = NULL
             WHERE pano_id = $panoId"""
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
   * Un-expiring a pano this way is a real imagery transition — a labeler loading it is proof the imagery is back —
   * so it records one in `pano_imagery_change` (#4947). The `edge` CTE is what keeps it to the transition: it sees
   * the statement's snapshot, so it holds the pano's state before the upsert, and the common case of viewing a pano
   * that was never expired logs nothing. New panos match nothing there either, so the log row can't precede the row
   * it references.
   *
   * @param data The pano metadata to save.
   * @return Number of rows inserted/updated (always 1).
   */
  def upsert(data: PanoData): DBIO[Int] = {
    val source = PanoImageryChangeSource.PanoView.toString
    sqlu"""
      WITH edge AS (
        SELECT pano_id FROM pano_data WHERE pano_id = ${data.panoId} AND expired
      ), logged AS (
        INSERT INTO pano_imagery_change (pano_id, expired, changed_at, source)
        SELECT pano_id, FALSE, ${data.lastViewed}, $source::pano_imagery_change_source FROM edge
      )
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
