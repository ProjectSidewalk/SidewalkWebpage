package util

import models.audit.{AuditTask, AuditTaskTable, AuditTaskTableDef}
import models.user.{SidewalkUser, SidewalkUserTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.guice.GuiceOneAppPerSuite

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Synthetic mappers, regions, streets, and audits for the DB-backed specs that assert on per-user street sets (#4896).
 *
 * Seeding rather than hunting is what makes those specs mean anything: nothing in a fresh dev dump is flagged as
 * needing a re-audit, and CI's schema holds a single street and no audits at all, so a spec that looked for
 * pre-existing rows would either pass vacuously or cancel. A case that seeds its own world can instead assert
 * exactly ("these three streets, in this order").
 *
 * Every helper writes real rows, so a spec must either wrap them in [[RolledBackDb.runRolledBack]] or delete what it
 * seeded in an `afterAll`. Mix into a `PlaySpec with GuiceOneAppPerSuite with RolledBackDb`.
 */
trait StreetFixtures { this: GuiceOneAppPerSuite with RolledBackDb =>

  // Plain defs, deliberately: a `lazy val` here would be initialized under the spec instance's monitor, and these
  // helpers' later steps run on a Slick thread. A spec that blocks on `run(...)` from inside its own lazy val would
  // then deadlock -- the blocked thread holds the monitor the Slick thread needs -- until the await times out.
  private def auditTaskTableForFixtures = app.injector.instanceOf[AuditTaskTable]
  private def auditTasksForFixtures     = TableQuery[AuditTaskTableDef]
  private def sidewalkUsersForFixtures  = TableQuery[SidewalkUserTableDef]

  /** The geodesic (WGS84) length of every street [[insertStreet]] seeds: one degree along the equator. */
  protected val OneDegreeEquatorMeters: Double = 111319.4908

  /** Timestamps are compared after a round trip through Postgres, whose timestamptz resolution is microseconds. */
  protected def now: OffsetDateTime = OffsetDateTime.now.truncatedTo(ChronoUnit.MILLIS)

  /**
   * A throwaway mapper with no work anywhere, so their street set is exactly what a case seeds. Gets the `user_stat`
   * row every signed-in user gets on their first request to a city.
   */
  protected def insertUser(): DBIO[String] = {
    val userId = UUID.randomUUID.toString
    for {
      _ <- sidewalkUsersForFixtures += SidewalkUser(userId, s"spec-$userId", s"spec-$userId@example.com")
      _ <- sqlu"""INSERT INTO user_stat (user_stat_id, user_id)
                  VALUES ((SELECT COALESCE(MAX(user_stat_id), 0) + 1 FROM user_stat), $userId)"""
    } yield userId
  }

  /**
   * Flags a mapper as excluded, the way an admin does when their work turns out to be unreliable.
   *
   * @return The number of rows written.
   */
  protected def excludeUser(userId: String): DBIO[Int] =
    sqlu"UPDATE user_stat SET excluded = TRUE, high_quality = FALSE WHERE user_id = $userId"

  /**
   * A region of the spec's own, so the streets hung there are reachable only by the case that seeded them.
   *
   * Explicit ids throughout these helpers: the dev dumps insert rows with explicit ids without advancing the
   * sequences, so a sequence default can collide with an existing row.
   */
  protected def insertRegion(deleted: Boolean = false): DBIO[Int] =
    sql"""INSERT INTO region (region_id, data_source, name, geom, deleted)
          VALUES ((SELECT COALESCE(MAX(region_id), 0) + 1 FROM region), 'spec', 'Spec Region',
                  ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 0 1, 1 1, 1 0, 0 0))'), 4326)), $deleted)
          RETURNING region_id""".as[Int].head

  /** Moves a street into a region, replacing whatever region it was in (street_edge_region is unique per street). */
  protected def putInRegion(streetEdgeId: Int, regionId: Int): DBIO[Int] =
    sqlu"""DELETE FROM street_edge_region WHERE street_edge_id = $streetEdgeId""" andThen
      sqlu"""INSERT INTO street_edge_region (street_edge_region_id, street_edge_id, region_id)
             VALUES ((SELECT COALESCE(MAX(street_edge_region_id), 0) + 1 FROM street_edge_region),
                     $streetEdgeId, $regionId)"""

  /**
   * A street of known geodesic length, optionally placed in a region.
   *
   * @param regionId     The region to hang it in. `None` leaves it out of every region, which is all a spec needs
   *                     when the query under test doesn't join one.
   * @param status       What makes a street auditable at all: only `open` streets are handed out.
   * @param withPriority Adds the `street_edge_priority` row. Opt-in, and only for a spec exercising task assignment:
   *                     those queries inner-join priority, so a street without the row is invisible to them (see
   *                     StreetLifecycleService, which re-inserts it when a street is reopened). It is off by default
   *                     because the row holds a foreign key to `street_edge`, so a spec that deletes its seeded
   *                     streets must delete the priority rows first or the sweep fails and leaves everything behind.
   * @param priority     Where the street sits in the assignment order; the default is a never-audited street's.
   */
  protected def insertStreet(
      regionId: Option[Int] = None,
      status: String = "open",
      withPriority: Boolean = false,
      priority: Double = 1.0
  ): DBIO[Int] = for {
    streetEdgeId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                          VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                                  ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(1, 0)), 4326),
                                  0, 0, 1, 0, 'residential', CAST($status AS street_edge_status))
                          RETURNING street_edge_id""".as[Int].head
    _ <-
      if (withPriority)
        sqlu"""INSERT INTO street_edge_priority (street_edge_priority_id, street_edge_id, priority)
               VALUES ((SELECT COALESCE(MAX(street_edge_priority_id), 0) + 1 FROM street_edge_priority),
                       $streetEdgeId, $priority)"""
      else DBIO.successful(0)
    _ <- regionId.map(putInRegion(streetEdgeId, _)).getOrElse(DBIO.successful(0))
  } yield streetEdgeId

  /** Seeds `n` streets in one region, returned in ascending id order. */
  protected def insertStreets(regionId: Int, n: Int, withPriority: Boolean = false): DBIO[Seq[Int]] =
    DBIO.sequence((1 to n).map(_ => insertStreet(Some(regionId), withPriority = withPriority))).map(_.sorted.toSeq)

  /**
   * Records an audit of a street.
   *
   * @param outdated  Whether the nightly sync has since flagged this audit as predating newer imagery (#4384) -- what
   *                  makes the street a re-audit candidate. An unflagged completed audit is what takes it back off
   *                  every list, whoever made it.
   * @param completed Whether the mapper finished the walk. Only completed audits count on either side.
   * @return          The new audit_task_id.
   */
  protected def audit(
      streetEdgeId: Int,
      userId: String,
      taskEnd: OffsetDateTime = now,
      outdated: Boolean = false,
      completed: Boolean = true
  ): DBIO[Int] = for {
    auditTaskId <- auditTaskTableForFixtures.insert(
      AuditTask(0, None, userId, streetEdgeId, taskEnd.minusHours(1), taskEnd, completed, 0.0, 0.0,
        startPointReversed = false, None, None, lowQuality = false, incomplete = false, stale = false,
        auditedDistanceM = None)
    )
    _ <- setOutdatedFlag(auditTaskId, outdated)
  } yield auditTaskId

  /**
   * An audit the mapper walked partway and left open, of the shape the next-street chooser may pick up again (#5370).
   *
   * Separate from [[audit]] because what distinguishes an abandoned walk is exactly the state [[audit]] leaves at its
   * defaults: an open row carrying where the mapper stopped, which end they started from, and how far they got.
   *
   * @param currentLat         Where the mapper stopped; [[insertStreet]]'s streets run along the equator.
   * @param currentLng         Likewise -- the fraction of a degree here is the fraction of the street walked.
   * @param reversed           Whether they walked the street from (x2, y2), which fixes the direction for the resume.
   * @param auditedDistanceM   Metres recorded on the row. Only the client reads it; the queries key on the position.
   * @param startOffsetM       Set only for a free-exploration drop-in (#4451), which is never resumed as a region task.
   * @param taskStart          When the walk began, which bounds the no-imagery reports that disqualify it (#4922).
   * @return                   The new audit_task_id.
   */
  protected def abandonedAudit(
      streetEdgeId: Int,
      userId: String,
      currentLat: Double = 0.0,
      currentLng: Double = 0.0,
      reversed: Boolean = false,
      auditedDistanceM: Option[Double] = None,
      startOffsetM: Option[Double] = None,
      taskStart: OffsetDateTime = now.minusHours(1),
      currentMissionId: Option[Int] = None
  ): DBIO[Int] =
    auditTaskTableForFixtures.insert(
      AuditTask(0, None, userId, streetEdgeId, taskStart, taskStart, completed = false, currentLat, currentLng,
        startPointReversed = reversed, currentMissionId, None, lowQuality = false, incomplete = false, stale = false,
        auditedDistanceM = auditedDistanceM, startOffsetM = startOffsetM)
    )

  /** An audit mission for the mapper, for the cases that assert on what a resumed task carries back. */
  protected def insertAuditMission(userId: String, regionId: Int): DBIO[Int] =
    sql"""INSERT INTO mission
              (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped, region_id)
          VALUES ('audit', $userId, now(), now(), FALSE, 0, FALSE, FALSE, $regionId)
          RETURNING mission_id""".as[Int].head

  /**
   * Records where on the street the task's current mission began.
   *
   * Written as SQL rather than through the case class so the point carries SRID 4326, which is what the column's
   * constraint and every consumer expect.
   *
   * @return The number of rows written.
   */
  protected def setTaskMissionStart(auditTaskId: Int, lat: Double, lng: Double): DBIO[Int] =
    sqlu"""UPDATE audit_task SET current_mission_start = ST_SetSRID(ST_MakePoint($lng, $lat), 4326)
           WHERE audit_task_id = $auditTaskId"""

  /**
   * A mapper's report that a street had no imagery, which is what leaves their task incomplete for good (#4922).
   *
   * @param timestamp When it was filed. Only a report at or after the task's own start disqualifies that task.
   * @return          The number of rows written.
   */
  protected def reportNoImagery(streetEdgeId: Int, userId: String, timestamp: OffsetDateTime = now): DBIO[Int] =
    sqlu"""INSERT INTO street_edge_issue (street_edge_issue_id, street_edge_id, issue, user_id, ip_address, timestamp)
           VALUES ((SELECT COALESCE(MAX(street_edge_issue_id), 0) + 1 FROM street_edge_issue),
                   $streetEdgeId, CAST('PanoNotAvailable' AS street_edge_issue_type), $userId, '0.0.0.0', $timestamp)"""

  /** Flips one audit's imagery-freshness flag, the way the nightly sync does. */
  protected def setOutdatedFlag(auditTaskId: Int, outdated: Boolean): DBIO[Int] =
    auditTasksForFixtures.filter(_.auditTaskId === auditTaskId).map(_.outdatedImagery).update(outdated)
}
