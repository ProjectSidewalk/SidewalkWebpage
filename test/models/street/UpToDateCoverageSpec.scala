package models.street

import models.audit.AuditTaskTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Failure, Success, Try}

/**
 * DB-backed tests pinning the upToDateOnly coverage queries behind the admin Overview's re-audit numbers (#4384):
 * flagging every completed audit on a street as outdated_imagery must drop it from up-to-date coverage (count and
 * distance) while leaving the ever-audited totals — and therefore Overview's `ever − upToDate` arithmetic — intact.
 *
 * Every mutating case runs inside a deliberately rolled-back transaction (runRolledBack), leaving the connected DB
 * untouched. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI);
 * cases cancel gracefully when the connected DB lacks the rows they need. Scheduling actors are disabled so nightly
 * jobs can't race the tests.
 */
class UpToDateCoverageSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  private val streetEdgeTable               = app.injector.instanceOf[StreetEdgeTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  private val auditTasks = TableQuery[AuditTaskTableDef]

  /** Sentinel used to abort (and thus roll back) the wrapping transaction after the test body has run. */
  private object RollbackSentinel extends RuntimeException("intentional rollback -- leave the DB untouched")

  /** Runs a test body inside a transaction that is always rolled back; see OutdatedImageryFlagSyncSpec. */
  private def runRolledBack[T](action: DBIO[T]): T = {
    var result: Option[T] = None
    val tx                = action.flatMap { r => result = Some(r); DBIO.failed(RollbackSentinel) }.transactionally
    Try(run(tx)) match {
      case Failure(RollbackSentinel) => result.get
      case Failure(other)            => throw other
      case Success(_)                => throw new IllegalStateException("rollback sentinel did not propagate")
    }
  }

  /** A street that currently counts toward coverage: a completed audit by a non-excluded user on an open street. */
  private lazy val countedStreetId: Option[Int] =
    run(streetEdgeTable.completedAuditTasks.map(_.streetEdgeId).result.headOption)

  "countDistinctAuditedStreets / auditedStreetDistance with upToDateOnly" should {
    "drop a fully-flagged street from up-to-date coverage while ever-audited coverage keeps it" in {
      assume(countedStreetId.isDefined)
      val streetId = countedStreetId.get

      val (beforeCountU, beforeCountE, beforeDistU, beforeDistE, afterCountU, afterCountE, afterDistU, afterDistE) =
        runRolledBack(
          for {
            beforeCountU <- streetEdgeTable.countDistinctAuditedStreets(upToDateOnly = true)
            beforeCountE <- streetEdgeTable.countDistinctAuditedStreets()
            beforeDistU  <- streetEdgeTable.auditedStreetDistance(upToDateOnly = true)
            beforeDistE  <- streetEdgeTable.auditedStreetDistance()
            // Flag every completed audit on the street, so no up-to-date audit remains to keep it covered.
            _ <- auditTasks
              .filter(t => t.streetEdgeId === streetId && t.completed)
              .map(_.outdatedImagery)
              .update(true)
            afterCountU <- streetEdgeTable.countDistinctAuditedStreets(upToDateOnly = true)
            afterCountE <- streetEdgeTable.countDistinctAuditedStreets()
            afterDistU  <- streetEdgeTable.auditedStreetDistance(upToDateOnly = true)
            afterDistE  <- streetEdgeTable.auditedStreetDistance()
          } yield (beforeCountU, beforeCountE, beforeDistU, beforeDistE, afterCountU, afterCountE, afterDistU,
            afterDistE)
        )

      afterCountU mustBe beforeCountU - 1
      afterCountE mustBe beforeCountE
      // The street's length leaves the up-to-date distance; the ever-audited distance is untouched.
      afterDistU must be < beforeDistU
      afterDistE mustBe beforeDistE +- 1e-6
      // Overview's derived needs-re-audit numbers (ever − upToDate) both grow by exactly this street.
      (afterCountE - afterCountU) mustBe (beforeCountE - beforeCountU) + 1
    }
  }
}
