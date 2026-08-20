package service

import com.google.inject.ImplementedBy
import executors.BlockingIoExecutionContext
import models.utils.HealthTable
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._
import play.api.{Configuration, Environment, Logger}
import models.utils.MyPostgresProfile

import java.io.File
import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.duration.{Duration, DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

/** A session that currently blocks one or more other sessions from acquiring a lock. */
case class BlockingSession(
    pid: Int,
    usename: Option[String],
    applicationName: Option[String],
    state: Option[String],
    xactSeconds: Option[Long],
    stateSeconds: Option[Long],
    query: Option[String],
    blockingCount: Int,
    maxWaitSeconds: Option[Long],
    heldLocks: Option[String]
)

/** A session sitting in an open transaction while idle. */
case class IdleTxnSession(
    pid: Int,
    usename: Option[String],
    applicationName: Option[String],
    clientAddr: Option[String],
    xactSeconds: Option[Long],
    idleSeconds: Option[Long],
    query: Option[String]
)

/** A client query that has been actively executing longer than the reporting floor. */
case class ActiveQuery(
    pid: Int,
    usename: Option[String],
    applicationName: Option[String],
    querySeconds: Option[Long],
    waitEventType: Option[String],
    query: Option[String]
)

/** A `play_evolutions` row that is stuck mid-apply or carries a recorded problem, tagged with its schema. */
case class StuckEvolution(
    schema: String,
    id: Int,
    state: Option[String],
    lastProblem: Option[String],
    appliedAt: Option[String]
)

/** Dead-tuple bloat and last-vacuum age for one heavyweight table in one schema. */
case class TableBloat(
    schemaName: String,
    relName: String,
    liveTuples: Long,
    deadTuples: Long,
    deadRatio: Option[Double],
    vacuumAgeSeconds: Option[Long],
    analyzeAgeSeconds: Option[Long],
    lastVacuum: Option[String]
)

/** Client-backend connection count for one (role, state) pair. */
case class ConnCount(usename: Option[String], state: Option[String], count: Int)

/** Backup-coverage counts for the current city's labeled panos. */
case class PanoBackupStats(
    labeledPanos: Long,
    backedUp: Long,
    noBackup: Long,
    unchecked: Long,
    atRisk: Long
)

/** The connecting role's environment: database, role, and whether it can read every session's statement text. */
case class DbEnvInfo(database: String, role: String, canSeeAllQueries: Boolean)

/** How many `story_media` rows one schema holds. Internal to the media scan, not part of the dashboard payload. */
case class SchemaRowCount(schema: String, rows: Int)

/** One `story_media` id, tagged with its schema. Internal to the media scan, not part of the dashboard payload. */
case class SchemaMediaId(schema: String, storyMediaId: Int)

/**
 * One persistent media directory as this instance resolves it.
 *
 * `label` and `severity` are computed server-side so the page holds no copy of the rules that decide when a
 * directory is a problem — the same reason [[HealthThresholds]] travels in the payload.
 *
 * @param key           Config key naming the directory.
 * @param envVar        Environment variable a deployment sets it with.
 * @param irreplaceable Whether its contents are content rather than a rebuildable cache.
 * @param path          Where it resolves on this instance.
 * @param status        Machine-readable state: `ok`, `absent`, `not_writable`, `unsafe`, `unresolved`.
 * @param label         Display text for that state.
 * @param severity      Badge tone: `good`, `ok`, `warn`, `bad`.
 * @param detail        Longer explanation when there is one to give.
 */
case class MediaDirStatus(
    key: String,
    envVar: String,
    irreplaceable: Boolean,
    path: String,
    status: String,
    label: String,
    severity: String,
    detail: Option[String]
)

/**
 * One city's `story_media` rows measured against the files in its media directory.
 *
 * @param cityId     City the schema belongs to; None when this instance's config doesn't name it.
 * @param schema     Database schema the rows came from.
 * @param rows       `story_media` rows in that schema.
 * @param missing    Rows whose bytes are gone — data loss (#4925).
 * @param orphans    Files with no row — a retraction whose file delete didn't land (#4054).
 * @param missingIds     Sample of the missing ids, to start looking from.
 * @param orphanIds      Sample of the orphaned ids.
 * @param scanned        False when the directory couldn't be read, so the counts mean nothing.
 * @param unscannedReason Why it wasn't scanned, when it wasn't. The reasons differ enough — a schema no city on this
 *                       stage claims, a directory this instance writes under another schema, one it may not read —
 *                       that a single "not scanned" would send an operator looking in the wrong place.
 */
case class CityStoryMedia(
    cityId: Option[String],
    schema: String,
    rows: Int,
    missing: Int,
    orphans: Int,
    missingIds: Seq[Int],
    orphanIds: Seq[Int],
    scanned: Boolean,
    unscannedReason: Option[String]
)

/**
 * The story-media integrity scan across every city schema visible from this instance.
 *
 * @param baseDir  The resolved base directory the per-city subdirectories live under.
 * @param cities   One row per schema holding a `story_media` table, in schema order.
 * @param missing  Total rows with no file, across every scanned city.
 * @param orphans  Total files with no row, across every scanned city.
 */
case class StoryMediaIntegrity(baseDir: String, cities: Seq[CityStoryMedia], missing: Int, orphans: Int)

/**
 * The media-storage panel: where this instance keeps persistent media, and whether any of it has gone missing.
 *
 * @param directories One status per directory the boot check guards.
 * @param enforced    Whether `PersistentMediaDirCheck` arms in this run mode; false in dev, where the relative
 *                    defaults landing in the checkout is the intended behavior rather than a fault.
 * @param storyMedia  The integrity scan, or None when it couldn't run.
 * @param unavailable Why the scan couldn't run, when it didn't.
 */
case class MediaStorageHealth(
    directories: Seq[MediaDirStatus],
    enforced: Boolean,
    storyMedia: Option[StoryMediaIntegrity],
    unavailable: Option[String]
)

/**
 * Server-owned thresholds the dashboard uses to color each panel, echoed in the payload so the frontend never
 * hard-codes them (CLAUDE.md: domain values come from the backend). Seconds unless noted.
 */
case class HealthThresholds(
    idleTxnWarnSeconds: Long,
    idleTxnBadSeconds: Long,
    lockWaitWarnSeconds: Long,
    lockWaitBadSeconds: Long,
    activeQueryWarnSeconds: Long,
    activeQueryBadSeconds: Long,
    bloatWarnRatio: Double,
    bloatBadRatio: Double,
    bloatMinDeadTuples: Long,
    vacuumAgeWarnSeconds: Long,
    connPoolMax: Int,
    connWarnActive: Int,
    connBadActive: Int
)

/** The full Health dashboard payload for `/adminapi/dbHealth`. */
case class DbHealthData(
    generatedAt: String,
    currentDatabase: String,
    currentRole: String,
    canSeeAllQueries: Boolean,
    blockingSessions: Seq[BlockingSession],
    idleInTransaction: Seq[IdleTxnSession],
    activeQueries: Seq[ActiveQuery],
    stuckEvolutions: Seq[StuckEvolution],
    tableBloat: Seq[TableBloat],
    connections: Seq[ConnCount],
    panoBackups: Option[PanoBackupStats],
    mediaStorage: Option[MediaStorageHealth],
    thresholds: HealthThresholds
)

/**
 * Assembles the Owner-only Health dashboard payload (#4561) from a read-only catalog DAO.
 *
 * All output field names are snake_case (v3 output convention). Every signal degrades gracefully: a failing sub-query
 * yields an empty/absent section rather than sinking the whole page, so a partial dashboard is always better than a
 * blank one. Cross-schema evolution checks fan out over every schema's `play_evolutions`, mirroring the Across Cities
 * per-city fan-out.
 */
@ImplementedBy(classOf[HealthServiceImpl])
trait HealthService {

  /** Reads every health signal and assembles the dashboard payload. */
  def getDbHealth: Future[DbHealthData]
}

@Singleton
class HealthServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    environment: Environment,
    cacheApi: AsyncCacheApi,
    healthTable: HealthTable,
    actorSystem: ActorSystem,
    blockingIoEc: BlockingIoExecutionContext
)(implicit val ec: ExecutionContext)
    extends HealthService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  // Per-instance Slick/Hikari pool ceiling; a city role whose active backends approach it is saturated (#4559).
  private val poolMax: Int = config.getOptional[Int]("slick.dbs.default.db.maxConnections").getOrElse(25)

  // Cache each signal so that N Owner tabs polling every ~20s don't each re-run the catalog queries against the one
  // shared database — the dashboard must never itself become the connection-pressure problem it exists to surface
  // (#4559). Live signals (an active lock, connection counts) are cheap and want freshness; the cross-schema
  // evolution/bloat scans and the labeled-pano scan are heavier and change slowly, so they cache longer. Recovery
  // happens OUTSIDE the cache (see getDbHealth), so a transient query failure is never cached — the next poll retries.
  private val liveTtl: Duration = Duration(10, "seconds") // blocking locks, idle txns, connection counts
  private val slowTtl: Duration = Duration(60, "seconds") // cross-schema evolutions + table bloat
  private val panoTtl: Duration = Duration(5, "minutes")  // labeled-pano scan; changes slowly
  private val envTtl: Duration  = Duration(10, "minutes") // database/role/superuser status — constant per instance

  private val thresholds: HealthThresholds = HealthThresholds(
    idleTxnWarnSeconds = 120, // 2 min
    idleTxnBadSeconds = 600,  // 10 min
    lockWaitWarnSeconds = 10,
    lockWaitBadSeconds = 60,
    activeQueryWarnSeconds = 30, // a query running this long is worth a look; also the panel's reporting floor
    activeQueryBadSeconds = 120, // 2 min of continuous execution is almost always a problem
    bloatWarnRatio = 0.2,
    bloatBadRatio = 0.4,
    bloatMinDeadTuples = 10000,    // ignore ratios on tables with few dead tuples (stale post-restore estimates)
    vacuumAgeWarnSeconds = 604800, // 7 days
    connPoolMax = poolMax,
    connWarnActive = math.max(1, (poolMax * 0.7).toInt),
    connBadActive = math.max(1, (poolMax * 0.9).toInt)
  )

  def getDbHealth: Future[DbHealthData] = {
    val envF = cacheApi
      .getOrElseUpdate[DbEnvInfo]("health.env", envTtl)(db.run(healthTable.getDbEnvInfo))
      .recover { case e: Exception =>
        logger.warn(s"Health: failed to read db env info: ${e.getMessage}")
        DbEnvInfo("unknown", "unknown", canSeeAllQueries = false)
      }
    val blockingF = cacheApi
      .getOrElseUpdate[Seq[BlockingSession]]("health.blocking", liveTtl)(db.run(healthTable.getBlockingSessions))
      .recover(logAndEmpty("blocking sessions"))
    val idleF = cacheApi
      .getOrElseUpdate[Seq[IdleTxnSession]]("health.idle", liveTtl)(db.run(healthTable.getIdleInTransactionSessions))
      .recover(logAndEmpty("idle-in-transaction"))
    val activeF = cacheApi
      .getOrElseUpdate[Seq[ActiveQuery]]("health.active", liveTtl)(
        db.run(healthTable.getActiveQueries(thresholds.activeQueryWarnSeconds))
      )
      .recover(logAndEmpty("active queries"))
    val bloatF = cacheApi
      .getOrElseUpdate[Seq[TableBloat]]("health.bloat", slowTtl)(db.run(healthTable.getTableBloat))
      .recover(logAndEmpty("table bloat"))
    val connF = cacheApi
      .getOrElseUpdate[Seq[ConnCount]]("health.conn", liveTtl)(db.run(healthTable.getConnectionCounts))
      .recover(logAndEmpty("connection counts"))
    val panoF = cacheApi
      .getOrElseUpdate[Option[PanoBackupStats]]("health.pano", panoTtl)(
        db.run(healthTable.getPanoBackupStats).map(Option(_))
      )
      .recover { case e: Exception =>
        logger.warn(s"Health: failed to read pano backup stats: ${e.getMessage}"); None
      }
    val mediaF = getMediaStorage
    val evoF   = getStuckEvolutions

    for {
      env      <- envF
      blocking <- blockingF
      idle     <- idleF
      active   <- activeF
      evo      <- evoF
      bloat    <- bloatF
      conn     <- connF
      pano     <- panoF
      media    <- mediaF
    } yield DbHealthData(
      generatedAt = OffsetDateTime.now().toString,
      currentDatabase = env.database,
      currentRole = env.role,
      canSeeAllQueries = env.canSeeAllQueries,
      blockingSessions = blocking,
      idleInTransaction = idle,
      activeQueries = active,
      stuckEvolutions = evo,
      tableBloat = bloat,
      connections = conn,
      panoBackups = pano,
      mediaStorage = media,
      thresholds = thresholds
    )
  }

  /**
   * Collects the stuck/failed evolution rows across every city schema. Discovers the schemas that have a
   * `play_evolutions` table, then reads them all in a SINGLE union query rather than one query per schema. On prod all
   * ~50 city schemas live in one shared database, so a per-schema fan-out would demand ~50 pool connections on every
   * poll — the exact flood (#4559) this dashboard is meant to catch. Cached (`slowTtl`) so the two round-trips are rare.
   */
  private def getStuckEvolutions: Future[Seq[StuckEvolution]] = {
    cacheApi
      .getOrElseUpdate[Seq[StuckEvolution]]("health.evolutions", slowTtl) {
        db.run(healthTable.getEvolutionSchemas).flatMap { schemas =>
          // Defense in depth: names come from the catalog, but they are spliced as identifiers, so validate first.
          val valid = schemas.filter(_.matches("^[A-Za-z0-9_]+$"))
          if (valid.isEmpty) Future.successful(Seq.empty[StuckEvolution])
          else db.run(healthTable.getStuckEvolutionsForSchemas(valid))
        }
      }
      .recover { case e: Exception =>
        logger.warn(s"Health: failed to read stuck evolutions: ${e.getMessage}")
        Seq.empty[StuckEvolution]
      }
  }

  // Ceiling on `story_media` rows the scan will pull into memory. Prod holds a single-digit number today; this is a
  // guard against a future where stories take off, not a working limit. Exceeding it reports the scan as unavailable
  // rather than silently comparing a truncated set, which would invent orphans out of the rows it never fetched.
  private val maxStoryMediaRows = 200000

  // Wall-clock ceiling on the filesystem half of the scan. The directories can sit on a network mount, and a stat
  // against a dead mount never returns — the thread stays parked on the blocking pool, but the poll must not.
  private val mediaScanTimeout: FiniteDuration = 5.seconds

  // One scan at a time: `withTimeout` protects the poll from a stuck filesystem call, but only this keeps a stuck one
  // from being joined by a fresh copy every poll until the whole blocking-io pool is parked. See [[SingleFlightGate]].
  private val mediaScanGate = new SingleFlightGate

  // Schema -> city id, read from configuration alone. The database knows the schema, the directory is named for the
  // city, and nothing but this mapping joins them. ConfigService.availableCityIds would do it with one existence
  // query per city — the ~50-connection fan-out this dashboard exists to catch (#4559).
  private lazy val cityIdBySchema: Map[String, String] = config
    .get[Seq[String]]("city-params.city-ids")
    .flatMap(cityId => config.getOptional[String](s"city-params.db-schema.$cityId").map(_ -> cityId))
    .toMap

  /**
   * Where this instance keeps persistent media, and whether any `story_media` row has lost its bytes (#4926).
   *
   * The whole signal is cached at the pano TTL: it is the slowest one here (a database round trip plus a directory
   * listing per city) and the thing it detects — a deploy having deleted a directory — does not change minute to
   * minute. A failure yields None so the panel can say so, rather than sinking the rest of the dashboard.
   */
  private def getMediaStorage: Future[Option[MediaStorageHealth]] = {
    cacheApi
      .getOrElseUpdate[Option[MediaStorageHealth]]("health.media", panoTtl) {
        // A scan still running past its deadline all but always means a filesystem call that will not return.
        // Reporting that beats both starting another one on top of it and rendering a stale all-clear.
        val busy = Some(unreachableMedia("A previous media scan has not returned; storage may be offline."))
        // The gate opens on the underlying scan, not on the timeout, so a stuck one keeps the next poll out.
        withTimeout(
          mediaScanGate.runOrElse(busy) {
            for {
              dirs      <- Future(MediaIntegrity.directoryStatuses(config, environment))(blockingIoEc)
              integrity <- storyMediaIntegrity
            } yield Some(MediaStorageHealth(dirs, enforced, integrity._1, integrity._2))
          },
          "media storage scan"
        )
      }
      .recover { case e: Exception =>
        logger.warn(s"Health: failed to read media storage: ${e.getMessage}"); None
      }
  }

  /** Whether the boot check arms on this instance; read from the check itself so the page can't claim a false guard. */
  private def enforced: Boolean = modules.PersistentMediaDirCheck.arms(environment)

  /** The panel with nothing but a reason on it, for when even stat-ing the directories would block. */
  private def unreachableMedia(reason: String): MediaStorageHealth =
    MediaStorageHealth(Seq.empty, enforced, None, Some(reason))

  /**
   * Compares every visible city's `story_media` rows against the files on disk.
   *
   * Reads the schemas, then their row counts, then their ids — three cheap round trips behind a five-minute cache
   * rather than one query per city. If the base directory itself is unreadable, the scan reports itself unavailable
   * instead of declaring every row lost: a monitor that cries data loss over a missing mount would be worse than no
   * monitor at all.
   *
   * @return The scan, or the reason it couldn't run.
   */
  private def storyMediaIntegrity: Future[(Option[StoryMediaIntegrity], Option[String])] = {
    // Resolve inside the blocking future: MediaDirs.baseDir throws on an unusable value, and a synchronous throw
    // here would escape the caller's `.recover` instead of degrading to an unavailable panel.
    Future {
      val baseDir = MediaDirs.baseDir(config, environment, "story.media.directory")
      (baseDir, MediaIntegrity.scanRefusal(baseDir.getAbsolutePath, baseDir.isDirectory, baseDir.canRead))
    }(blockingIoEc).flatMap {
      case (_, Some(refusal)) => Future.successful((None, Some(refusal)))
      case (baseDir, None)    =>
        db.run(healthTable.getStoryMediaSchemas).map(_.filter(_.matches("^[A-Za-z0-9_]+$"))).flatMap { schemas =>
          if (schemas.isEmpty)
            Future.successful((Some(StoryMediaIntegrity(baseDir.getAbsolutePath, Seq.empty, 0, 0)), None))
          else
            db.run(healthTable.getStoryMediaCounts(schemas)).flatMap { counts =>
              val total = counts.map(_.rows).sum
              if (total > maxStoryMediaRows) {
                Future.successful((None, Some(s"$total story_media rows is more than this scan will load at once.")))
              } else {
                val populated = counts.filter(_.rows > 0).map(_.schema)
                val idsF      =
                  if (populated.isEmpty) Future.successful(Seq.empty[SchemaMediaId])
                  else db.run(healthTable.getStoryMediaIds(populated))
                for {
                  ids     <- idsF
                  current <- db.run(healthTable.getCurrentSchema)
                  cities  <- scanCities(baseDir, current, counts, ids)
                } yield (Some(cities), None)
              }
            }
        }
    }
  }

  /**
   * Lists each city's directory once and diffs it against that city's ids — one listing per city, whatever the row
   * count, which is what keeps this affordable as stories grow.
   *
   * This instance's own schema takes its city from `city-id` rather than from the schema mapping, because that is
   * what `StoryService` builds its write path from: the two settings are independent, and on an instance where they
   * disagree the scan has to look where the files actually are rather than where the mapping says they should be.
   *
   * @param baseDir       Resolved base directory holding the per-city subdirectories.
   * @param currentSchema The schema this instance reads and writes.
   * @param counts        Row counts per schema, which decide the rows reported.
   * @param ids           Every media id, tagged with its schema.
   */
  private def scanCities(
      baseDir: File,
      currentSchema: String,
      counts: Seq[SchemaRowCount],
      ids: Seq[SchemaMediaId]
  ): Future[StoryMediaIntegrity] = {
    val idsBySchema = ids.groupBy(_.schema).view.mapValues(_.map(_.storyMediaId)).toMap
    val targets     = MediaIntegrity.scanTargets(
      counts.map(_.schema),
      currentSchema,
      config.get[String]("city-id"),
      cityIdBySchema
    )
    Future {
      counts.sortBy(_.schema).map { case SchemaRowCount(schema, _) =>
        val mediaIds = idsBySchema.getOrElse(schema, Seq.empty)
        targets.get(schema) match {
          case Some(ScanTarget.Dir(cityId)) =>
            MediaIntegrity.compareCity(cityId, schema, mediaIds, MediaIntegrity.listing(new File(baseDir, cityId)))
          case Some(ScanTarget.Unlocatable(reason)) => MediaIntegrity.unscannedCity(None, schema, mediaIds, reason)
          case None => MediaIntegrity.unscannedCity(None, schema, mediaIds, s"no scan target for schema $schema")
        }
      }
    }(blockingIoEc).map { cities =>
      StoryMediaIntegrity(baseDir.getAbsolutePath, cities, cities.map(_.missing).sum, cities.map(_.orphans).sum)
    }
  }

  /** Fails a future that outlives the media-scan budget, so one unreachable mount can't hold the poll open. */
  private def withTimeout[T](f: Future[T], label: String): Future[T] = {
    val timeout = after(mediaScanTimeout, actorSystem.scheduler)(
      Future.failed(new java.util.concurrent.TimeoutException(s"$label did not finish within $mediaScanTimeout"))
    )
    Future.firstCompletedOf(Seq(f, timeout))
  }

  private def logAndEmpty[T](label: String): PartialFunction[Throwable, Seq[T]] = { case e: Exception =>
    logger.warn(s"Health: failed to read $label: ${e.getMessage}")
    Seq.empty[T]
  }
}

