package models.audit

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

/**
 * DB-backed tests pinning what happens when the next-street chooser lands on a street the labeler left part-walked
 * (#5370): the open audit_task is handed back, carrying where they stopped and which end they started from, instead
 * of the street being offered again from its beginning as a brand new task.
 *
 * Both region-scoped queries are covered, because the client needs them to agree: `selectTasksInARegion` is the list
 * `TaskContainer.nextTask` picks from mid-session, and `selectANewTaskInARegion` is the server-side pick on page
 * load. A street that looks fresh in one and resumable in the other would restart the walk on a reload.
 *
 * Every case builds its own world with [[StreetFixtures]] inside a deliberately rolled-back transaction
 * (runRolledBack): its own throwaway mapper, its own region, its own streets. Nothing is read that the case did not
 * write, so the assertions are exact and mean the same thing against a full dev dump and against CI's near-empty
 * schema. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so nightly jobs can't race the tests.
 */
class ResumeAbandonedTaskSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  /** A mission id to pass through; nothing is inserted against it, so any value does. */
  private val SomeMissionId = 1

  /** Where the mapper stopped: a third of the way along a street that runs one degree east along the equator. */
  private val StoppedLat = 0.0007
  private val StoppedLng = 0.31

  private def taskFor(tasks: Seq[NewTask], streetEdgeId: Int): NewTask =
    tasks.find(_.edgeId == streetEdgeId).getOrElse(fail(s"street $streetEdgeId missing from the region's task list"))

  "resumableTasksForUser" should {
    "test its exclusions with correlated EXISTS rather than a set-membership scan" in {
      // Not style: the set-membership form ("street_edge_id NOT IN (SELECT ...)") reads the same but builds its hash
      // over every audit in the city before the outer query narrows anything. Same reasoning as hasUpToDateAudit.
      val sql = auditTaskTable.resumableTasksForUser("some-user").result.statements.head.toLowerCase

      sql must include("exists")
      sql.contains("not in (") mustBe false
    }
  }

  "selectTasksInARegion" should {
    "hand back an unfinished street with its saved position, direction, and task id" in {
      val (resumable, fresh) = runRolledBack(for {
        userId   <- insertUser()
        regionId <- insertRegion()
        streets  <- insertStreets(regionId, 2)
        (streetA, streetB) = (streets.head, streets(1))
        auditTaskId <- abandonedAudit(streetA, userId, StoppedLat, StoppedLng, reversed = true,
          auditedDistanceM = Some(71d))
        tasks <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streetA) -> auditTaskId, taskFor(tasks, streetB)))

      val (taskA, auditTaskId) = resumable
      taskA.completed mustBe false
      taskA.auditTaskId mustBe Some(auditTaskId)
      taskA.currentLat mustBe StoppedLat
      taskA.currentLng mustBe StoppedLng
      taskA.startPointReversed mustBe true

      // The untouched street is unaffected: no task to resume, and positioned at its own start point.
      fresh.completed mustBe false
      fresh.auditTaskId mustBe None
      fresh.currentLat mustBe 0d
      fresh.currentLng mustBe 0d
      fresh.startPointReversed mustBe false
    }

    "resume the newest unfinished task when a street has more than one" in {
      val (task, newerId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- abandonedAudit(streetEdgeId, userId, currentLng = 0.1)
        newerId      <- abandonedAudit(streetEdgeId, userId, currentLng = 0.6)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streetEdgeId), newerId))

      task.auditTaskId mustBe Some(newerId)
      task.currentLng mustBe 0.6
    }

    "keep a street done when the mapper has an up-to-date completed audit of it" in {
      // An admin `?streetEdgeId=` visit can leave an open row on a street that is already finished; finishing it once
      // is what counts, so the street stays completed and keeps the completed audit's id.
      val (task, completedId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        completedId  <- audit(streetEdgeId, userId)
        _            <- abandonedAudit(streetEdgeId, userId, StoppedLat, StoppedLng)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streetEdgeId), completedId))

      task.completed mustBe true
      task.auditTaskId mustBe Some(completedId)
      task.currentLng mustBe 0d
    }

    "resume the open task when the mapper's only completed audit was flagged as outdated" in {
      // The re-audit case (#4384): the flagged audit stops counting as completion, so the street re-opens -- and the
      // part-walked re-audit already under way is what should come back, not a fresh start.
      val (task, openId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true)
        openId       <- abandonedAudit(streetEdgeId, userId, StoppedLat, StoppedLng)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streetEdgeId), openId))

      task.completed mustBe false
      task.auditTaskId mustBe Some(openId)
      task.currentLng mustBe StoppedLng
    }

    "leave a street fresh when the mapper gave up on it for missing imagery" in {
      val task = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- abandonedAudit(streetEdgeId, userId, StoppedLat, StoppedLng)
        _            <- reportNoImagery(streetEdgeId, userId)
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield taskFor(tasks, streetEdgeId))

      task.auditTaskId mustBe None
      task.currentLng mustBe 0d
    }

    "still resume when the no-imagery report is someone else's or predates the task" in {
      val (otherUsersReport, staleReport) = runRolledBack(for {
        userId    <- insertUser()
        otherUser <- insertUser()
        regionId  <- insertRegion()
        streets   <- insertStreets(regionId, 2)
        (streetA, streetB) = (streets.head, streets(1))
        _     <- abandonedAudit(streetA, userId, StoppedLat, StoppedLng)
        _     <- reportNoImagery(streetA, otherUser)
        _     <- abandonedAudit(streetB, userId, StoppedLat, StoppedLng)
        _     <- reportNoImagery(streetB, userId, now.minusHours(2))
        tasks <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield (taskFor(tasks, streetA), taskFor(tasks, streetB)))

      otherUsersReport.auditTaskId mustBe defined
      staleReport.auditTaskId mustBe defined
    }

    "leave a street fresh when the only open task is a free-exploration drop-in" in {
      // A drop-in covers only the stretch from where free exploration began (#4451), so resuming it as a region task
      // would draw the un-walked stretch before it as audited.
      val task = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- abandonedAudit(streetEdgeId, userId, StoppedLat, StoppedLng, startOffsetM = Some(12.3))
        tasks        <- auditTaskTable.selectTasksInARegion(regionId, userId)
      } yield taskFor(tasks, streetEdgeId))

      task.auditTaskId mustBe None
      task.currentLng mustBe 0d
    }

    "leave a street fresh when the open task belongs to a different mapper" in {
      val (mine, theirs) = runRolledBack(for {
        userId       <- insertUser()
        otherUser    <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- abandonedAudit(streetEdgeId, otherUser, StoppedLat, StoppedLng)
        mine         <- auditTaskTable.selectTasksInARegion(regionId, userId)
        theirs       <- auditTaskTable.selectTasksInARegion(regionId, otherUser)
      } yield (taskFor(mine, streetEdgeId), taskFor(theirs, streetEdgeId)))

      mine.auditTaskId mustBe None
      mine.currentLng mustBe 0d
      theirs.auditTaskId mustBe defined
      theirs.currentLng mustBe StoppedLng
    }
  }

  "selectANewTaskInARegion" should {
    "resume the open task when the pick lands on a part-walked street" in {
      val (task, openId) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        openId       <- abandonedAudit(streetEdgeId, userId, StoppedLat, StoppedLng, reversed = true)
        task         <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield (task, openId))

      task mustBe defined
      task.get.auditTaskId mustBe Some(openId)
      task.get.currentLat mustBe StoppedLat
      task.get.currentLng mustBe StoppedLng
      task.get.startPointReversed mustBe true
      task.get.completed mustBe false
    }

    "hand out a fresh task when the street has no open task of the mapper's" in {
      val task = runRolledBack(for {
        userId   <- insertUser()
        regionId <- insertRegion()
        _        <- insertStreet(Some(regionId))
        task     <- auditTaskTable.selectANewTaskInARegion(regionId, userId, SomeMissionId)
      } yield task)

      task mustBe defined
      task.get.auditTaskId mustBe None
      task.get.currentLat mustBe 0d
      task.get.currentLng mustBe 0d
      task.get.currentMissionId mustBe Some(SomeMissionId)
    }
  }
}
