package models.audit

import models.utils.MyPostgresProfile.api.{given, *}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsValue, Json}
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

import java.time.LocalDate

/**
 * DB-backed tests pinning what a labeler's own no-imagery report does to the streets a neighborhood hands them (#5017,
 * #5669): the pick passes the street over, a region down to such streets stops being assigned, the region task list
 * marks them for the client's chooser, and none of it touches anyone else or the neighborhood's completion. Also pins
 * which coverage rides back on the task list: a regular walk's own, never a free-exploration walk's from before newer
 * imagery.
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
      // The reported street outranks the other, so without the exclusion the pick would always take it.
      val (picked, other) = runRolledBack(for {
        userId   <- insertUser()
        regionId <- insertRegion()
        reported <- insertStreet(Some(regionId), withPriority = true, priority = 1.0)
        other    <- insertStreet(Some(regionId), withPriority = true, priority = 0.5)
        _        <- reportNoImagery(reported, userId, now.minusDays(30))
        picked   <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield (picked, other))

      picked.value.edgeId mustBe other
    }

    "hand a reported street back once the street has imagery newer than the report" in {
      val (picked, streetEdgeId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, userId, now.minusDays(30))
        _            <- setNewestImagery(streetEdgeId, LocalDate.now.minusDays(10))
        picked       <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield (picked, streetEdgeId))

      picked.value.edgeId mustBe streetEdgeId
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

    "leave the not-audited streets, which size missions and finish regions, alone" in {
      // The exclusion lives at the pick, not in the shared not-audited query: a reported street is not a finished one.
      val (notAudited, streetEdgeId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, userId)
        notAudited   <- auditTaskTable.getStreetEdgeIdsNotAudited(userId, regionId)
      } yield (notAudited, streetEdgeId))

      notAudited must contain(streetEdgeId)
    }
  }

  "a region down to streets the labeler reported" should {
    "have nothing left to pick, so the session moves on instead of reloading into it" in {
      val (left, exhausted, regionId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId), withPriority = true)
        _            <- reportNoImagery(streetEdgeId, userId)
        left         <- auditTaskTable.hasStreetsLeftToPick(userId, regionId)
        exhausted    <- auditTaskTable.getRegionsWithNothingLeftToPick(userId)
      } yield (left, exhausted, regionId))

      left mustBe false
      exhausted must contain(regionId)
    }

    "still have streets left while one is unreported" in {
      val (left, exhausted, regionId) = runRolledBack(for {
        userId    <- insertUser()
        regionId  <- insertRegion()
        streets   <- insertStreets(regionId, 2, withPriority = true)
        _         <- reportNoImagery(streets.head, userId)
        left      <- auditTaskTable.hasStreetsLeftToPick(userId, regionId)
        exhausted <- auditTaskTable.getRegionsWithNothingLeftToPick(userId)
      } yield (left, exhausted, regionId))

      left mustBe true
      exhausted must not contain regionId
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

    "hand a part-walked street's coverage back with it, unless the street has newer imagery since" in {
      val stored        = Json.arr(Json.arr(0d, 25.5d), Json.arr(40d, 61d))
      val (task, stale) = runRolledBack(for {
        userId      <- insertUser()
        regionId    <- insertRegion()
        streets     <- insertStreets(regionId, 2, withPriority = true)
        auditTaskId <- abandonedAudit(streets.head, userId, currentLng = 0.3)
        _           <- storeCoverage(auditTaskId, stored)
        staleTaskId <- abandonedAudit(streets(1), userId, currentLng = 0.3, taskStart = now.minusDays(30))
        _           <- storeCoverage(staleTaskId, stored)
        _           <- setNewestImagery(streets(1), LocalDate.now.minusDays(10))
        tasks       <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streets.head), taskFor(tasks, streets(1))))

      task.auditTaskId mustBe defined
      task.coveredRanges.value mustBe stored
      // Not handed back at all: its panos were the old imagery, so the street starts over as a re-audit would.
      stale.auditTaskId mustBe None
      stale.coveredRanges mustBe None
    }

    "hand a free-exploration walk's coverage back only while it postdates the street's newest imagery" in {
      // Seeding a regular task with what an older walk saw would let the first save credit a re-audit (#4384).
      val stored         = Json.arr(Json.arr(0d, 80d))
      val (fresh, stale) = runRolledBack(for {
        userId   <- insertUser()
        regionId <- insertRegion()
        streets  <- insertStreets(regionId, 2, withPriority = true)
        _        <- storeExploration(streets.head, userId, stored)
        _        <- storeExploration(streets(1), userId, stored)
        _        <- setNewestImagery(streets(1), LocalDate.now.minusDays(10))
        tasks    <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streets.head), taskFor(tasks, streets(1))))

      fresh.coveredRanges.value mustBe stored
      stale.coveredRanges mustBe None
    }
  }

  private def storeCoverage(auditTaskId: Int, stored: JsValue): DBIO[Int] =
    auditTaskTable.auditTasks.filter(_.auditTaskId === auditTaskId).map(_.coveredRanges).update(Some(stored))

  /** A free-exploration walk of the street from a month ago, as the drop-in leaves one (#5733). */
  private def storeExploration(streetEdgeId: Int, userId: String, stored: JsValue): DBIO[Int] =
    abandonedAudit(streetEdgeId, userId, startOffsetM = Some(0d), taskStart = now.minusDays(30))
      .flatMap(auditTaskId => storeCoverage(auditTaskId, stored))
}