object HealthService {
  implicit private val jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  implicit val blockingSessionWrites: Writes[BlockingSession]         = Json.writes[BlockingSession]
  implicit val idleTxnSessionWrites: Writes[IdleTxnSession]           = Json.writes[IdleTxnSession]
  implicit val activeQueryWrites: Writes[ActiveQuery]                 = Json.writes[ActiveQuery]
  implicit val stuckEvolutionWrites: Writes[StuckEvolution]           = Json.writes[StuckEvolution]
  implicit val tableBloatWrites: Writes[TableBloat]                   = Json.writes[TableBloat]
  implicit val connCountWrites: Writes[ConnCount]                     = Json.writes[ConnCount]
  implicit val panoBackupStatsWrites: Writes[PanoBackupStats]         = Json.writes[PanoBackupStats]
  implicit val mediaDirStatusWrites: Writes[MediaDirStatus]           = Json.writes[MediaDirStatus]
  implicit val cityStoryMediaWrites: Writes[CityStoryMedia]           = Json.writes[CityStoryMedia]
  implicit val storyMediaIntegrityWrites: Writes[StoryMediaIntegrity] = Json.writes[StoryMediaIntegrity]
  implicit val mediaStorageHealthWrites: Writes[MediaStorageHealth]   = Json.writes[MediaStorageHealth]
  implicit val healthThresholdsWrites: Writes[HealthThresholds]       = Json.writes[HealthThresholds]
  implicit val dbHealthDataWrites: Writes[DbHealthData]               = Json.writes[DbHealthData]
}
