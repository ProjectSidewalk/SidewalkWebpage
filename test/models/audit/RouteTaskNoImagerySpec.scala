package models.audit

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * DB-backed tests for the `reported_no_imagery` flag that `selectTasksInRoute` hands the Explore client (#5008).
 *
 * A street reported as having no imagery stays incomplete (#4922), so `completed` alone cannot tell the client apart
 * a street still to walk from one the labeler already bounced off. Without the flag every reload sends them back to
 * imagery that will not load, and the route's progress drops by the length of streets the tool never let them walk.
 *
 * The bound is the walk, not the street's history: a report from an earlier `user_route` is evidence for the offline
 * checker, not this walk's decision, and letting it through would mark today's route done over imagery that may since
 * have landed.
 *
 * Every fixture is seeded here rather than found in the connected database, so an empty seed cannot make a case pass
 * without exercising anything. All of it runs inside a deliberately rolled-back transaction. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class RouteTaskNoImagerySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  // Ids are assigned as MAX + 1 rather than left to the sequences: the dev dump inserts explicit ids without
  // advancing them, so nextval hands back ids that already exist.
  private def insertUser(suffix: String): DBIO[String] = {
    val id = s"5008-route-user-$suffix"
    sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
           VALUES ($id, ${s"user-$suffix-5008"}, ${s"$id@example.test"})""".map(_ => id)
  }

  private def insertRegion(): DBIO[Int] = {
    sql"""INSERT INTO region (region_id, data_source, name, geom, deleted)
          SELECT COALESCE(MAX(region_id), 0) + 1, '5008-spec', 'Route spec region',
                 ST_GeomFromText('MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))', 4326), false
          FROM region
          RETURNING region_id""".as[Int].head
  }

  private def insertStreet(regionId: Int): DBIO[Int] = {
    for {
      streetId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                        SELECT COALESCE(MAX(street_edge_id), 0) + 1,
                               ST_GeomFromText('LINESTRING(0 0, 0.001 0.001)', 4326), 0, 0, 0.001, 0.001,
                               'residential', 'open'
                        FROM street_edge
                        RETURNING street_edge_id""".as[Int].head
      _ <- sqlu"""INSERT INTO street_edge_region (street_edge_id, region_id) VALUES ($streetId, $regionId)"""
      _ <- sqlu"""INSERT INTO street_edge_priority (street_edge_id, priority) VALUES ($streetId, 1)"""
    } yield streetId
  }

  private def insertRoute(userId: String, regionId: Int, slug: String): DBIO[Int] = {
    sql"""INSERT INTO route (route_id, user_id, region_id, name, slug, public, deleted, distance_meters, street_count)
          SELECT COALESCE(MAX(route_id), 0) + 1, $userId, $regionId, '5008 spec route', $slug, false, false, 0, 0
          FROM route
          RETURNING route_id""".as[Int].head
  }

  private def insertRouteStreet(routeId: Int, streetId: Int, position: Int): DBIO[Int] = {
    sql"""INSERT INTO route_street (route_street_id, route_id, street_edge_id, reverse, position)
          SELECT COALESCE(MAX(route_street_id), 0) + 1, $routeId, $streetId, false, $position
          FROM route_street
          RETURNING route_street_id""".as[Int].head
  }

  private def insertUserRoute(routeId: Int, userId: String): DBIO[Int] = {
    sql"""INSERT INTO user_route (user_route_id, route_id, user_id, completed, discarded)
          SELECT COALESCE(MAX(user_route_id), 0) + 1, $routeId, $userId, false, false
          FROM user_route
          RETURNING user_route_id""".as[Int].head
  }

  /** Marks an audit task completed, standing in for a street the labeler walked to its end. */
  private def completeTask(taskId: Int): DBIO[Int] = {
    sqlu"""UPDATE audit_task SET completed = true WHERE audit_task_id = $taskId"""
  }

  /** An audit task on the street, started `minutesAgo` ago, linked to the user_route's route_street row. */
  private def insertTask(
      userId: String,
      streetId: Int,
      userRouteId: Int,
      routeStreetId: Int,
      minutesAgo: Int
  ): DBIO[Int] = {
    for {
      taskId <- sql"""INSERT INTO audit_task (audit_task_id, user_id, street_edge_id, task_start, task_end, completed,
                                              current_lat, current_lng)
                      SELECT COALESCE(MAX(audit_task_id), 0) + 1, $userId, $streetId,
                             now() - make_interval(mins => $minutesAgo), now(), false, 0, 0
                      FROM audit_task
                      RETURNING audit_task_id""".as[Int].head
      _ <- sqlu"""INSERT INTO audit_task_user_route (audit_task_user_route_id, user_route_id, route_street_id,
                                                     audit_task_id)
                  SELECT COALESCE(MAX(audit_task_user_route_id), 0) + 1, $userRouteId, $routeStreetId, $taskId
                  FROM audit_task_user_route"""
    } yield taskId
  }

  private def insertNoImageryReport(userId: String, streetId: Int, minutesAgo: Int): DBIO[Int] = {
    sqlu"""INSERT INTO street_edge_issue (street_edge_issue_id, street_edge_id, issue, user_id, ip_address, timestamp)
           SELECT COALESCE(MAX(street_edge_issue_id), 0) + 1, $streetId, 'PanoNotAvailable', $userId, '0.0.0.0',
                  now() - make_interval(mins => $minutesAgo)
           FROM street_edge_issue"""
  }

  "selectTasksInRoute" should {
    "flag a street the labeler reported during this walk of the route" in {
      val tasks = runRolledBack(for {
        userId      <- insertUser("during")
        regionId    <- insertRegion()
        reportedSt  <- insertStreet(regionId)
        untouchedSt <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-during")
        reportedRs  <- insertRouteStreet(routeId, reportedSt, 0)
        _           <- insertRouteStreet(routeId, untouchedSt, 1)
        userRouteId <- insertUserRoute(routeId, userId)
        // The walk starts 30 minutes ago; the report lands 10 minutes ago, inside it.
        _          <- insertTask(userId, reportedSt, userRouteId, reportedRs, minutesAgo = 30)
        _          <- insertNoImageryReport(userId, reportedSt, minutesAgo = 10)
        routeTasks <- auditTaskTable.selectTasksInRoute(userRouteId)
      } yield routeTasks)

      tasks.map(_.edgeId).distinct must have size 2
      tasks.filter(_.reportedNoImagery).map(_.edgeId).distinct must have size 1
      tasks.find(_.reportedNoImagery).value.reportedNoImagery mustBe true
    }

    "leave a street unflagged when the only report predates this walk" in {
      val tasks = runRolledBack(for {
        userId      <- insertUser("before")
        regionId    <- insertRegion()
        streetId    <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-before")
        routeStId   <- insertRouteStreet(routeId, streetId, 0)
        userRouteId <- insertUserRoute(routeId, userId)
        // The report is from an earlier walk, two hours before this one started.
        _          <- insertTask(userId, streetId, userRouteId, routeStId, minutesAgo = 30)
        _          <- insertNoImageryReport(userId, streetId, minutesAgo = 150)
        routeTasks <- auditTaskTable.selectTasksInRoute(userRouteId)
      } yield routeTasks)

      tasks.filter(_.reportedNoImagery) mustBe empty
    }

    "leave a street unflagged when someone else reported it" in {
      val tasks = runRolledBack(for {
        userId      <- insertUser("mine")
        otherUserId <- insertUser("theirs")
        regionId    <- insertRegion()
        streetId    <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-other")
        routeStId   <- insertRouteStreet(routeId, streetId, 0)
        userRouteId <- insertUserRoute(routeId, userId)
        _           <- insertTask(userId, streetId, userRouteId, routeStId, minutesAgo = 30)
        _           <- insertNoImageryReport(otherUserId, streetId, minutesAgo = 10)
        routeTasks  <- auditTaskTable.selectTasksInRoute(userRouteId)
      } yield routeTasks)

      tasks.filter(_.reportedNoImagery) mustBe empty
    }

    "flag both passes of an out-and-back street, since neither can be walked" in {
      val tasks = runRolledBack(for {
        userId      <- insertUser("outandback")
        regionId    <- insertRegion()
        streetId    <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-outandback")
        outboundRs  <- insertRouteStreet(routeId, streetId, 0)
        _           <- insertRouteStreet(routeId, streetId, 1)
        userRouteId <- insertUserRoute(routeId, userId)
        _           <- insertTask(userId, streetId, userRouteId, outboundRs, minutesAgo = 30)
        _           <- insertNoImageryReport(userId, streetId, minutesAgo = 10)
        routeTasks  <- auditTaskTable.selectTasksInRoute(userRouteId)
      } yield routeTasks)

      tasks must have size 2
      all(tasks.map(_.reportedNoImagery)) mustBe true
    }
  }

  "resumableRouteTask" should {
    "resume the street the labeler was walking, not the one they were moved off (#5008)" in {
      // The shape a reload hits mid-route: an earlier street given up on for missing imagery, and a later one
      // half-walked. Both audit_tasks are open — the give-up leaves its task unfinished on purpose (#4922) — so
      // without the exclusion the reload can land on the dead street and discard the walk underway on the live one.
      val (resumed, liveTaskId) = runRolledBack(for {
        userId      <- insertUser("resume")
        regionId    <- insertRegion()
        deadSt      <- insertStreet(regionId)
        liveSt      <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-resume")
        deadRs      <- insertRouteStreet(routeId, deadSt, 0)
        liveRs      <- insertRouteStreet(routeId, liveSt, 1)
        userRouteId <- insertUserRoute(routeId, userId)
        _           <- insertTask(userId, deadSt, userRouteId, deadRs, minutesAgo = 30)
        _           <- insertNoImageryReport(userId, deadSt, minutesAgo = 25)
        liveTask    <- insertTask(userId, liveSt, userRouteId, liveRs, minutesAgo = 20)
        resumable   <- auditTaskTable.resumableRouteTask(userRouteId)
      } yield (resumable, liveTask))

      resumed.value._1 mustBe liveTaskId
    }

    "have nothing left to resume once the only open tasks are given-up streets" in {
      // What lets the route finish rather than looping: with the walked streets done and the rest reported, the
      // resume lookup comes up empty and the caller moves on to the route's own completion path.
      val resumed = runRolledBack(for {
        userId      <- insertUser("exhausted")
        regionId    <- insertRegion()
        deadSt      <- insertStreet(regionId)
        walkedSt    <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-exhausted")
        deadRs      <- insertRouteStreet(routeId, deadSt, 0)
        walkedRs    <- insertRouteStreet(routeId, walkedSt, 1)
        userRouteId <- insertUserRoute(routeId, userId)
        _           <- insertTask(userId, deadSt, userRouteId, deadRs, minutesAgo = 30)
        _           <- insertNoImageryReport(userId, deadSt, minutesAgo = 25)
        walkedTask  <- insertTask(userId, walkedSt, userRouteId, walkedRs, minutesAgo = 20)
        _           <- completeTask(walkedTask)
        resumable   <- auditTaskTable.resumableRouteTask(userRouteId)
      } yield resumable)

      resumed mustBe None
    }

    "resume the furthest-along open task when several are open" in {
      // Route streets are walked in order, so the highest position is where the labeler actually is. The old query
      // took an arbitrary row, which made the resume point nondeterministic.
      val (resumed, furthestTaskId) = runRolledBack(for {
        userId      <- insertUser("furthest")
        regionId    <- insertRegion()
        earlySt     <- insertStreet(regionId)
        lateSt      <- insertStreet(regionId)
        routeId     <- insertRoute(userId, regionId, "5008-spec-furthest")
        earlyRs     <- insertRouteStreet(routeId, earlySt, 0)
        lateRs      <- insertRouteStreet(routeId, lateSt, 1)
        userRouteId <- insertUserRoute(routeId, userId)
        _           <- insertTask(userId, earlySt, userRouteId, earlyRs, minutesAgo = 30)
        lateTask    <- insertTask(userId, lateSt, userRouteId, lateRs, minutesAgo = 20)
        resumable   <- auditTaskTable.resumableRouteTask(userRouteId)
      } yield (resumable, lateTask))

      resumed.value._1 mustBe furthestTaskId
    }
  }
}
