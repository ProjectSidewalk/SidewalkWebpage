package service

import models.utils.{HealthTable, MyPostgresProfile}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * DB-backed safety tests for the Owner-only Health dashboard's data source (#4561).
 *
 * The dashboard polls these Postgres catalog queries every ~20s from every open Owner tab, so its single most
 * important property is that it never becomes the load problem it exists to surface. Two things are checked:
 *
 *  1. Every catalog query actually executes against a real Postgres+PostGIS instance (a `GetResult` column-order slip
 *     or a bad cast throws here — `HealthService` swallows per-section failures for graceful degradation, so the
 *     query-shape check has to run at the DAO layer, below that recovery).
 *  2. A burst of concurrent `getDbHealth` calls stays within the connection pool. A regression to a per-schema
 *     evolution fan-out (one query per city schema) would demand ~one-connection-per-schema per call and, on a
 *     many-city database, exhaust the 25-slot pool with a `RejectedExecutionException` (#4559). The single-query
 *     fan-out plus caching keeps every call within budget.
 *
 * Read-only. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 * Scheduling actors are disabled so background actors can't contend for the pool during the run.
 */
class HealthServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val healthService = app.injector.instanceOf[HealthService]
  private val healthTable   = app.injector.instanceOf[HealthTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def await[T](f: Future[T], d: Duration = 60.seconds): T = Await.result(f, d)
  private def run[T](action: DBIO[T]): T                          = Await.result(dbConfig.db.run(action), 60.seconds)

  "HealthTable catalog queries" should {
    // Each of these asserts the SQL executes and maps into its DTO against a real PostGIS DB; the result may legitimately
    // be empty (a healthy DB has no blocking locks), so the value is that `run` completes without throwing.
    "run getBlockingSessions without error" in {
      run(healthTable.getBlockingSessions).size must be >= 0
    }
    "run getIdleInTransactionSessions without error" in {
      run(healthTable.getIdleInTransactionSessions).size must be >= 0
    }
    "run getTableBloat without error" in {
      run(healthTable.getTableBloat).size must be >= 0
    }
    "run getPanoBackupStats without error" in {
      run(healthTable.getPanoBackupStats).labeledPanos must be >= 0L
    }
    "report the connecting database and role via getDbEnvInfo" in {
      val env = run(healthTable.getDbEnvInfo)
      env.database must not be empty
      env.role must not be empty
    }
    "report at least one client backend via getConnectionCounts (its own)" in {
      // The query that produces this census is itself a client backend, so the total is never zero.
      run(healthTable.getConnectionCounts).map(_.count).sum must be > 0
    }
    "read every schema's play_evolutions in one union query" in {
      val schemas = run(healthTable.getEvolutionSchemas).filter(_.matches("^[A-Za-z0-9_]+$"))
      assume(schemas.nonEmpty, "connected DB has no play_evolutions schemas to test against")
      // The single UNION-ALL query must execute across all discovered schemas at once (the fan-out safety property).
      run(healthTable.getStuckEvolutionsForSchemas(schemas)).size must be >= 0
    }
  }

  "HealthService.getDbHealth" should {
    "assemble a payload with sane, self-consistent thresholds" in {
      val data = await(healthService.getDbHealth)
      data.generatedAt must not be empty
      data.currentDatabase must not be empty
      data.currentRole must not be empty

      val t = data.thresholds
      t.connPoolMax must be > 0
      t.idleTxnBadSeconds must be >= t.idleTxnWarnSeconds
      t.lockWaitBadSeconds must be >= t.lockWaitWarnSeconds
      t.bloatBadRatio must be >= t.bloatWarnRatio
    }

    "survive a burst of concurrent polls without exhausting the connection pool" in {
      // Simulate many Owner tabs polling at once, from a cold cache (the worst case). If getDbHealth fanned out one
      // query per city schema, 30 concurrent calls would each demand ~one-connection-per-schema and, on a many-city
      // DB, blow the 25-slot pool; the single-query fan-out + caching keeps every call within budget. (On a
      // single-schema test DB this proves general concurrency-safety; the fan-out regression bites hardest on a
      // realistic multi-city DB, where this same test would fail pre-fix.)
      val results = await(Future.sequence((1 to 30).map(_ => healthService.getDbHealth)), 90.seconds)
      results must have size 30
      results.foreach(_.thresholds.connPoolMax must be > 0)
    }
  }
}
