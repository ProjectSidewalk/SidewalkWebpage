package models.audit

import models.mission.MissionTableDef
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import java.time.OffsetDateTime

/**
 * DB-backed tests for AuditTaskInteractionTable.insertMultiple's chunked insert and small-table copy (#5718). Runs
 * rolled back; cancels when the DB has no audit task or mission for the rows' foreign keys.
 */
class AuditTaskInteractionInsertSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val interactionTable  = app.injector.instanceOf[AuditTaskInteractionTable]
  private val interactions      = TableQuery[AuditTaskInteractionTableDef]
  private val interactionsSmall = TableQuery[AuditTaskInteractionSmallTableDef]

  private lazy val someTaskId: Option[Int]    = run(TableQuery[AuditTaskTableDef].map(_.auditTaskId).result.headOption)
  private lazy val someMissionId: Option[Int] = run(TableQuery[MissionTableDef].map(_.missionId).result.headOption)

  // A note unique to this run, so counts only see this spec's rows.
  private val marker: String = s"5718-spec-${System.nanoTime}"

  private def rows(n: Int, action: Int => String): Seq[AuditTaskInteraction] =
    (0 until n).map { i =>
      AuditTaskInteraction(0, someTaskId.get, someMissionId.get, action(i), None, None, None, None, None, None,
        Some(marker), None, OffsetDateTime.now)
    }

  private def countMain: DBIO[Int]  = interactions.filter(_.note === marker).length.result
  private def countSmall: DBIO[Int] = interactionsSmall.filter(_.note === marker).length.result

  "insertMultiple" should {
    "save every row across a chunk boundary and copy only the small-table actions" in {
      assume(someTaskId.isDefined && someMissionId.isDefined)
      // One past the 1,000-row chunk size, so the insert takes two statements.
      val batch = rows(1001, i => if (i % 3 == 0) "ViewControl_MouseDown" else "LowLevelEvent_mousemove")

      val (main, small) = runRolledBack(for {
        _     <- interactionTable.insertMultiple(batch)
        main  <- countMain
        small <- countSmall
      } yield (main, small))

      main mustBe 1001
      small mustBe batch.count(_.action == "ViewControl_MouseDown")
    }

    "copy each small-table row under its own new id" in {
      assume(someTaskId.isDefined && someMissionId.isDefined)
      val batch = rows(5, i => if (i % 2 == 0) "LabelingCanvas_MouseDown" else "LowLevelEvent_mousemove")

      val mismatched = runRolledBack(for {
        _          <- interactionTable.insertMultiple(batch)
        mismatched <- interactionsSmall
          .filter(_.note === marker)
          .join(interactions)
          .on(_.auditTaskInteractionId === _.auditTaskInteractionId)
          .filter { case (small, main) => small.action =!= main.action }
          .length
          .result
      } yield mismatched)

      mismatched mustBe 0
    }

    "do nothing for an empty batch" in {
      assume(someTaskId.isDefined && someMissionId.isDefined)
      runRolledBack(interactionTable.insertMultiple(Seq.empty).andThen(countMain)) mustBe 0
    }
  }
}
