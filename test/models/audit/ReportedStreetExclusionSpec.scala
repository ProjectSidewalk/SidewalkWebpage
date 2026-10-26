package models.audit

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * DB-backed tests pinning what a labeler's own no-imagery report does to the streets a neighborhood hands them (#5017,
 * #5669): the server-side pick passes the street over, the region task list marks it so the client's next-street
 * chooser does too, and neither touches anyone else or the neighborhood's completion. Also pins that a regular walk's
 * stored coverage rides back on the region task list, so a reload redraws and resumes a part-walked street.
 *
 * Every case builds its own world with [[StreetFixtures]] inside a rolled-back transaction, so the assertions are
 * exact against a full dev dump and CI's near-empty schema alike. Requires a Postgres+PostGIS database.
 */
class ReportedStreetExclusionSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  /** A mission id to pass through; nothing is inserted against it, so any value does. */
  private val SomeMissionId = 1

  private def taskFor(tasks: Seq[NewTask], streetEdgeId: Int): NewTask =
    tasks.find(_.edgeId == streetEdgeId).getOrElse(fail(s"street $streetEdgeId missing from the region's task list"))

  "selectANewTaskInARegion" should {
    "pass over a street the labeler reported as having no imagery, whenever they reported it" in {
      val (picked, reported) = runRolledBack(for {
        userId   <- insertUser()
        regionId <- insertRegion()
        streets  <- insertStreets(regionId, 2, withPriority = true)
        (reported, other) = (streets.head, streets(1))
        _      <- reportNoImagery(reported, userId, now.minusDays(30))
        picked <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield (picked, reported))

      picked.value.edgeId must not be reported
    }

    "hand out nothing when the only street left is one the labeler reported" in {
      val picked = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, userId)
        picked       <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield picked)

      picked mustBe None
    }

    "still hand a street to a labeler who never reported it, whoever else did" in {
      // A report is one session's verdict (#4922): it hides the street from its reporter, not from the city.
      val (picked, streetEdgeId) = runRolledBack(for {
        userId       <- insertUser()
        otherUser    <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, otherUser)
        picked       <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield (picked, streetEdgeId))

      picked.value.edgeId mustBe streetEdgeId
    }

    "leave the labeler's finished-region count alone" in {
      // The exclusion lives at the pick, not in the shared not-audited query: a reported street is not a finished one.
      val (completedRegions, regionId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, userId)
        completed    <- auditTaskTable.getRegionsCompletedByUser(userId)
      } yield (completed, regionId))

      completedRegions must not contain regionId
    }
  }

  "selectTasksInARegion" should {
    "flag the streets this labeler reported, and only those" in {
      val (mine, theirs, untouched) = runRolledBack(for {
        userId    <- insertUser()
        otherUser <- insertUser()
        regionId  <- insertRegion()
        streets   <- insertStreets(regionId, 3, withPriority = true)
        _         <- reportNoImagery(streets.head, userId, now.minusDays(30))
        _         <- reportNoImagery(streets(1), otherUser)
        tasks     <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streets.head), taskFor(tasks, streets(1)), taskFor(tasks, streets(2))))

      mine.reportedNoImagery mustBe true
      theirs.reportedNoImagery mustBe false
      untouched.reportedNoImagery mustBe false
    }

    "hand a part-walked street's coverage back with it" in {
      val stored = Json.arr(Json.arr(0d, 25.5d), Json.arr(40d, 61d))
      val task   = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        auditTaskId  <- abandonedAudit(streetEdgeId, userId, currentLng = 0.3)
        _            <- auditTaskTable.updateTaskCoverage(auditTaskId, stored, 46.5d)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield taskFor(tasks, streetEdgeId))

      task.auditTaskId mustBe defined
      task.coveredRanges.value mustBe stored
    }
  }
}
