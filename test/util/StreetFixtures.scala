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

  /** A throwaway mapper, with no rows anywhere else, so their street set is exactly what a case seeds. */
  protected def insertUser(): DBIO[String] = {
    val userId = UUID.randomUUID.toString
    (sidewalkUsersForFixtures += SidewalkUser(userId, s"spec-$userId", s"spec-$userId@example.com")).map(_ => userId)
  }

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
   * @param regionId The region to hang it in. `None` leaves it out of every region, which is all a spec needs when
   *                 the query under test doesn't join one.
   * @param status   What makes a street auditable at all: only `open` streets are handed out.
   */
  protected def insertStreet(regionId: Option[Int] = None, status: String = "open"): DBIO[Int] = for {
    streetEdgeId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                          VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                                  ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(1, 0)), 4326),
                                  0, 0, 1, 0, 'residential', CAST($status AS street_edge_status))
                          RETURNING street_edge_id""".as[Int].head
    _ <- regionId.map(putInRegion(streetEdgeId, _)).getOrElse(DBIO.successful(0))
  } yield streetEdgeId

  /** Seeds `n` streets in one region, returned in ascending id order. */
  protected def insertStreets(regionId: Int, n: Int): DBIO[Seq[Int]] =
    DBIO.sequence((1 to n).map(_ => insertStreet(Some(regionId)))).map(_.sorted.toSeq)

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

  /** Flips one audit's imagery-freshness flag, the way the nightly sync does. */
  protected def setOutdatedFlag(auditTaskId: Int, outdated: Boolean): DBIO[Int] =
    auditTasksForFixtures.filter(_.auditTaskId === auditTaskId).map(_.outdatedImagery).update(outdated)
}
