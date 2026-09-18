package models.audit

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

/**
 * DB-backed tests pinning the `needsReaudit` flag on the Explore task payload (#4895): a street whose every completed
 * audit has been flagged as predating newer imagery is reported as a re-audit, while a never-audited street and a
 * street with a fresh audit are not -- and `completedByAnyUser` keeps its up-to-date-only meaning alongside it, so
 * the two together separate "first pass", "refresh" and "already covered".
 *
 * Both region-scoped queries are covered: `selectTasksInARegion` feeds `TaskContainer.nextTask` mid-session and
 * `selectANewTaskInARegion` is the page-load pick, and the toast has to fire the same way from either.
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
}
