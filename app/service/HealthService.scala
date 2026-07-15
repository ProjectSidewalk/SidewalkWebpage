package service

import com.google.inject.ImplementedBy
import models.utils.HealthTable
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._
import play.api.{Configuration, Logger}
import models.utils.MyPostgresProfile

import java.time.OffsetDateTime
import javax.inject._
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
    atRisk: Long,
    missingMetadata: Long
)

/** The connecting role's environment: database, role, and whether it can read every session's statement text. */
case class DbEnvInfo(database: String, role: String, canSeeAllQueries: Boolean)

/**
 * Server-owned thresholds the dashboard uses to color each panel, echoed in the payload so the frontend never
 * hard-codes them (CLAUDE.md: domain values come from the backend). Seconds unless noted.
 */
case class HealthThresholds(
    idleTxnWarnSeconds: Long,
    idleTxnBadSeconds: Long,
    lockWaitWarnSeconds: Long,
    lockWaitBadSeconds: Long,
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
    stuckEvolutions: Seq[StuckEvolution],
    tableBloat: Seq[TableBloat],
    connections: Seq[ConnCount],
    panoBackups: Option[PanoBackupStats],
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
    healthTable: HealthTable
)(implicit val ec: ExecutionContext)
    extends HealthService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  // Per-instance Slick/Hikari pool ceiling; a city role whose active backends approach it is saturated (#4559).
  private val poolMax: Int = config.getOptional[Int]("slick.dbs.default.db.maxConnections").getOrElse(25)

  private val thresholds: HealthThresholds = HealthThresholds(
    idleTxnWarnSeconds = 120, // 2 min
    idleTxnBadSeconds = 600,  // 10 min
    lockWaitWarnSeconds = 10,
    lockWaitBadSeconds = 60,
    bloatWarnRatio = 0.2,
    bloatBadRatio = 0.4,
    bloatMinDeadTuples = 10000,    // ignore ratios on tables with few dead tuples (stale post-restore estimates)
    vacuumAgeWarnSeconds = 604800, // 7 days
    connPoolMax = poolMax,
    connWarnActive = math.max(1, (poolMax * 0.7).toInt),
    connBadActive = math.max(1, (poolMax * 0.9).toInt)
  )

  def getDbHealth: Future[DbHealthData] = {
    val envF      = db.run(healthTable.getDbEnvInfo)
    val blockingF = db.run(healthTable.getBlockingSessions).recover(logAndEmpty("blocking sessions"))
    val idleF     = db.run(healthTable.getIdleInTransactionSessions).recover(logAndEmpty("idle-in-transaction"))
    val bloatF    = db.run(healthTable.getTableBloat).recover(logAndEmpty("table bloat"))
    val connF     = db.run(healthTable.getConnectionCounts).recover(logAndEmpty("connection counts"))
    val panoF     = db.run(healthTable.getPanoBackupStats).map(Option(_)).recover { case e: Exception =>
      logger.warn(s"Health: failed to read pano backup stats: ${e.getMessage}"); None
    }
    val evoF = getStuckEvolutions

    for {
      env      <- envF
      blocking <- blockingF
      idle     <- idleF
      evo      <- evoF
      bloat    <- bloatF
      conn     <- connF
      pano     <- panoF
    } yield DbHealthData(
      generatedAt = OffsetDateTime.now().toString,
      currentDatabase = env.database,
      currentRole = env.role,
      canSeeAllQueries = env.canSeeAllQueries,
      blockingSessions = blocking,
      idleInTransaction = idle,
      stuckEvolutions = evo,
      tableBloat = bloat,
      connections = conn,
      panoBackups = pano,
      thresholds = thresholds
    )
  }

  /** Fans out over every schema that has a `play_evolutions` table and collects the stuck rows from each. */
  private def getStuckEvolutions: Future[Seq[StuckEvolution]] = {
    db.run(healthTable.getEvolutionSchemas)
      .flatMap { schemas =>
        // Defense in depth: the names come from the catalog, but they are spliced as identifiers, so validate first.
        val valid = schemas.filter(_.matches("^[A-Za-z0-9_]+$"))
        Future
          .sequence(valid.map { schema =>
            db.run(healthTable.getStuckEvolutionsBySchema(schema)).recover { case e: Exception =>
              logger.warn(s"Health: failed to read play_evolutions for schema $schema: ${e.getMessage}")
              Seq.empty[StuckEvolution]
            }
          })
          .map(_.flatten)
      }
      .recover { case e: Exception =>
        logger.warn(s"Health: failed to enumerate evolution schemas: ${e.getMessage}")
        Seq.empty[StuckEvolution]
      }
  }

  private def logAndEmpty[T](label: String): PartialFunction[Throwable, Seq[T]] = { case e: Exception =>
    logger.warn(s"Health: failed to read $label: ${e.getMessage}")
    Seq.empty[T]
  }
}

object HealthService {
  implicit private val jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  implicit val blockingSessionWrites: Writes[BlockingSession]   = Json.writes[BlockingSession]
  implicit val idleTxnSessionWrites: Writes[IdleTxnSession]     = Json.writes[IdleTxnSession]
  implicit val stuckEvolutionWrites: Writes[StuckEvolution]     = Json.writes[StuckEvolution]
  implicit val tableBloatWrites: Writes[TableBloat]             = Json.writes[TableBloat]
  implicit val connCountWrites: Writes[ConnCount]               = Json.writes[ConnCount]
  implicit val panoBackupStatsWrites: Writes[PanoBackupStats]   = Json.writes[PanoBackupStats]
  implicit val healthThresholdsWrites: Writes[HealthThresholds] = Json.writes[HealthThresholds]
  implicit val dbHealthDataWrites: Writes[DbHealthData]         = Json.writes[DbHealthData]
}
