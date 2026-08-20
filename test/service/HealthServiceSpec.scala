package service

import models.utils.{HealthTable, MyPostgresProfile}
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.io.File
import java.nio.file.Files
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
class HealthServiceSpec extends PlaySpec with GuiceOneAppPerSuite with BeforeAndAfterAll {

  // The scan compares database rows against files on disk, so a checkout that has never had an upload has no
  // directory to read and the whole panel degrades to "unavailable" — under which every assertion below would pass
  // without testing anything. Pointing the app at a directory this spec owns makes the interesting path the only one.
  private val mediaDir: File = Files.createTempDirectory("health-service-spec-media").toFile

  /** The subdirectory `StoryService` would write this instance's uploads into: named for `city-id`, not the schema. */
  private lazy val cityDir: File = new File(mediaDir, config.get[String]("city-id"))

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure("story.media.directory" -> mediaDir.getAbsolutePath)
      .build()

  private val healthService = app.injector.instanceOf[HealthService]
  private val healthTable   = app.injector.instanceOf[HealthTable]
  private val config        = app.injector.instanceOf[play.api.Configuration]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def await[T](f: Future[T], d: Duration = 60.seconds): T = Await.result(f, d)
  private def run[T](action: DBIO[T]): T                          = Await.result(dbConfig.db.run(action), 60.seconds)

  // A file with no `story_media` row behind it. Whether the scan attributes it to this instance's own schema is the
  // whole question: it can only do that by naming the directory the way the write path does.
  private val orphanId: Int         = Int.MaxValue - 4926
  private lazy val orphanFile: File = new File(cityDir, s"story_$orphanId.jpg")

  // Seeded before any test, because the scan is cached: a first call made against an empty directory would answer
  // every later assertion from that cached all-clear.
  override def beforeAll(): Unit = {
    super.beforeAll()
    val _ = cityDir.mkdirs()
    val _ = orphanFile.createNewFile()
  }

  override def afterAll(): Unit = {
    val _ = orphanFile.delete()
    val _ = cityDir.delete()
    val _ = mediaDir.delete()
    super.afterAll()
  }

  "HealthTable catalog queries" should {
    // Each of these asserts the SQL executes and maps into its DTO against a real PostGIS DB; the result may legitimately
    // be empty (a healthy DB has no blocking locks), so the value is that `run` completes without throwing.
    "run getBlockingSessions without error" in {
      noException must be thrownBy run(healthTable.getBlockingSessions)
    }
    "run getIdleInTransactionSessions without error" in {
      noException must be thrownBy run(healthTable.getIdleInTransactionSessions)
    }
    "run getActiveQueries without error" in {
      noException must be thrownBy run(healthTable.getActiveQueries(30))
    }
    "run getTableBloat without error" in {
      noException must be thrownBy run(healthTable.getTableBloat)
    }
    "run getPanoBackupStats without error" in {
      noException must be thrownBy run(healthTable.getPanoBackupStats)
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
    "count and list story_media across every schema in one union query each" in {
      // Every city schema gets the table from evolution 339, and the app under test applies evolutions on boot, so an
      // empty result means discovery is broken rather than that this database is unusual.
      val schemas = run(healthTable.getStoryMediaSchemas).filter(_.matches("^[A-Za-z0-9_]+$"))
      schemas must not be empty
      val counts = run(healthTable.getStoryMediaCounts(schemas))
      counts.map(_.schema) must contain theSameElementsAs schemas
      // The counts decide which schemas the id read covers, so a disagreement between them would make the scan
      // report rows it never fetched as missing. What each id/file pairing then *means* is pinned by
      // MediaIntegritySpec — seeding a story here would need a user, a label and an audit task, none of which the CI
      // seed has.
      run(healthTable.getStoryMediaIds(schemas)) must have size counts.map(_.rows).sum.toLong
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

    "report on every media directory the boot check guards" in {
      val media = await(healthService.getDbHealth).mediaStorage.value
      media.directories.map(_.key) mustBe modules.PersistentMediaDirCheck.persistentDirs.map(_.key)
      // Each row has to name the variable that fixes it; a path alone doesn't tell an operator what to change.
      media.directories.foreach(_.envVar must not be empty)
    }

    "keep the story-media scan's totals consistent with its per-city rows" in {
      val media = await(healthService.getDbHealth).mediaStorage.value
      // The scan reports itself unavailable when there is no media directory to read, which is the normal state of a
      // dev checkout that has never had an upload. Either way it must never report a total its rows don't support.
      media.storyMedia match {
        case None       => media.unavailable mustBe defined
        case Some(scan) =>
          scan.missing mustBe scan.cities.map(_.missing).sum
          scan.orphans mustBe scan.cities.map(_.orphans).sum
          // An unscanned city's counts stand for nothing, and the row has to say which of the several reasons put it
          // there or the operator reading it has nowhere to start.
          scan.cities.filterNot(_.scanned).foreach { city =>
            city.missing mustBe 0
            city.unscannedReason mustBe defined
          }
      }
    }

    "scan the story-media directory it was configured with" in {
      val scan = await(healthService.getDbHealth).mediaStorage.value.storyMedia.value
      scan.baseDir mustBe mediaDir.getAbsolutePath
    }

    "find this instance's own files under the directory the write path builds, not the one the schema implies" in {
      // `city-id` and the connection's schema are independent settings, and on an instance where they disagree the
      // scan has to look where StoryService writes rather than where the schema mapping says it should — resolving
      // it the other way reported a photo sitting right there as destroyed. The file seeded here has no row, so the
      // current schema's row can only account for it if the directory was resolved the write path's way.
      val scan = await(healthService.getDbHealth).mediaStorage.value.storyMedia.value
      val mine = scan.cities.find(_.schema == run(healthTable.getCurrentSchema)).value

      mine.cityId.value mustBe config.get[String]("city-id")
      mine.scanned mustBe true
      mine.orphanIds must contain(orphanId)
    }

    "claim that directory exclusively, so no other schema reads those same files as its own orphans" in {
      val scan = await(healthService.getDbHealth).mediaStorage.value

      val claimed = scan.storyMedia.value.cities.flatMap(_.cityId)
      claimed mustBe claimed.distinct
      // Every city that lost the directory has to say why, or the operator reading the row has nowhere to start.
      scan.storyMedia.value.cities.filterNot(_.scanned).foreach(_.unscannedReason mustBe defined)
    }

    "cover every schema holding a story_media table, in a stable order" in {
      // The panel is read down the page, and a scan that silently dropped a city would look exactly like a city with
      // nothing to report.
      val scan    = await(healthService.getDbHealth).mediaStorage.value.storyMedia.value
      val schemas = run(healthTable.getStoryMediaSchemas).filter(_.matches("^[A-Za-z0-9_]+$"))

      scan.cities.map(_.schema) mustBe schemas.sorted
    }

    "agree with the boot check about whether the media-directory contract is being enforced" in {
      // Two copies of the arming rule would let the page claim a stage is guarded when the check isn't watching.
      val media = await(healthService.getDbHealth).mediaStorage.value
      media.enforced mustBe modules.PersistentMediaDirCheck.arms(app.injector.instanceOf[play.api.Environment])
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
