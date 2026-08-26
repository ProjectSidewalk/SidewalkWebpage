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
 */
case class StreetReopenCandidate(
    streetEdgeId: Int,
    firstDetectedAt: OffsetDateTime,
    lastDetectedAt: OffsetDateTime,
    nPanos: Int,
    newestCapture: Option[LocalDate]
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
  def nPanos: Rep[Int]                      = column[Int]("n_panos") // DB CHECK (365.sql): n_panos > 0.
  def newestCapture: Rep[Option[LocalDate]] = column[Option[LocalDate]]("newest_capture")

  def * = (streetEdgeId, firstDetectedAt, lastDetectedAt, nPanos, newestCapture) <> (
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
 * Rows are written only by the nightly poll's no_imagery rotation and removed three ways: the admin reopens or
 * dismisses the street, a later conclusive poll finds nothing (stale evidence is retracted rather than left under a
 * Reopen button), or mark_streets_no_imagery re-retires the street (checker evidence outranks poll evidence).
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
   * @param streetEdgeId  The polled street.
   * @param nPanos        Attributable panos this poll saw; must be > 0 (a zero-pano poll deletes instead).
   * @param newestCapture Newest capture date among them, if any was parseable.
   * @return 1 if a row was written, 0 when the guard filtered the street out.
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
          newest_capture   = EXCLUDED.newest_capture;
    """
  }

  /** Removes a street's candidate row, returning the number of rows deleted (0 or 1). */
  def delete(streetEdgeId: Int): DBIO[Int] = reopenCandidates.filter(_.streetEdgeId === streetEdgeId).delete

  /**
   * The review queue: current candidates with their regions, most recently detected first.
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
              AND region.deleted = FALSE
          ORDER BY street_reopen_candidate.last_detected_at DESC, street_reopen_candidate.street_edge_id
          LIMIT $limit""".as[ReopenCandidateForReview]
  }
}
