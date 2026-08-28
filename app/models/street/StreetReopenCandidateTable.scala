package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

/**
 * One no_imagery street whose latest conclusive imagery poll found attributable panos (#4929) -- the evidence behind
 * the "Regained imagery" review queue on /admin/street-status.
 *
 * @param streetEdgeId    The street the evidence is about.
 * @param firstDetectedAt When a poll first found imagery on it (kept across re-detections).
 * @param lastDetectedAt  When the most recent positive poll ran.
 * @param nPanos          Attributable panos the most recent positive poll saw (> 0 by construction).
 * @param newestCapture   Newest capture date among those panos, when the provider reported a parseable one.
 * @param dismissedAt     When an admin judged this evidence too weak to reopen on; None while the row is queued.
 */
case class StreetReopenCandidate(
    streetEdgeId: Int,
    firstDetectedAt: OffsetDateTime,
    lastDetectedAt: OffsetDateTime,
    nPanos: Int,
    newestCapture: Option[LocalDate],
    dismissedAt: Option[OffsetDateTime]
)

/** A reopen candidate as the review queue lists it, with its region named for the admin. */
case class ReopenCandidateForReview(
    streetEdgeId: Int,
    regionId: Int,
    regionName: String,
    nPanos: Int,
    newestCapture: Option[LocalDate],
    firstDetectedAt: OffsetDateTime,
    lastDetectedAt: OffsetDateTime
)

class StreetReopenCandidateTableDef(tag: Tag) extends Table[StreetReopenCandidate](tag, "street_reopen_candidate") {
  def streetEdgeId: Rep[Int]               = column[Int]("street_edge_id", O.PrimaryKey)
  def firstDetectedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("first_detected_at") // DEFAULT now() in the DB.
  def lastDetectedAt: Rep[OffsetDateTime]  = column[OffsetDateTime]("last_detected_at")  // DEFAULT now() in the DB.
  def nPanos: Rep[Int]                         = column[Int]("n_panos") // DB CHECK (368.sql): n_panos > 0.
  def newestCapture: Rep[Option[LocalDate]]    = column[Option[LocalDate]]("newest_capture")
  def dismissedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("dismissed_at")

  def * = (streetEdgeId, firstDetectedAt, lastDetectedAt, nPanos, newestCapture, dismissedAt) <> (
    (StreetReopenCandidate.apply _).tupled,
    StreetReopenCandidate.unapply
  )

  // ON DELETE CASCADE: once the street row is gone (remove_streets.sql hard delete), evidence about it is meaningless.
  def streetEdge =
    foreignKey("street_reopen_candidate_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(
      _.streetEdgeId,
      onDelete = ForeignKeyAction.Cascade
    )
}

@ImplementedBy(classOf[StreetReopenCandidateTable])
trait StreetReopenCandidateTableRepository {}

/**
 * DAO over the regained-imagery review queue (#4929).
 *
 * Rows are written only by the nightly poll's no_imagery rotation and removed three ways: the admin reopens the
 * street, a later conclusive poll attributes nothing to it (stale evidence is retracted rather than left under a
 * Reopen button), or mark_streets_no_imagery re-retires the street (checker evidence outranks poll evidence). A
 * dismissal is the one judgement that keeps the row: see [[StreetReopenCandidateTable.dismiss]].
 */
