package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * A street selected for an imagery-age poll, with the sample points to query (#4384).
 *
 * @param streetEdgeId The street to poll.
 * @param points       (lat, lng) sample points along the street's interior, at the 20%/50%/80% marks. Interior on
 *                     purpose: an endpoint sits on an intersection, where the pano nearest the sample point is often
 *                     on a cross street and would smear that street's capture dates onto this one.
 * @param geom         The street's full geometry, so observed panos can be checked against the street itself.
 */
case class StreetToPoll(streetEdgeId: Int, points: Seq[(Double, Double)], geom: LineString)

/**
 * One pano observation forwarded to upsertFromPoll: its position, parsed capture date (if any), and which of the
 * street's sample points it was seen from. The upsert attributes the observation to the polled street only when that
 * street is the nearest one to this position (#4384), the same rule refreshFromPanoData and the evolution-356
 * backfill apply to labeling-observed panos; pointIndex is what lets it compute the per-point newest captures behind
 * median_newest_capture.
 */
case class PolledPano(lat: Double, lng: Double, capture: Option[LocalDate], pointIndex: Int)

/**
 * Which feeder wrote a street_imagery row. Values match the Postgres `street_imagery_source` enum type (356.sql):
 * `pano_data` is the in-app refresh from panos observed while labeling, `imagery_scan` the offline
 * check_streets_for_imagery.py summary (ingested by db/scripts/import-street-imagery.sh), and `imagery_poll` the
 * nightly in-app provider poll.
 */
object StreetImagerySource extends Enumeration {
  type StreetImagerySource = Value
  val PanoData    = Value("pano_data")
  val ImageryScan = Value("imagery_scan")
  val ImageryPoll = Value("imagery_poll")
}

/**
 * Per-street imagery age (#4348): the capture-date range of the street-view panos observed on one street.
 *
 * Complements street_edge_status (#3888): status says whether a street has imagery; this says how old it is (a street
 * can be `open` yet years out of date). One row per street, aggregated across providers.
 *
 * @param streetEdgeId        The street this imagery summary is for.
 * @param oldestCapture       Earliest observed capture date, standardized to a date (`None` if none were parseable).
 * @param newestCapture       Latest observed capture date, standardized to a date (`None` if none were parseable).
 * @param medianNewestCapture Newest capture date at the street's median sampled point: at least half the street's
 *                            sample points show imagery at least this new. Written only by the nightly imagery-age
 *                            poll (`None` until a street has been polled); drives the outdated_imagery flag (#4384).
 * @param nPanos              Number of distinct dated panos observed on the street.
 * @param dataSource          Which feeder created this row.
 * @param updatedAt           When this row was last written.
 */
case class StreetImagery(
    streetEdgeId: Int,
    oldestCapture: Option[LocalDate],
    newestCapture: Option[LocalDate],
    medianNewestCapture: Option[LocalDate],
    nPanos: Int,
    dataSource: StreetImagerySource.Value,
    updatedAt: OffsetDateTime
)

class StreetImageryTableDef(tag: Tag) extends Table[StreetImagery](tag, "street_imagery") {
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id", O.PrimaryKey)
  // DB CHECK (356.sql): oldest_capture <= newest_capture when both are present.
  def oldestCapture: Rep[Option[LocalDate]]       = column[Option[LocalDate]]("oldest_capture")
  def newestCapture: Rep[Option[LocalDate]]       = column[Option[LocalDate]]("newest_capture")
  def medianNewestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("median_newest_capture")
  def nPanos: Rep[Int]                            = column[Int]("n_panos") // DB CHECK (356.sql): n_panos >= 0.
  def dataSource: Rep[StreetImagerySource.Value]  = column[StreetImagerySource.Value]("data_source")
  def updatedAt: Rep[OffsetDateTime]              = column[OffsetDateTime]("updated_at")

  def * = (streetEdgeId, oldestCapture, newestCapture, medianNewestCapture, nPanos, dataSource, updatedAt) <>
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
 * median_newest_capture against audit dates to flag audits where at least half the street's sampled points show
 * newer imagery. Pano-derived rows attribute a pano to its nearest street within PanoStreetToleranceMeters of the
 * pano's position, never via the street of the labels placed on it -- labelers routinely observe panos that sit on a
 * different street than the one they audit.
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
   * Picks the streets most in need of an imagery-age poll (#4384).
   *
   * Open, non-tutorial streets, ordered so that audited streets come first (their outdated_imagery flags are what the
   * poll exists to feed) and, within each group, streets whose imagery knowledge is oldest (no street_imagery row at
   * all first, then stale updated_at). The poller bumps updated_at on every street it successfully polls -- even when
   * the dates don't change -- which is what advances this rotation. The tiering is strict: in a city with more than
   * `limit` audited streets, the batch is all audited streets and unaudited ones are never reached -- accepted,
   * since only audited streets have flags to feed, but it means this poll is not a city-wide imagery census.
   *
   * Sample points sit at the street's 20%/50%/80% marks -- see StreetToPoll for why interior points, not endpoints.
   *
   * The ordering forces a full sort of the city's open streets each night, but that is a top-N heapsort over a few
   * tens of thousands of rows and Postgres evaluates the PostGIS interpolations above the Limit, so only `limit`
   * streets pay for them. No need to hand-roll a subquery to get that.
   *
   * @param limit Maximum number of streets to return.
   */
  def streetsToPoll(limit: Int): DBIO[Seq[StreetToPoll]] = {
    implicit val getStreetToPoll: GetResult[StreetToPoll] = GetResult { r =>
      val id     = r.nextInt()
      val points = Seq.fill(3)((r.nextDouble(), r.nextDouble())) // Each ST_LineInterpolatePoint pair is (lat, lng).
      StreetToPoll(id, points, r.nextGeometry[LineString]())
    }
    sql"""
      SELECT street_edge.street_edge_id,
             ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.2)) AS near_start_lat,
             ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.2)) AS near_start_lng,
             ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.5)) AS mid_lat,
             ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.5)) AS mid_lng,
             ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.8)) AS near_end_lat,
             ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.8)) AS near_end_lng,
             street_edge.geom
      FROM street_edge
      LEFT JOIN street_imagery ON street_edge.street_edge_id = street_imagery.street_edge_id
      WHERE street_edge.status = 'open'
          AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      ORDER BY EXISTS (
                   SELECT FROM audit_task
                   WHERE audit_task.street_edge_id = street_edge.street_edge_id AND audit_task.completed = TRUE
               ) DESC,
               street_imagery.updated_at ASC NULLS FIRST,
               street_edge.street_edge_id
      LIMIT $limit;
    """.as[StreetToPoll]
  }

  /**
   * Records one poll's result for a street: snapshots median_newest_capture, widens the min/max capture range, and
   * always bumps updated_at (#4384).
   *
   * Each observation is attributed only if the polled street is the NEAREST street (within
   * PanoStreetToleranceMeters) to the observation's position -- the same nearest-street rule as refreshFromPanoData,
   * checked here in SQL because deciding "nearest" needs the whole street network, not just the polled street's
   * geometry. A corner pano whose nearest street is the cross street therefore never smears its date onto this one.
   *
   * median_newest_capture is the ceil(n/2)-th newest of the per-sample-point newest captures, with a point that has
   * no attributable dated imagery counting as infinitely old -- so an audit predating it means at least half the
   * sampled points show newer imagery (the flag rule in syncOutdatedImageryFlags). Unlike the min/max range it is
   * REPLACED each poll, not widened: each poll is a complete snapshot of the same fixed sample points, and only this
   * method writes the column, so widening would just fossilize the newest snapshot ever seen and stop flags from
   * clearing when a later poll walks the median back.
   *
   * On conflict, oldest/newest only ever widen (LEAST/GREATEST ignore NULLs) and n_panos / data_source are left
   * alone -- a poll sees at most a few panos, so a scan's richer pano count stays authoritative. A street where
   * nothing was attributable still gets its row upserted (NULL dates, n_panos 0 on insert), recording "checked,
   * nothing there" and advancing the streetsToPoll rotation -- and NULLing the median, since that is this poll's
   * honest snapshot.
   *
   * @param streetEdgeId   The polled street.
   * @param nPointsSampled How many sample points the poll conclusively answered for (the median's denominator).
   * @param panos          Observations from the street's sample points, deduped per (pano, sample point) -- a pano
   *                       genuinely visible from two sample points informs both points' newest capture.
   */
  def upsertFromPoll(streetEdgeId: Int, nPointsSampled: Int, panos: Seq[PolledPano]): DBIO[Int] = {
    if (panos.isEmpty) {
      sqlu"""
        INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, median_newest_capture, n_panos,
                                    data_source, updated_at)
        VALUES ($streetEdgeId, NULL, NULL, NULL, 0, 'imagery_poll', now())
        ON CONFLICT (street_edge_id) DO UPDATE
        SET median_newest_capture = NULL,
            updated_at            = EXCLUDED.updated_at;
      """
    } else {
      // The (offset+1)-th newest per-point date is the youngest date that at least ceil(n/2) sampled points reach.
      val medianOffset = (nPointsSampled + 1) / 2 - 1
      // Inlined literals are program-built numerics and ISO dates (never user input), so interpolation is safe here.
      val valuesList = panos
        .map { pano =>
          val capture = pano.capture.map(d => s"'$d'::date").getOrElse("NULL::date")
          s"(${pano.lat}::float8, ${pano.lng}::float8, $capture, ${pano.pointIndex}::int)"
        }
        .mkString(", ")
      sqlu"""
        WITH observed (lat, lng, capture, point_idx) AS (VALUES #$valuesList),
        kept AS (
            SELECT observed.lat, observed.lng, observed.capture, observed.point_idx
            FROM observed
            WHERE (
                SELECT street_edge.street_edge_id
                FROM street_edge
                WHERE ST_DWithin(street_edge.geom, ST_SetSRID(ST_MakePoint(observed.lng, observed.lat), 4326), 0.001)
                    AND ST_DWithin(
                            street_edge.geom::geography,
                            ST_SetSRID(ST_MakePoint(observed.lng, observed.lat), 4326)::geography,
                            ${StreetImageryTable.PanoStreetToleranceMeters}
                        )
                ORDER BY ST_Distance(
                             street_edge.geom::geography,
                             ST_SetSRID(ST_MakePoint(observed.lng, observed.lat), 4326)::geography
                         )
                LIMIT 1
            ) = $streetEdgeId
        ),
        per_point AS (
            SELECT MAX(kept.capture) AS newest_at_point
            FROM kept
            GROUP BY kept.point_idx
        ),
        median AS (
            -- Sample points absent from per_point (nothing attributable) or with only undated panos (NULL max) rank
            -- as infinitely old, so they are simply skipped: if fewer than ceil(n/2) points have a dated newest, the
            -- OFFSET walks past the last row and the scalar subquery below yields NULL (no median claim).
            SELECT per_point.newest_at_point AS capture_at_median_point
            FROM per_point
            WHERE per_point.newest_at_point IS NOT NULL
            ORDER BY per_point.newest_at_point DESC
            OFFSET $medianOffset LIMIT 1
        )
        INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, median_newest_capture, n_panos,
                                    data_source, updated_at)
        SELECT $streetEdgeId, MIN(kept.capture), MAX(kept.capture),
               (SELECT median.capture_at_median_point FROM median),
               -- Distinct positions stand in for distinct panos: a pano seen from two sample points appears once per
               -- point in `kept`, at the identical provider-reported position.
               COUNT(DISTINCT (kept.lat, kept.lng)) FILTER (WHERE kept.capture IS NOT NULL),
               'imagery_poll', now()
        FROM kept
        ON CONFLICT (street_edge_id) DO UPDATE
        SET oldest_capture        = LEAST(street_imagery.oldest_capture, EXCLUDED.oldest_capture),
            newest_capture        = GREATEST(street_imagery.newest_capture, EXCLUDED.newest_capture),
            median_newest_capture = EXCLUDED.median_newest_capture,
            updated_at            = EXCLUDED.updated_at;
      """
    }
  }

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
   * data_source / median_newest_capture are left alone -- a scan's full-street pano count is richer than the
   * labeling-observed subset, and labeling-observed panos are too positionally biased to support the median's
   * "half the street" claim (only the fixed-sample-point poll writes it). The
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
          WHERE pano_data.source <> 'tutorial'
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
