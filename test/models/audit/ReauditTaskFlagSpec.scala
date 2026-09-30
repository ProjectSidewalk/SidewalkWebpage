package models.audit

import models.route.{Route, RouteStreet, RouteStreetTableDef, RouteTableDef, UserRoute, UserRouteTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests pinning the `needsReaudit` flag on the Explore task payload (#4895): a street whose every completed
 * audit has been flagged as predating newer imagery is reported as a re-audit, while a never-audited street and a
 * street with a fresh audit are not -- and `completedByAnyUser` keeps its up-to-date-only meaning alongside it, so
 * the two together separate "first pass", "refresh" and "already covered".
 *
 * The same rows carry what the notice actually says: `mappedByThisUser`, which chooses "you mapped this street" over
 * "someone mapped this street", and the two dates it quotes. `lastMappedAt` is deliberately not one date -- it is the
 * labeler's own last audit when they mapped it and the street's most recent otherwise, because each wording is only
 * true of its own date.
 *
 * Every builder that can hand out a re-audit street is covered, since the toast has to fire the same way from all of
 * them: `selectTasksInARegion` feeds `TaskContainer.nextTask` mid-session, `selectANewTaskInARegion` is the page-load
 * pick, `selectANewTask` is the `?streetEdgeId=` drop-in, `selectTaskFromTaskId` is the resume path, and
 * `selectTasksInRoute` is route walking -- which derives its user from `user_route` rather than a parameter.
 *
 * Every case builds its own world with [[StreetFixtures]] inside a deliberately rolled-back transaction
 * (runRolledBack). Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in
 * dev/CI). Scheduling actors are disabled so nightly jobs can't race the tests.
 */
class ReauditTaskFlagSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  /** A mission id to pass through; nothing is inserted against it, so any value does. */
  private val SomeMissionId = 1

  private def taskFor(tasks: Seq[NewTask], streetEdgeId: Int): NewTask =
    tasks.find(_.edgeId == streetEdgeId).getOrElse(fail(s"street $streetEdgeId missing from the region's task list"))

  /** Records the imagery capture date the nightly poll would have written, the way StreetReauditSummarySpec does. */
  private def setImagery(streetEdgeId: Int, medianNewestCapture: LocalDate): DBIO[Int] =
    sqlu"""INSERT INTO street_imagery
               (street_edge_id, oldest_capture, newest_capture, median_newest_capture, n_panos, data_source,
                updated_at)
           VALUES ($streetEdgeId, $medianNewestCapture, $medianNewestCapture, $medianNewestCapture, 1,
                   'imagery_poll', now())
           ON CONFLICT (street_edge_id) DO UPDATE SET median_newest_capture = EXCLUDED.median_newest_capture"""

  /** A one-street route, walked by `userId`, returning its user_route_id. */
  private def routeWalkedBy(userId: String, regionId: Int, streetEdgeId: Int): DBIO[Int] = {
    val routes       = TableQuery[RouteTableDef]
    val routeStreets = TableQuery[RouteStreetTableDef]
    val userRoutes   = TableQuery[UserRouteTableDef]
    for {
      routeId <- (routes returning routes.map(_.routeId)) += Route(
        0,
        userId,
        regionId,
        "reaudit spec",
        s"reaudit-spec-$streetEdgeId",
        None,
        public = true,
        deleted = false,
        OffsetDateTime.now,
        0d,
        1
      )
      _           <- routeStreets += RouteStreet(0, routeId, streetEdgeId, reverse = false, 0)
      userRouteId <- (userRoutes returning userRoutes.map(_.userRouteId)) +=
        UserRoute(0, routeId, userId, completed = false, discarded = false)
    } yield userRouteId
  }

  "selectTasksInARegion" should {
    "flag only the street whose completed audits all predate newer imagery" in {
      val (never, flagged, fresh, mixed, tasks) = runRolledBack(for {
        mapper   <- insertUser()
        other    <- insertUser()
        regionId <- insertRegion()
        streets  <- insertStreets(regionId, 4, withPriority = true)
        (never, flagged, fresh, mixed) = (streets(0), streets(1), streets(2), streets(3))
        _     <- audit(flagged, other, outdated = true)
        _     <- audit(flagged, other, outdated = true)
        _     <- audit(fresh, other)
        _     <- audit(mixed, other, outdated = true)
        _     <- audit(mixed, other)
        tasks <- auditTaskTable.selectTasksInARegion(regionId, mapper)
      } yield (never, flagged, fresh, mixed, tasks))

      taskFor(tasks, never).needsReaudit mustBe false
      taskFor(tasks, never).completedByAnyUser mustBe false
      taskFor(tasks, flagged).needsReaudit mustBe true
      taskFor(tasks, flagged).completedByAnyUser mustBe false
      taskFor(tasks, fresh).needsReaudit mustBe false
      taskFor(tasks, fresh).completedByAnyUser mustBe true
      // One up-to-date audit is enough to take a street off the re-audit list, however many flagged ones sit beside it.
      taskFor(tasks, mixed).needsReaudit mustBe false
      taskFor(tasks, mixed).completedByAnyUser mustBe true
      // Every audit above was walked by `other`, so none of these is the mapper's own work to be told about.
      tasks.filter(t => Seq(never, flagged, fresh, mixed).contains(t.edgeId)).foreach(_.mappedByThisUser mustBe false)
    }

    "flag the mapper's own street once its only audit is outdated" in {
      // The case the toast exists for: the labeler who mapped the street is handed it again, and needs to hear why.
      val (streetEdgeId, tasks) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, outdated = true)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, mapper)
      } yield (streetEdgeId, tasks))

      val task = taskFor(tasks, streetEdgeId)
      task.needsReaudit mustBe true
      task.completed mustBe false
      // Their own earlier pass, so the notice says "you mapped this street" rather than attributing it to a stranger.
      task.mappedByThisUser mustBe true
    }

    "quote the labeler's own last audit when they mapped it, and the street's otherwise" in {
      // The whole reason lastMappedAt is resolved per user: "You mapped this street in January 2024" would be a
      // false sentence here, because the labeler's own pass was the June before somebody else's.
      val Mine                                  = OffsetDateTime.parse("2023-06-10T12:00:00Z")
      val Theirs                                = OffsetDateTime.parse("2024-01-15T12:00:00Z")
      val Captured                              = LocalDate.parse("2025-03-01")
      val (streetEdgeId, mineTasks, theirTasks) = runRolledBack(for {
        mapper       <- insertUser()
        other        <- insertUser()
        bystander    <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, taskEnd = Mine, outdated = true)
        _            <- audit(streetEdgeId, other, taskEnd = Theirs, outdated = true)
        _            <- setImagery(streetEdgeId, Captured)
        mineTasks    <- auditTaskTable.selectTasksInARegion(regionId, mapper)
        theirTasks   <- auditTaskTable.selectTasksInARegion(regionId, bystander)
      } yield (streetEdgeId, mineTasks, theirTasks))

      val mine = taskFor(mineTasks, streetEdgeId)
      mine.mappedByThisUser mustBe true
      mine.lastMappedAt.map(_.toInstant) mustBe Some(Mine.toInstant)
      mine.newImageryDate mustBe Some(Captured)

      // A labeler who never walked it hears the street's most recent pass instead, whoever made it.
      val theirs = taskFor(theirTasks, streetEdgeId)
      theirs.mappedByThisUser mustBe false
      theirs.lastMappedAt.map(_.toInstant) mustBe Some(Theirs.toInstant)
      theirs.newImageryDate mustBe Some(Captured)
    }

    "leave both dates empty on a street whose imagery has never been polled" in {
      // The dateless wording exists for this: half a comparison reads worse than none.
      val (streetEdgeId, tasks) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, outdated = true)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, mapper)
      } yield (streetEdgeId, tasks))

      taskFor(tasks, streetEdgeId).newImageryDate mustBe None
      taskFor(tasks, streetEdgeId).lastMappedAt mustBe defined // The audit happened; only the imagery date is missing.
    }

    "not count an unfinished walk as a prior audit" in {
      val (streetEdgeId, tasks) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, outdated = true, completed = false)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, mapper)
      } yield (streetEdgeId, tasks))

      taskFor(tasks, streetEdgeId).needsReaudit mustBe false
    }
  }

  "selectANewTaskInARegion" should {
    "hand back a re-audit street flagged as such" in {
      val (streetEdgeId, picked) = runRolledBack(for {
        mapper       <- insertUser()
        other        <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, other, outdated = true)
        picked       <- auditTaskTable.selectANewTaskInARegion(regionId, mapper, SomeMissionId)
      } yield (streetEdgeId, picked))

      picked.map(_.edgeId) mustBe Some(streetEdgeId)
      picked.map(_.needsReaudit) mustBe Some(true)
    }

    "hand back a never-audited street unflagged" in {
      val (streetEdgeId, picked) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        picked       <- auditTaskTable.selectANewTaskInARegion(regionId, mapper, SomeMissionId)
      } yield (streetEdgeId, picked))

      picked.map(_.edgeId) mustBe Some(streetEdgeId)
      picked.map(_.needsReaudit) mustBe Some(false)
    }
  }

  "selectANewTask" should {
    "flag the street a ?streetEdgeId= drop-in lands on" in {
      val (streetEdgeId, task) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, outdated = true)
        task         <- auditTaskTable.selectANewTask(streetEdgeId, mapper, SomeMissionId)
      } yield (streetEdgeId, task))

      task.edgeId mustBe streetEdgeId
      task.needsReaudit mustBe true
      task.mappedByThisUser mustBe true
    }
  }

  "selectTaskFromTaskId" should {
    "keep the flags on a resumed task" in {
      // The page-load resume path. The open row is the one being resumed; the completed outdated one beside it is
      // what makes the street a re-audit, and it is the mapper's own.
      val (streetEdgeId, task) = runRolledBack(for {
        mapper       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- audit(streetEdgeId, mapper, outdated = true)
        openTaskId   <- audit(streetEdgeId, mapper, completed = false)
        task         <- auditTaskTable.selectTaskFromTaskId(openTaskId, mapper)
      } yield (streetEdgeId, task))

      task.map(_.edgeId) mustBe Some(streetEdgeId)
      task.map(_.needsReaudit) mustBe Some(true)
      task.map(_.mappedByThisUser) mustBe Some(true)
    }
  }

  "selectTasksInRoute" should {
    "attribute the earlier pass to the walk's own owner, not to whoever asked" in {
      // This builder takes no userId -- its endpoint is unauthenticated -- so it reads the owner off user_route. If
      // that derivation broke, both cases below would read the same, which is what these two assertions rule out.
      val (mine, theirs) = runRolledBack(for {
        mapper   <- insertUser()
        other    <- insertUser()
        regionId <- insertRegion()
        streets  <- insertStreets(regionId, 2, withPriority = true)
        (ownStreet, otherStreet) = (streets(0), streets(1))
        _         <- audit(ownStreet, mapper, outdated = true)
        _         <- audit(otherStreet, other, outdated = true)
        ownWalk   <- routeWalkedBy(mapper, regionId, ownStreet)
        otherWalk <- routeWalkedBy(mapper, regionId, otherStreet)
        mine      <- auditTaskTable.selectTasksInRoute(ownWalk)
        theirs    <- auditTaskTable.selectTasksInRoute(otherWalk)
      } yield (mine, theirs))

      mine.map(_.needsReaudit) mustBe Seq(true)
      mine.map(_.mappedByThisUser) mustBe Seq(true)

      theirs.map(_.needsReaudit) mustBe Seq(true)
      theirs.map(_.mappedByThisUser) mustBe Seq(false)
    }

    "hand back nothing for a user_route that does not exist" in {
      runRolledBack(auditTaskTable.selectTasksInRoute(-1)) mustBe empty
    }
  }
}