@Singleton
class StreetReopenCandidateTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetReopenCandidateTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val reopenCandidates = TableQuery[StreetReopenCandidateTableDef]

  implicit private val getCandidateForReview: GetResult[ReopenCandidateForReview] = GetResult { r =>
    ReopenCandidateForReview(
      r.nextInt(),
      r.nextInt(),
      r.nextString(),
      r.nextInt(),
      r.nextDateOption().map(_.toLocalDate),
      r.nextOffsetDateTime(),
      r.nextOffsetDateTime()
    )
  }

  /**
   * Records (or refreshes) poll evidence that a no_imagery street has imagery again.
   *
   * Guarded by the street's current status so a street reopened (by the admin, or by a script) between the poll's
   * batch selection and this write cannot re-mint a candidate. On conflict the evidence columns and lastDetectedAt
   * are refreshed while firstDetectedAt keeps the original detection time.
   *
   * The `DO UPDATE ... WHERE` is what makes a dismissal stick. A dismissed row is only rewritten -- and so only
   * returned to the queue -- when this poll's evidence beats what the admin already rejected: more attributable
   * panos, or a capture date newer than the one on the row (a first-ever date counting as newer). Otherwise nothing
   * is written at all, which is deliberate: the evidence columns stay frozen at the dismissed snapshot, so the bar
   * for re-surfacing cannot creep upward poll by poll.
   *
   * @param streetEdgeId  The polled street.
   * @param nPanos        Attributable panos this poll saw; must be > 0 (a zero-pano poll deletes instead).
   * @param newestCapture Newest capture date among them, if any was parseable.
   * @return 1 if a row was written, 0 when the street-status guard filtered it out or a dismissal outranks it.
   */
  def upsertFromPoll(streetEdgeId: Int, nPanos: Int, newestCapture: Option[LocalDate]): DBIO[Int] = {
    sqlu"""
      INSERT INTO street_reopen_candidate (street_edge_id, n_panos, newest_capture)
      SELECT street_edge.street_edge_id, $nPanos, ${newestCapture.map(_.toString)}::date
      FROM street_edge
      WHERE street_edge.street_edge_id = $streetEdgeId AND street_edge.status = 'no_imagery'
      ON CONFLICT (street_edge_id) DO UPDATE
      SET last_detected_at = now(),
          n_panos          = EXCLUDED.n_panos,
          newest_capture   = EXCLUDED.newest_capture,
          dismissed_at     = NULL
      WHERE street_reopen_candidate.dismissed_at IS NULL
          OR EXCLUDED.n_panos > street_reopen_candidate.n_panos
          OR (EXCLUDED.newest_capture IS NOT NULL
              AND (street_reopen_candidate.newest_capture IS NULL
                  OR EXCLUDED.newest_capture > street_reopen_candidate.newest_capture));
    """
  }

  /**
   * Marks a candidate dismissed: the admin looked and judged the evidence too weak to reopen on (#4929).
   *
   * Keeps the row rather than deleting it, so the poll can distinguish a street it has never queued from one whose
   * evidence has already been rejected -- see [[upsertFromPoll]] for the bar a later poll has to clear to bring it
   * back. Idempotent: dismissing an already-dismissed street reports 0 and leaves the original judgement's timestamp.
   *
   * @return 1 if a queued row was dismissed, 0 when there was no queued row to dismiss.
   */
  def dismiss(streetEdgeId: Int): DBIO[Int] = {
    sqlu"""
      UPDATE street_reopen_candidate
      SET dismissed_at = now()
      WHERE street_edge_id = $streetEdgeId AND dismissed_at IS NULL;
    """
  }

  /** Removes a street's candidate row, returning the number of rows deleted (0 or 1). */
  def delete(streetEdgeId: Int): DBIO[Int] = reopenCandidates.filter(_.streetEdgeId === streetEdgeId).delete

  /**
   * Drops evidence about streets whose status is something other than `no_imagery`, returning how many rows it
   * removed.
   *
   * Every path that retracts a candidate deliberately (reopen, empty poll, mark_streets_no_imagery) covers its own
   * case, but a street can leave `no_imagery` through a script that knows nothing about this table -- hiding a whole
   * neighborhood closes its streets, say. `candidatesForReview` filters such rows out, so they are invisible rather
   * than harmful; they matter only if the street is retired again later, when years-old evidence would reappear
   * under a Reopen button. The nightly poll runs this to keep that from happening.
   */
  def deleteForNonRetiredStreets: DBIO[Int] = {
    sqlu"""
      DELETE FROM street_reopen_candidate
      USING street_edge
      WHERE street_reopen_candidate.street_edge_id = street_edge.street_edge_id
          AND street_edge.status <> 'no_imagery';
    """
  }

  /**
   * The review queue: undismissed candidates with their regions, most recently detected first.
   *
   * Joins street_edge and re-checks `status = 'no_imagery'` as a second belt behind the guarded upsert -- a row that
   * somehow survived a reopen must not offer the admin a Reopen button for an already-open street.
   *
   * @param limit How many candidates to list.
   */
  def candidatesForReview(limit: Int): DBIO[Seq[ReopenCandidateForReview]] = {
    sql"""SELECT street_reopen_candidate.street_edge_id,
                 region.region_id,
                 region.name,
                 street_reopen_candidate.n_panos,
                 street_reopen_candidate.newest_capture,
                 street_reopen_candidate.first_detected_at,
                 street_reopen_candidate.last_detected_at
          FROM street_reopen_candidate
          JOIN street_edge ON street_reopen_candidate.street_edge_id = street_edge.street_edge_id
          JOIN street_edge_region ON street_reopen_candidate.street_edge_id = street_edge_region.street_edge_id
          JOIN region ON street_edge_region.region_id = region.region_id
          WHERE street_edge.status = 'no_imagery'
              AND street_reopen_candidate.dismissed_at IS NULL
              AND region.deleted = FALSE
          ORDER BY street_reopen_candidate.last_detected_at DESC, street_reopen_candidate.street_edge_id
          LIMIT $limit""".as[ReopenCandidateForReview]
  }
}
