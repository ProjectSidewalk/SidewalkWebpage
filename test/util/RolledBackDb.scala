package util

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Failure, Success, Try}

/**
 * DB access helpers for the specs that exercise real queries against the connected Postgres+PostGIS database (#4384).
 *
 * The important piece is [[runRolledBack]], which runs a test body inside a transaction that is always rolled back, so
 * a spec can insert audits, flip flags, and rewrite street_imagery rows without leaving the shared dev DB altered.
 * That matters because several of these queries (e.g. the imagery-freshness set-pass) operate on whole tables rather
 * than just a spec's synthetic rows.
 *
 * Mix into a `PlaySpec with GuiceOneAppPerSuite`. Specs are expected to disable `modules.ActorModule` in their
 * `fakeApplication()` so the real nightly jobs can't race the assertions.
 */
trait RolledBackDb { this: GuiceOneAppPerSuite =>

  /** How long to wait on a single action. Generous, since these boot the app and hit PostGIS. */
  protected def dbTimeout: FiniteDuration = 120.seconds

  implicit protected lazy val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]

  // Kept as a stable val with `.db.run` called inline; binding `.db` to its own val would infer a path-dependent
  // existential type that needs -language:existentials.
  protected lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Runs an action against the connected DB and blocks for the result. */
  protected def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), dbTimeout)

  /** The active city schema (first search_path entry) — what the service layer passes for the own-city arm. */
  protected def currentSchema: DBIO[String] = sql"SELECT current_schema()".as[String].head

  /** Sentinel used to abort (and thus roll back) the wrapping transaction after the test body has run. */
  private object RollbackSentinel extends RuntimeException("intentional rollback -- leave the DB untouched")

  /**
   * Runs a test body (a composed DBIO) inside a transaction that is always rolled back.
   *
   * The body's result is captured before the sentinel failure aborts the transaction, so assertions can run either
   * inside the DBIO (a failed assertion propagates instead of the sentinel) or on the returned value.
   */
  protected def runRolledBack[T](action: DBIO[T]): T = {
    var result: Option[T] = None
    val tx                = action.flatMap { r => result = Some(r); DBIO.failed(RollbackSentinel) }.transactionally
    Try(run(tx)) match {
      case Failure(RollbackSentinel) => result.get
      case Failure(other)            => throw other
      case Success(_)                => throw new IllegalStateException("rollback sentinel did not propagate")
    }
  }
}
