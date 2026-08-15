package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * Per-street imagery age (#4348): the capture-date range of the street-view panos observed on one street.
 *
 * Complements street_edge_status (#3888): status says whether a street has imagery; this says how old it is (a street
 * can be `open` yet years out of date). One row per street, aggregated across providers.
 *
 * @param streetEdgeId  The street this imagery summary is for.
 * @param oldestCapture Earliest observed capture date, standardized to a date (`None` if none were parseable).
 * @param newestCapture Latest observed capture date, standardized to a date (`None` if none were parseable).
 * @param nPanos        Number of distinct dated panos observed on the street.
 * @param dataSource    Which feeder created this row: `pano_data` (in-app, from panos observed while labeling) or
 *                      `imagery_scan` (the check_streets_for_imagery.py summary, ingested by
 *                      db/scripts/import-street-imagery.sh).
 * @param updatedAt     When this row was last written.
 */
case class StreetImagery(
    streetEdgeId: Int,
    oldestCapture: Option[LocalDate],
    newestCapture: Option[LocalDate],
    nPanos: Int,
    dataSource: String,
    updatedAt: OffsetDateTime
)

class StreetImageryTableDef(tag: Tag) extends Table[StreetImagery](tag, "street_imagery") {
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id", O.PrimaryKey)
  // DB CHECK (356.sql): oldest_capture <= newest_capture when both are present.
  def oldestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("oldest_capture")
  def newestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("newest_capture")
  def nPanos: Rep[Int]                      = column[Int]("n_panos") // DB CHECK (356.sql): n_panos >= 0.
  // DB CHECK (356.sql): one of 'pano_data', 'imagery_scan', 'imagery_poll'.
  def dataSource: Rep[String]        = column[String]("data_source")
  def updatedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("updated_at")

  def * = (streetEdgeId, oldestCapture, newestCapture, nPanos, dataSource, updatedAt) <>
    ((StreetImagery.apply _).tupled, StreetImagery.unapply)

  def streetEdge =
    foreignKey("street_imagery_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[StreetImageryTable]) trait StreetImageryTableRepository {}

object StreetImageryTable {

  /**
   * How close (meters) a pano must be to a street's geometry to be a candidate observation of that street's imagery.
   *
   * A pano genuinely on a street sits on the roadway, within ~10 m of the centerline even on wide streets, while a
   * pano down a cross street starts ~15-20 m from this street's line beyond the shared corner. 15 m keeps the former
   * and rejects the latter. Among candidate streets, the pano informs only the NEAREST one: imagery providers
   * re-drive streets one at a time, so a corner pano's capture date describes its own street's drive, not every
   * street meeting at the intersection -- attributing it to all of them smears one street's re-drive date onto its
   * neighbors and triggers spurious outdated_imagery flags (measured on Teaneck: 43% of flags were such smears).
   */
  val PanoStreetToleranceMeters: Double = 15.0
}

/**
 * DAO for the street_imagery table, the app's per-street imagery-age knowledge.
 *
 * Rows come from three feeders: the evolution-356 pano_data backfill, db/scripts/import-street-imagery.sh (offline
 * scan ingest), and the in-app nightly refreshFromPanoData below. The nightly imagery-freshness sync (#4384) compares
 * newest_capture against audit dates to flag audits performed on since-replaced imagery. Pano-derived rows attribute
 * a pano to its nearest street within PanoStreetToleranceMeters of the pano's position, never via the street of the
 * labels placed on it -- labelers routinely observe panos that sit on a different street than the one they audit.
 */
@Singleton
class StreetImageryTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetImageryTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._
  val streetImageryRecords = TableQuery[StreetImageryTableDef]

  /**
   * Imagery age for a single street.
   *
   * @param streetEdgeId The street to look up.
   * @return The street's imagery summary, or `None` if no imagery has been recorded for it.
   */
  def getForStreet(streetEdgeId: Int): DBIO[Option[StreetImagery]] = {
    streetImageryRecords.filter(_.streetEdgeId === streetEdgeId).result.headOption
  }

  /**
   * Number of streets that have a recorded imagery summary.
   */
  def count: DBIO[Int] = streetImageryRecords.length.result

  /**
   * Refreshes street_imagery from recently-viewed panos, attributing each pano to its nearest street (zero API cost).
   *
   * A pano viewed in the past week informs the single street nearest its position, provided that street is within
   * PanoStreetToleranceMeters -- see that constant for why attribution is nearest-street rather than via
   * label.street_edge_id or every street in tolerance. The evolution-356 backfill uses the same attribution, so a
   * street's aggregate here matches what a full rebuild would produce. All providers feed this (GSV, Mapillary,
   * Infra3d): pano_data rows are written whenever a labeler views a pano.
   *
   * On conflict, capture dates only ever widen (LEAST/GREATEST, which ignore NULLs in Postgres) and n_panos /
   * data_source are left alone -- a scan's full-street pano count is richer than the labeling-observed subset. The
   * seven-day last_viewed lookback overlaps nightly runs, so a missed run self-heals. Panos without a stored position
   * (lat/lng are nullable) contribute nothing, the tutorial pano is skipped, and a pano whose nearest street is the
   * tutorial street is dropped rather than reattributed.
   *
   * @return Number of street rows inserted or updated.
   */
  def refreshFromPanoData: DBIO[Int] = {
    sqlu"""
      INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
      SELECT nearest.street_edge_id,
             MIN(nearest.capture),
             MAX(nearest.capture),
             COUNT(DISTINCT nearest.pano_id),
             'pano_data',
             now()
      FROM (
          SELECT DISTINCT ON (pano_data.pano_id)
                 street_edge.street_edge_id AS street_edge_id,
                 pano_data.pano_id          AS pano_id,
                 CASE
                     WHEN pano_data.capture_date ~ '^[0-9]{4}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY')
                     WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY-MM')
                     WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY-MM-DD')
                 END AS capture
          FROM pano_data
          -- Geometry-space ST_DWithin runs first so the street_edge GiST index prunes candidates (0.001 deg is
          -- comfortably wider than 15 m at any real-city latitude); the geography-space check applies the exact
          -- meter tolerance. DISTINCT ON + the ORDER BY keeps only the nearest candidate street per pano.
          JOIN street_edge
              ON ST_DWithin(street_edge.geom, ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326), 0.001)
              AND ST_DWithin(
                      street_edge.geom::geography,
                      ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326)::geography,
                      ${StreetImageryTable.PanoStreetToleranceMeters}
                  )
          WHERE pano_data.pano_id <> 'tutorial'
              AND pano_data.lat IS NOT NULL
              AND pano_data.lng IS NOT NULL
              AND pano_data.last_viewed > now() - interval '7 days'
          ORDER BY pano_data.pano_id,
                   ST_Distance(
                       street_edge.geom::geography,
                       ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326)::geography
                   )
      ) AS nearest
      WHERE nearest.capture IS NOT NULL
          AND nearest.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      GROUP BY nearest.street_edge_id
      ON CONFLICT (street_edge_id) DO UPDATE
      SET oldest_capture = LEAST(street_imagery.oldest_capture, EXCLUDED.oldest_capture),
          newest_capture = GREATEST(street_imagery.newest_capture, EXCLUDED.newest_capture),
          updated_at     = EXCLUDED.updated_at;
    """
  }
}
