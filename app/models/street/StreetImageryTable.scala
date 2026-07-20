package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.sql.Date
import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * A street selected for an imagery-age poll, with the sample points to query (#4384).
 *
 * @param streetEdgeId The street to poll.
 * @param points       (lat, lng) sample points along the street: both endpoints plus the midpoint.
 */
case class StreetToPoll(streetEdgeId: Int, points: Seq[(Double, Double)])

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
 * @param dataSource    Which feeder created this row: `pano_data` (in-app, from panos observed while labeling),
 *                      `imagery_scan` (the check_streets_for_imagery.py summary, ingested by
 *                      db/scripts/import-street-imagery.sh), or `imagery_poll` (the nightly in-app freshness poll).
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
  def streetEdgeId: Rep[Int]                = column[Int]("street_edge_id", O.PrimaryKey)
  def oldestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("oldest_capture")
  def newestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("newest_capture")
  def nPanos: Rep[Int]                      = column[Int]("n_panos")
  def dataSource: Rep[String]               = column[String]("data_source")
  def updatedAt: Rep[OffsetDateTime]        = column[OffsetDateTime]("updated_at")

  def * = (streetEdgeId, oldestCapture, newestCapture, nPanos, dataSource, updatedAt) <>
    ((StreetImagery.apply _).tupled, StreetImagery.unapply)

  def streetEdge =
    foreignKey("street_imagery_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[StreetImageryTable]) trait StreetImageryTableRepository {}

/**
 * DAO for the street_imagery table, the app's per-street imagery-age knowledge.
 *
 * Rows come from three feeders: the evolution-326 pano_data backfill, db/scripts/import-street-imagery.sh (offline
 * scan ingest), and the in-app nightly refreshFromPanoData below. The nightly imagery-freshness sync (#4384) compares
 * newest_capture against audit dates to flag audits performed on since-replaced imagery.
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
   * the dates don't change -- which is what advances this rotation.
   *
   * @param limit Maximum number of streets to return.
   */
  def streetsToPoll(limit: Int): DBIO[Seq[StreetToPoll]] = {
    implicit val getStreetToPoll: GetResult[StreetToPoll] = GetResult { r =>
      val (id, x1, y1, x2, y2) = (r.nextInt(), r.nextDouble(), r.nextDouble(), r.nextDouble(), r.nextDouble())
      val (midLat, midLng)     = (r.nextDouble(), r.nextDouble())
      // x = lng and y = lat in street_edge. Midpoint between the endpoints so short streets still get 3 spread points.
      StreetToPoll(id, Seq((y1, x1), (midLat, midLng), (y2, x2)))
    }
    sql"""
      SELECT street_edge.street_edge_id, street_edge.x1, street_edge.y1, street_edge.x2, street_edge.y2,
             ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.5)) AS mid_lat,
             ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.5)) AS mid_lng
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
   * Records one poll's result for a street: widens the capture-date range and always bumps updated_at (#4384).
   *
   * On conflict, capture dates only ever widen (LEAST/GREATEST ignore NULLs) and n_panos / data_source are left
   * alone -- a 3-point poll sees at most a few panos, so a scan's richer pano count stays authoritative. A street
   * where every sample point returned no imagery still gets its row upserted (NULL dates, n_panos 0 on insert), which
   * records "checked, nothing there" and keeps the streetsToPoll rotation advancing.
   *
   * @param streetEdgeId The polled street.
   * @param oldest       Earliest capture date observed across the sample points, if any.
   * @param newest       Latest capture date observed across the sample points, if any.
   * @param nPanos       Number of distinct panos observed across the sample points.
   */
  def upsertFromPoll(
      streetEdgeId: Int,
      oldest: Option[LocalDate],
      newest: Option[LocalDate],
      nPanos: Int
  ): DBIO[Int] = {
    val oldestDate = oldest.map(Date.valueOf).orNull
    val newestDate = newest.map(Date.valueOf).orNull
    sqlu"""
      INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
      VALUES ($streetEdgeId, $oldestDate, $newestDate, $nPanos, 'imagery_poll', now())
      ON CONFLICT (street_edge_id) DO UPDATE
      SET oldest_capture = LEAST(street_imagery.oldest_capture, EXCLUDED.oldest_capture),
          newest_capture = GREATEST(street_imagery.newest_capture, EXCLUDED.newest_capture),
          updated_at     = EXCLUDED.updated_at;
    """
  }

  /**
   * Refreshes street_imagery from the panos observed on recently-labeled streets (zero API cost).
   *
   * Incremental form of the evolution-326 backfill: for every street with a label from the past week, aggregates the
   * capture dates of all panos labeled on it (all providers: GSV, Mapillary, Infra3d) and upserts the street's row.
   * On conflict, capture dates only ever widen (LEAST/GREATEST, which ignore NULLs in Postgres) and n_panos /
   * data_source are left alone -- a scan's full-street pano count is richer than what labeling happens to observe.
   * The seven-day lookback overlaps nightly runs, so a missed run self-heals. The tutorial pano is excluded, and the
   * label->street_edge join guards against labels referencing street edges that are absent from street_edge, which
   * would otherwise violate the street_imagery FK (#4557).
   *
   * @return Number of street rows inserted or updated.
   */
  def refreshFromPanoData: DBIO[Int] = {
    sqlu"""
      INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
      SELECT dated.street_edge_id,
             MIN(dated.capture),
             MAX(dated.capture),
             COUNT(DISTINCT dated.pano_id),
             'pano_data',
             now()
      FROM (
          SELECT label.street_edge_id AS street_edge_id,
                 pano_data.pano_id    AS pano_id,
                 CASE
                     WHEN pano_data.capture_date ~ '^[0-9]{4}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY')
                     WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY-MM')
                     WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$$'
                         THEN to_date(pano_data.capture_date, 'YYYY-MM-DD')
                 END AS capture
          FROM label
          JOIN pano_data ON label.pano_id = pano_data.pano_id
          JOIN street_edge ON label.street_edge_id = street_edge.street_edge_id
          WHERE pano_data.pano_id <> 'tutorial'
              AND label.street_edge_id IN (
                  SELECT DISTINCT street_edge_id
                  FROM label
                  WHERE time_created > now() - interval '7 days'
              )
      ) AS dated
      WHERE dated.capture IS NOT NULL
      GROUP BY dated.street_edge_id
      ON CONFLICT (street_edge_id) DO UPDATE
      SET oldest_capture = LEAST(street_imagery.oldest_capture, EXCLUDED.oldest_capture),
          newest_capture = GREATEST(street_imagery.newest_capture, EXCLUDED.newest_capture),
          updated_at     = EXCLUDED.updated_at;
    """
  }
}
