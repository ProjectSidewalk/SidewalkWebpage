package models.audit

import com.google.inject.ImplementedBy
import models.mission.MissionTableDef
import models.mturk.AMTAssignmentTableDef
import models.region.RegionTableDef
import models.route.{AuditTaskUserRouteTableDef, RouteStreetTableDef, UserRouteTableDef}
import models.street.*
import models.user.{Role, SidewalkUserTableDef, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresProfile.api.{given, *}
import models.utils.{ConfigTableDef, FilteredTables, LiftedRow, MyPostgresProfile}
import org.locationtech.jts.geom.{LineString, Point}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import slick.lifted.{FlatShapeLevel, Shape}

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

case class AuditTask(
    auditTaskId: Int,
    amtAssignmentId: Option[Int],
    userId: String,
    streetEdgeId: Int,
    taskStart: OffsetDateTime,
    taskEnd: OffsetDateTime,
    completed: Boolean,
    currentLat: Double,
    currentLng: Double,
    startPointReversed: Boolean,
    currentMissionId: Option[Int],
    currentMissionStart: Option[Point],
    lowQuality: Boolean,
    incomplete: Boolean,
    stale: Boolean,
    auditedDistanceM: Option[Double],
    startOffsetM: Option[Double] = None, // Meters from the street's start to where a free-exploration drop-in began.
    outdatedImagery: Boolean = false,    // Machine-managed (#4384); mirrors the column's DEFAULT FALSE.
    outdatedImageryAt: Option[OffsetDateTime] = None // When the sync last flipped the flag on; NULL while unflagged.
)
case class NewTask(
    edgeId: Int,
    geom: LineString,
    currentLng: Double,
    currentLat: Double,
    wayType: WayType,            // OSM road type (residential, trunk, etc.).
    startPointReversed: Boolean, // Notes if we start at x1,y1 instead of x2,y2.
    taskStart: OffsetDateTime,
    completedByAnyUser: Boolean, // Notes if any user has audited this street.
    priority: Double,
    completed: Boolean,       // Notes if the user audited this street before (null if no corresponding user).
    auditTaskId: Option[Int], // If it's not actually a "new" task, include the audit_task_id.
    currentMissionId: Option[Int],
    currentMissionStart: Option[Point],   // If a mission was started mid-task, the loc where it started.
    routeStreetId: Option[Int],           // The route_street_id if this task is part of a route.
    routeStreetPosition: Option[Int],     // The street's walking-order position within that route.
    maxSpeed: Option[String],             // Raw OSM maxspeed tag for the street's way (e.g. "25 mph"), if known.
    reportedNoImagery: Boolean,           // Reported imagery-less during this route walk; false outside a route.
    needsReaudit: Boolean,                // Audited before, but every completed audit predates newer imagery (#4895).
    mappedByThisUser: Boolean,            // This user has a completed audit here, so the notice says "you" (#4895).
    lastMappedAt: Option[OffsetDateTime], // Date the notice quotes: this user's last audit, else the street's.
    newImageryDate: Option[LocalDate]     // Street's median newest capture, when its imagery has been polled.
)
case class AuditedStreetWithTimestamp(
    streetEdgeId: Int,
    auditTaskId: Int,
    userId: String,
    role: Role,
    highQuality: Boolean,
    taskStart: OffsetDateTime,
    taskEnd: OffsetDateTime,
    geom: LineString
)

/**
 * A street edge with its three-state audit status for map rendering (#4384).
 *
 * @param audited  The street has a completed audit on current imagery.
 * @param outdated The street has completed audits, but all of them predate newer imagery (needs re-audit). Never true
 *                 together with audited; a street with neither flag is unaudited.
 */
case class StreetEdgeWithAuditStatus(
    streetEdgeId: Int,
    geom: LineString,
    regionId: Int,
    wayType: WayType,
    audited: Boolean,
    outdated: Boolean
)

/**
 * One street a given user audited that still needs a re-audit, for the dashboard's re-audit list (#4896).
 *
 * @param distanceMeters Geodesic length of the whole street, not of the user's walk along it.
 * @param newImageryDate The capture date that flagged the street: the median of its sample points' newest captures
 *                       (#4384). `None` when the latest poll of the street came back empty, which clears the median
 *                       while the flags it created stand until the next sync.
 * @param lastAuditedAt  When the user last completed an audit of the street. `None` is unreachable for a listed
 *                       street -- a street is only here because the user completed an audit of it.
 */
case class OutdatedStreetForUser(
    streetEdgeId: Int,
    regionId: Int,
    regionName: String,
    distanceMeters: Double,
    newImageryDate: Option[LocalDate],
    lastAuditedAt: Option[OffsetDateTime]
)

/** One street's audit state for a given user; see [[AuditTaskTable.streetAuditState]]. */
case class StreetAuditState(
    streetEdgeId: Int,
    completedByAnyUser: Boolean,
    needsReaudit: Boolean,
    mappedByThisUser: Boolean,
    lastMappedAt: Option[OffsetDateTime],
    newImageryDate: Option[LocalDate]
)

/** [[StreetAuditState]] while it is still part of a query. */
case class StreetAuditStateRep(
    streetEdgeId: Rep[Int],
    completedByAnyUser: Rep[Boolean],
    needsReaudit: Rep[Boolean],
    mappedByThisUser: Rep[Boolean],
    lastMappedAt: Rep[Option[OffsetDateTime]],
    newImageryDate: Rep[Option[LocalDate]]
)
object StreetAuditStateRep {
  given Shape[FlatShapeLevel, StreetAuditStateRep, StreetAuditState, StreetAuditStateRep] =
    LiftedRow.shape(StreetAuditStateRep.apply.tupled)(StreetAuditState.apply.tupled)
}

/** The open route task a labeler resumes on, and where its street falls in the route's walking order. */
case class ResumableRouteTask(auditTaskId: Int, routeStreetId: Int, position: Int)

class AuditTaskTableDef(tag: slick.lifted.Tag) extends Table[AuditTask](tag, "audit_task") {
  def auditTaskId: Rep[Int]             = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId: Rep[Option[Int]] = column[Option[Int]]("amt_assignment_id")
  def userId: Rep[String]               = column[String]("user_id")
  def streetEdgeId: Rep[Int]            = column[Int]("street_edge_id")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def taskStart: Rep[OffsetDateTime]          = column[OffsetDateTime]("task_start")
  def taskEnd: Rep[OffsetDateTime]            = column[OffsetDateTime]("task_end")
  def completed: Rep[Boolean]                 = column[Boolean]("completed", O.Default(false))
  def currentLat: Rep[Double]                 = column[Double]("current_lat")
  def currentLng: Rep[Double]                 = column[Double]("current_lng")
  def startPointReversed: Rep[Boolean]        = column[Boolean]("start_point_reversed", O.Default(false))
  def currentMissionId: Rep[Option[Int]]      = column[Option[Int]]("current_mission_id")
  def currentMissionStart: Rep[Option[Point]] = column[Option[Point]]("current_mission_start")
  def lowQuality: Rep[Boolean]                = column[Boolean]("low_quality", O.Default(false))
  def incomplete: Rep[Boolean]                = column[Boolean]("incomplete", O.Default(false))
  def stale: Rep[Boolean]                     = column[Boolean]("stale", O.Default(false))
  def auditedDistanceM: Rep[Option[Double]]   = column[Option[Double]]("audited_distance_m")
  // CHECK (start_offset_m >= 0) in the DB (no Slick DSL for CHECK constraints).
  def startOffsetM: Rep[Option[Double]] = column[Option[Double]]("start_offset_m")
  // Partial index in the DB (356.sql, no Slick DSL for partial indexes):
  // audit_task_street_edge_id_outdated_idx ON audit_task (street_edge_id) WHERE outdated_imagery.
  def outdatedImagery: Rep[Boolean] = column[Boolean]("outdated_imagery", O.Default(false))
  // CHECK (outdated_imagery OR outdated_imagery_at IS NULL) in the DB (no Slick DSL for CHECK constraints).
  def outdatedImageryAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("outdated_imagery_at")

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed, currentLat, currentLng,
    startPointReversed, currentMissionId, currentMissionStart, lowQuality, incomplete, stale, auditedDistanceM,
    startOffsetM, outdatedImagery, outdatedImageryAt).mapTo[AuditTask]

  def streetEdge =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  def user           = foreignKey("audit_task_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def currentMission =
    foreignKey("audit_task_current_mission_id_fkey", currentMissionId, TableQuery[MissionTableDef])(_.missionId.?)
  def amtAssignment =
    foreignKey("audit_task_amt_assignment_id_fkey", amtAssignmentId, TableQuery[AMTAssignmentTableDef])(
      _.amtAssignmentId.?
    )
}

@ImplementedBy(classOf[AuditTaskTable])
trait AuditTaskTableRepository {}

class AuditTaskTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeTable: StreetEdgeTable,
    osmWayTable: OsmWayTable
)(using ec: ExecutionContext)
    extends AuditTaskTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val auditTasks            = TableQuery[AuditTaskTableDef]
  val regions               = TableQuery[RegionTableDef]
  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTableDef]
  val configTable           = TableQuery[ConfigTableDef]
  val streetEdgePriorities  = TableQuery[StreetEdgePriorityTableDef]
  val userStats             = TableQuery[UserStatTableDef]
  val userRoleTable         = TableQuery[UserRoleTableDef]
  val routeStreets          = TableQuery[RouteStreetTableDef]
  val userRoutes            = TableQuery[UserRouteTableDef]
  val auditTaskUserRoutes   = TableQuery[AuditTaskUserRouteTableDef]
  val streetImagery         = TableQuery[StreetImageryTableDef]
  val streetEdgeIssues      = TableQuery[StreetEdgeIssueTableDef]

  val activeTasks    = auditTasks.filterNot(_.completed)
  val completedTasks = auditTasks.filter(_.completed)

  // Audits still valid for today's imagery. Streets without one get offered again. Credit and stats use completedTasks,
  // since an outdated audit still counts as work done (#4384).
  val upToDateCompletedTasks = completedTasks.filterNot(_.outdatedImagery)

  // Same, minus excluded users. Used for a street's status as everyone sees it.
  val upToDateCountedTasks = streetEdgeTable.countedAuditTasks.filterNot(_.outdatedImagery)

  val regionsWithoutDeleted       = regions.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = for {
    _ser <- streetEdgeRegionTable
    _se  <- streetEdgeTable.streets if _ser.streetEdgeId === _se.streetEdgeId
    _r   <- regionsWithoutDeleted if _ser.regionId === _r.regionId
  } yield _ser

  /**
   * Every street's audit state as the Explore task payload reports it, for the user the task is being handed to.
   *
   * Only audits by users who aren't excluded count. `completedByAnyUser` counts only audits on current imagery
   * (#4384), so alone it cannot tell a street nobody has walked from one whose audits were all overtaken by newer
   * imagery -- both read false. `needsReaudit` is that distinction; `mappedByThisUser` splits it again, because the
   * labeler who mapped it themself is told their own work is being refreshed and one who never did is told somebody
   * else's is (#4895). `lastMappedAt` follows that split, so it is resolved here rather than sent as both dates --
   * which would push [[NewTask]] past the 22-element ceiling Slick's tuple shapes stop at.
   *
   * The tutorial street reads `completedByAnyUser` true, having completed audits like any other, but never
   * `needsReaudit`: [[models.street.StreetImageryTable.streetsToPoll]] excludes it from imagery polling, so its
   * audits are never flagged `outdated_imagery`. That exclusion is the only thing holding the invariant, which is
   * why [[getATutorialTask]] hardcodes the flag off rather than relying on it.
   *
   * @param userId The user the task is for, for the `mappedByThisUser` and `lastMappedAt` columns.
   * @return A query with one row per open street, tutorial street included.
   */
  def streetAuditState(userId: String): Query[StreetAuditStateRep, StreetAuditState, Seq] = {
    // Presence is all that is ever read, so a distinct set beats counting (as in selectStreetsWithAuditStatus).
    val _upToDateStreets = upToDateCountedTasks.groupBy(_.streetEdgeId).map { case (_street, _) => _street }

    // Each aggregate doubles as its own presence test: the row exists exactly when a completed audit does.
    val _lastAuditPerStreet = streetEdgeTable.countedAuditTasks.groupBy(_.streetEdgeId).map { case (_street, _group) =>
      (_street, _group.map(_.taskEnd).max)
    }
    val _yourLastAuditPerStreet = completedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map {
      case (_street, _group) => (_street, _group.map(_.taskEnd).max)
    }

    // Left joins throughout, or unaudited streets would drop out of the task list entirely.
    streetEdgeTable.streetsWithTutorial
      .joinLeft(_upToDateStreets)
      .on(_.streetEdgeId === _)
      .joinLeft(_lastAuditPerStreet)
      .on { case ((_edge, _), (_street, _)) => _edge.streetEdgeId === _street }
      .joinLeft(_yourLastAuditPerStreet)
      .on { case (((_edge, _), _), (_street, _)) => _edge.streetEdgeId === _street }
      .joinLeft(streetImagery)
      .on { case ((((_edge, _), _), _), _imagery) => _edge.streetEdgeId === _imagery.streetEdgeId }
      .map { case ((((_edge, _upToDate), _lastAudit), _yourLastAudit), _imagery) =>
        StreetAuditStateRep(
          streetEdgeId = _edge.streetEdgeId,
          completedByAnyUser = _upToDate.isDefined,
          needsReaudit = _upToDate.isEmpty && _lastAudit.isDefined,
          mappedByThisUser = _yourLastAudit.isDefined,
          lastMappedAt = Case
            .If(_yourLastAudit.isDefined)
            .Then(_yourLastAudit.flatMap { case (_, _taskEnd) => _taskEnd })
            .Else(_lastAudit.flatMap { case (_, _taskEnd) => _taskEnd }),
          newImageryDate = _imagery.flatMap(_.medianNewestCapture)
        )
      }
  }

  /**
   * Returns a count of the number of audits performed on each day with an audit.
   */
  def getAuditCountsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    completedTasks
      .map(_.taskEnd.trunc("day"))
      .groupBy(day => day)
      .map { case (day, tasks) => (day, tasks.length) }
      .sortBy { case (day, _) => day }
      .result
  }

  /**
   * Returns the number of Explore tasks (streets) completed in the specific time range.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def countCompletedAudits(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[Int] = {
    TimeInterval.start(timeInterval).fold(completedTasks)(s => completedTasks.filter(_.taskEnd >= s)).length.result
  }

  /**
   * Find a task.
   */
  def find(userId: String, streetEdgeId: Int): DBIO[Option[AuditTask]] = {
    auditTasks.filter(a => a.userId === userId && a.streetEdgeId === streetEdgeId).result.headOption
  }

  /**
   * Find the user's task on the given street within the given mission, if there is one.
   *
   * Scoped to the mission (unlike `find`, which also matches tasks from regular audits) so that resuming an
   * exploreAddress session (#4451) can't grab a task belonging to the user's normal audit history. Completed tasks
   * match too: a drop-in street can be finished (#4451), and re-searching that same address must resume the existing
   * task rather than insert a second row for the same (user, street, mission). Nothing in the schema forbids duplicate
   * (user, street, mission) rows — the invariant lives in an advisory lock (see `lockUserForExploreAddress`) — so the
   * newest row is taken deliberately rather than leaving the pick to the planner.
   */
  def findTaskForMission(userId: String, streetEdgeId: Int, missionId: Int): DBIO[Option[AuditTask]] = {
    auditTasks
      .filter(a => a.userId === userId && a.streetEdgeId === streetEdgeId && a.currentMissionId === missionId)
      .sortBy(_.auditTaskId.desc)
      .result
      .headOption
  }

  /**
   * Gets the list of streets in the specified region that the user has not audited with up-to-date imagery.
   *
   * A street whose only audits by this user predate newer imagery counts as not audited, so the user can be routed
   * down it again (#4384).
   */
  def getStreetEdgeRegionsNotAuditedQuery(
      userId: String,
      regionId: Int
  ): Query[StreetEdgeRegionTableDef, StreetEdgeRegion, Seq] = {
    val edgesAuditedByUser = upToDateCompletedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map {
      case (streetEdgeId, _) => streetEdgeId
    }

    nonDeletedStreetEdgeRegions
      .filter(_.regionId === regionId)
      .joinLeft(edgesAuditedByUser)
      .on(_.streetEdgeId === _)
      .filter { case (_, audited) => audited.isEmpty }
      .map { case (streetEdgeRegion, _) => streetEdgeRegion }
  }

  /**
   * Gets the list of streets in the specified region that the user has not audited with up-to-date imagery.
   */
  def getStreetEdgeIdsNotAudited(user: String, regionId: Int): DBIO[Seq[Int]] = {
    getStreetEdgeRegionsNotAuditedQuery(user, regionId).map(_.streetEdgeId).result
  }

  /**
   * Get a set of regions where the user has explored all the street edges (with up-to-date imagery).
   *
   * A region re-opens for the user when new imagery lands on a street they audited (#4384).
   */
  def getRegionsCompletedByUser(userId: String): DBIO[Seq[Int]] = {
    val edgesAuditedByUser = upToDateCompletedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map {
      case (streetEdgeId, _) => streetEdgeId
    }

    // Get regions that the user _hasn't_ finished.
    val incompleteRegionIds = nonDeletedStreetEdgeRegions
      .joinLeft(edgesAuditedByUser)
      .on(_.streetEdgeId === _)
      .filter { case (_, audited) => audited.isEmpty }
      .map { case (streetEdgeRegion, _) => streetEdgeRegion.regionId }
      .groupBy(regionId => regionId)
      .map { case (regionId, _) => regionId }

    // Any region that is not in the incompleteRegionIds list is a region that the user has completed.
    regionsWithoutDeleted
      .joinLeft(incompleteRegionIds)
      .on(_.regionId === _)
      .filter { case (_, incomplete) => incomplete.isEmpty }
      .map { case (region, _) => region.regionId }
      .result
  }

  /**
   * Returns true if the user has a completed audit task with up-to-date imagery for the given street edge.
   *
   * Also guards ExploreService.updateStreetPriority: when a user re-audits a street whose earlier audit is flagged
   * outdated_imagery, this returns false, so the re-audit updates priority (and region completion) like a first audit.
   */
  def userHasAuditedStreet(streetEdgeId: Int, user: String): DBIO[Boolean] = {
    upToDateCompletedTasks.filter(task => task.streetEdgeId === streetEdgeId && task.userId === user).exists.result
  }

  /**
   * Return all street edges and whether they have been audited or not. If provided, filter for only given regions.
   */
  def selectStreetsWithAuditStatus(
      filterLowQuality: Boolean,
      regionIds: Seq[Int],
      routeIds: Seq[Int]
  ): Future[Seq[StreetEdgeWithAuditStatus]] = {
    // No streets join: the outer query already limits to routable streets.
    val _filteredTasks =
      if (filterLowQuality) {
        streetEdgeTable.countedAuditTasksWithUsers
          .filter { case (_, userStat) => userStat.highQuality }
          .map { case (task, _) => task }
      } else streetEdgeTable.countedAuditTasks

    // Distinct streets with any completed audit, and with a completed audit on current imagery (#4384).
    val _distinctEverCompleted = _filteredTasks.groupBy(_.streetEdgeId).map { case (streetEdgeId, _) => streetEdgeId }
    val _distinctUpToDate      =
      _filteredTasks.filterNot(_.outdatedImagery).groupBy(_.streetEdgeId).map { case (streetEdgeId, _) => streetEdgeId }

    // Left join streets against both sets: audited = has an up-to-date audit; outdated = audited before, but every
    // audit predates newer imagery (needs re-audit). Unaudited streets match neither.
    val streetsWithAudits = streetEdgeTable.streets
      .join(streetEdgeRegionTable)
      .on(_.streetEdgeId === _.streetEdgeId)
      .filter { case (_, region) => (region.regionId inSetBind regionIds) || regionIds.isEmpty }
      .joinLeft(_distinctUpToDate)
      .on { case ((street, _), upToDateId) => street.streetEdgeId === upToDateId }
      .joinLeft(_distinctEverCompleted)
      .on { case (((street, _), _), everCompletedId) => street.streetEdgeId === everCompletedId }

    // If routeIds are provided, filter out streets that are not part of the route.
    val streetsWithAuditsFiltered = if (routeIds.nonEmpty) {
      routeStreets
        .filter(_.routeId inSetBind routeIds)
        .join(streetsWithAudits)
        .on { case (routeStreet, (((street, _), _), _)) => routeStreet.streetEdgeId === street.streetEdgeId }
        .map { case (_, streetWithAudits) => streetWithAudits }
    } else {
      streetsWithAudits
    }

    val streetsWithAuditedStatus = streetsWithAuditsFiltered.map { case (((street, region), upToDate), everCompleted) =>
      (
        street.streetEdgeId,
        street.geom,
        region.regionId,
        street.wayType,
        upToDate.isDefined,
        upToDate.isEmpty && everCompleted.isDefined
      ).mapTo[StreetEdgeWithAuditStatus]
    }

    db.run(streetsWithAuditedStatus.result)
  }

  /**
   * Get the streets that have been audited, with the time they were audited, and metadata about the user who audited.
   */
  def getAuditedStreetsWithTimestamps: DBIO[Seq[AuditedStreetWithTimestamp]] = {
    val auditedStreets = for {
      _at <- completedTasks
      _se <- streetEdgeTable.streets if _at.streetEdgeId === _se.streetEdgeId
      _ut <- userStats if _at.userId === _ut.userId
      _ur <- userRoleTable if _ut.userId === _ur.userId
    } yield (_se.streetEdgeId, _at.auditTaskId, _ut.userId, _ur.role, _ut.highQuality, _at.taskStart, _at.taskEnd,
      _se.geom).mapTo[AuditedStreetWithTimestamp]
    auditedStreets.result
  }

  /**
   * Return street edges audited by the given user, each with whether it still needs a re-audit (#4384).
   *
   * The flag is the same three-state notion the city-wide maps use: a street is outdated when no completed audit of
   * it -- this user's or anyone else's -- was made against the current imagery. So a street another mapper has
   * already refreshed reads as up to date here, and nobody is sent back to work someone else has redone.
   *
   * @return (street, needs re-audit) pairs, one per distinct street.
   */
  def getAuditedStreets(userId: String): DBIO[Seq[(StreetEdge, Boolean)]] = {
    completedTasks
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .filter { case (task, _) => task.userId === userId }
      .map { case (_, street) => street }
      .distinct
      .map(street => (street, !hasUpToDateAudit(street.streetEdgeId, userId)))
      .result
  }

  /**
   * Whether the street has an up-to-date audit that counts (#4384), or one by this user, so excluded users still see
   * their own streets as done.
   *
   * Correlated on purpose: it compiles to an EXISTS that Postgres serves from audit_task's street_edge_id index,
   * driven by the handful of streets the outer query already narrowed to. The set-membership form ("street_edge_id
   * NOT IN (SELECT ...)") reads the same but builds its hash over every completed audit in the city first.
   */
  private def hasUpToDateAudit(streetEdgeId: Rep[Int], userId: String): Rep[Boolean] = {
    upToDateCountedTasks.filter(_.streetEdgeId === streetEdgeId).exists ||
    upToDateCompletedTasks.filter(t => t.streetEdgeId === streetEdgeId && t.userId === userId).exists
  }

  /**
   * The streets a user audited that still need a re-audit, joined to the region and imagery data the list renders.
   *
   * Selecting on "no up-to-date audit exists" rather than on the user's own `outdated_imagery` flag is equivalent --
   * a street with no up-to-date audit necessarily has all of its audits flagged -- but it is the condition that has
   * to still hold for the re-audit to be worth doing, so a street another mapper refreshes drops out of everyone's
   * list. Streets that are closed or missing imagery, and the tutorial street, are excluded by `streets`.
   */
  private def outdatedStreetsForUserQuery(userId: String) = {
    // The user's streets, each with when they last finished auditing it, minus the ones already refreshed.
    val userStreets = completedTasks
      .filter(_.userId === userId)
      .groupBy(_.streetEdgeId)
      .map { case (streetEdgeId, tasks) => (streetEdgeId, tasks.map(_.taskEnd).max) }
      .filterNot { case (streetEdgeId, _) => hasUpToDateAudit(streetEdgeId, userId) }

    for {
      (streetEdgeId, lastAudited) <- userStreets
      _se                         <- streetEdgeTable.streets if _se.streetEdgeId === streetEdgeId
      _ser                        <- streetEdgeRegionTable if _ser.streetEdgeId === streetEdgeId
      _r                          <- regionsWithoutDeleted if _r.regionId === _ser.regionId
    } yield (_se, _r, lastAudited)
  }

  /**
   * When a non-excluded user last finished auditing the street, or `None` if none has.
   *
   * Counts audits regardless of the auditor's quality rating, matching the `audit_activity` bookkeeping in
   * [[models.street.StreetEdgePriorityTable]]: this is the audited/outdated record the rest of the app reports, not
   * the priority formula's weighted view of the same audits.
   */
  def getLastCompletedAuditTime(streetEdgeId: Int): DBIO[Option[OffsetDateTime]] = {
    streetEdgeTable.countedAuditTasks.filter(_.streetEdgeId === streetEdgeId).map(_.taskEnd).max.result
  }

  /**
   * Whether the street has an up-to-date audit that counts (#4384), as everyone sees it.
   */
  def hasUpToDateAuditFor(streetEdgeId: Int): DBIO[Boolean] = {
    upToDateCountedTasks.filter(_.streetEdgeId === streetEdgeId).exists.result
  }

  /**
   * Count the streets a user audited that still need a re-audit (#4896).
   *
   * Shares [[outdatedStreetsForUserQuery]] with [[getOutdatedStreetsForUser]] so the count can't disagree with the
   * list it heads.
   */
  def countOutdatedStreetsForUser(userId: String): DBIO[Int] = {
    outdatedStreetsForUserQuery(userId).length.result
  }

  /**
   * List the streets a user audited that still need a re-audit, the audit they last finished longest ago first
   * (#4896).
   *
   * Ordering on the user's own visit rather than on the capture date is what makes the list discriminate: a city's
   * capture dates cluster around the handful of dates the imagery provider drove it, while the user's audits spread
   * across their whole history. Oldest-first also matches what the section asks them to do -- see what has changed
   * since they last looked -- by leading with the streets they have looked at least recently.
   *
   * @param limit Most rows to return; the caller pairs this with [[countOutdatedStreetsForUser]] for the full total.
   */
  def getOutdatedStreetsForUser(userId: String, limit: Int): DBIO[Seq[OutdatedStreetForUser]] = {
    outdatedStreetsForUserQuery(userId)
      .joinLeft(streetImagery)
      .on { case ((_se, _, _), _si) => _se.streetEdgeId === _si.streetEdgeId }
      .sortBy { case ((_se, _, lastAudited), _) => (lastAudited.asc.nullsLast, _se.streetEdgeId.asc) }
      .take(limit)
      .map { case ((_se, _r, lastAudited), _si) =>
        (_se.streetEdgeId, _r.regionId, _r.name, _se.geom.lengthGeodesic, _si.flatMap(_.medianNewestCapture),
          lastAudited).mapTo[OutdatedStreetForUser]
      }
      .result
  }

  /**
   * Gets total distance audited by a user in meters.
   */
  def getDistanceAudited(userId: String): DBIO[Double] =
    metersAuditedByUser(_ === userId).map { case (_, meters) => meters }.result.headOption.map(_.getOrElse(0d))

  /**
   * Sums the same geodesic street lengths [[getDistanceAudited]] does, rather than reading the nightly
   * `user_stat.meters_audited`, so a team page opened right after a mapathon isn't a day behind (#5381).
   *
   * @param userIds The users to measure.
   * @return One entry per user with a completed audit: (user id, meters explored).
   */
  def getDistanceAuditedByUsers(userIds: Seq[String]): DBIO[Seq[(String, Double)]] =
    metersAuditedByUser(_ inSet userIds).result

  /**
   * The one definition of distance explored, shared by the profile, team pages, and `user_stat.meters_audited`: the
   * geodesic length of every street a user has a completed audit on, counting a street again each time it's audited.
   *
   * @param includeUser Which users to measure.
   * @return A query of (user id, meters explored), one row per user with a completed audit.
   */
  def metersAuditedByUser(
      includeUser: Rep[String] => Rep[Boolean]
  ): Query[(Rep[String], Rep[Double]), (String, Double), Seq] =
    completedTasks
      .filter(task => includeUser(task.userId))
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .groupBy { case (task, _) => task.userId }
      .map { case (_userId, rows) =>
        (_userId, rows.map { case (_, street) => street.geom.lengthGeodesic }.sum.getOrElse(0d))
      }

  /**
   * A street's length if the user already explored it, which leaves it out of getUnauditedDistance.
   * @return The length in meters, or 0 if they haven't explored it.
   */
  def lengthIfExploredBy(userId: String, streetEdgeId: Int): DBIO[Double] = {
    streetEdgeTable.streets
      .filter(_.streetEdgeId === streetEdgeId)
      .filter(street =>
        upToDateCompletedTasks.filter(t => t.userId === userId && t.streetEdgeId === street.streetEdgeId).exists
      )
      .map(_.geom.lengthGeodesic)
      .result
      .headOption
      .map(_.getOrElse(0d))
  }

  /**
   * Get the sum of the line distance of all streets in the region that the user has not audited.
   */
  def getUnauditedDistance(userId: String, regionId: Int): DBIO[Double] = {
    getStreetEdgeRegionsNotAuditedQuery(userId, regionId)
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_, street) => street.geom.lengthGeodesic }
      .sum
      .result
      .map(_.getOrElse(0d))
  }

  /**
   * Get a new task specified by the street edge id.
   *
   * @param userId The user the task is for, for [[streetAuditState]]'s per-user columns.
   */
  def selectANewTask(
      streetEdgeId: Int,
      userId: String,
      missionId: Int,
      reverseStartPoint: Boolean = false,
      routeStreetId: Option[Int] = None,
      routeStreetPosition: Option[Int] = None
  ): DBIO[NewTask] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now

    // Join with other queries to get completion count and priority for each of the street edges.
    val edges = for {
      se                    <- streetEdgeTable.streets if se.streetEdgeId === streetEdgeId
      scau                  <- streetAuditState(userId) if se.streetEdgeId === scau.streetEdgeId
      sep                   <- streetEdgePriorities if scau.streetEdgeId === sep.streetEdgeId
      (smsEdgeId, maxSpeed) <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === smsEdgeId
    } yield (
      se.streetEdgeId,
      se.geom,
      if (reverseStartPoint) se.x2 else se.x1,
      if (reverseStartPoint) se.y2 else se.y1,
      se.wayType,
      reverseStartPoint,
      timestamp,
      scau.completedByAnyUser,
      sep.priority,
      false,             // completed
      None: Option[Int], // auditTaskId is None for a new task.
      Some(missionId).asColumnOf[Option[Int]],
      LiteralColumn[Option[Point]](None), // currentMissionStart is None for a new task.
      routeStreetId,
      routeStreetPosition,
      maxSpeed,
      false, // reportedNoImagery is route-scoped; see NewTask.
      scau.needsReaudit,
      scau.mappedByThisUser,
      scau.lastMappedAt,
      scau.newImageryDate
    ).mapTo[NewTask]

    edges.result.head
  }

  /**
   * Get a NewTask object for the tutorial. Some dummy values are filled in specifically for the tutorial.
   */
  def getATutorialTask(missionId: Int): DBIO[NewTask] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now
    streetEdgeTable.streetsUnfiltered
      .join(configTable)
      .on(_.streetEdgeId === _.tutorialStreetEdgeID)
      .map { case (e, c) =>
        (
          e.streetEdgeId,
          e.geom,
          e.x1,
          e.y1,
          e.wayType,
          false, // startPointReversed is always false for the tutorial task.
          timestamp,
          false, // completedByAnyUser is always false for the tutorial task.
          1.0,
          false,             // completed is always false for a new task.
          None: Option[Int], // auditTaskId is None for a new task.
          missionId.asColumnOf[Option[Int]],
          LiteralColumn[Option[Point]](None), // currentMissionStart is None for a new task.
          None: Option[Int],                  // routeStreetId is None for the tutorial task.
          None: Option[Int],                  // routeStreetPosition is None for the tutorial task.
          None: Option[String],               // maxSpeed isn't shown during the tutorial.
          false,                              // reportedNoImagery is route-scoped; see NewTask.
          false,                              // needsReaudit: the tutorial street is never a re-audit.
          false,                              // mappedByThisUser: no notice to phrase, so nothing to attribute.
          None: Option[OffsetDateTime],       // lastMappedAt
          None: Option[LocalDate]             // newImageryDate
        ).mapTo[NewTask]
      }
      .result
      .head
  }

  /**
   * Get a task that is in a given region. Used if a user has already been assigned a region, or if regionId is passed.
   *
   * When the pick lands on a street the labeler left part-walked, their open task is handed back instead of a fresh
   * one, carrying its saved position, direction and mission (#5370). Which street is picked is deliberately
   * unchanged: the ask is to resume an abandoned street when the chooser reaches it, not to steer the chooser
   * towards abandoned streets.
   *
   * TODO this isn't a simple CRUD operation, so it should probably go in a Service file.
   */
  def selectANewTaskInARegion(regionId: Int, userId: String, missionId: Int): DBIO[Option[NewTask]] = {
    // Get streets the user hasn't completed. Then join w/ other queries to get completion count and priority.
    val candidates = for {
      ser                   <- getStreetEdgeRegionsNotAuditedQuery(userId, regionId)
      se                    <- streetEdgeTable.streets if ser.streetEdgeId === se.streetEdgeId
      sp                    <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc                    <- streetAuditState(userId) if se.streetEdgeId === sc.streetEdgeId
      (smsEdgeId, maxSpeed) <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === smsEdgeId
    } yield (se, sp, sc, maxSpeed)

    // Get the priority of the highest priority task.
    candidates.map { case (_, sp, _, _) => sp.priority }.max.result.flatMap {
      case Some(maxPriority) =>
        // Choose one of the highest priority tasks at random.
        val highestPriorityTasks = candidates
          .filter { case (_, sp, _, _) => sp.priority === maxPriority }
          .sortBy(_ => random)
          .map { case (se, sp, sc, maxSpeed) =>
            (
              se.streetEdgeId,
              se.geom,
              se.x1,
              se.y1,
              se.wayType,
              false, // startPointReversed is false by default.
              OffsetDateTime.now,
              sc.completedByAnyUser,
              sp.priority,
              false,             // completed is false for a new task.
              None: Option[Int], // auditTaskId is None for a new task.
              Some(missionId).asColumnOf[Option[Int]],
              LiteralColumn[Option[Point]](None), // currentMissionStart is None for a new task.
              None: Option[Int],                  // routeStreetId
              None: Option[Int],                  // routeStreetPosition
              maxSpeed,
              false, // reportedNoImagery is route-scoped; see NewTask.
              sc.needsReaudit,
              sc.mappedByThisUser,
              sc.lastMappedAt,
              sc.newImageryDate
            ).mapTo[NewTask]
          }
        highestPriorityTasks.result.headOption.flatMap {
          case Some(freshTask) =>
            resumableTaskIdOnStreet(userId, freshTask.edgeId).flatMap {
              // selectTaskFromTaskId hands back the row's own mission id rather than the one passed in. That is the
              // page-load resume path's behaviour too: the caller moves mission.current_audit_task_id onto the
              // resumed task, and the next submission's updateTaskProgress rewrites the task's mission.
              case Some(taskId) => selectTaskFromTaskId(taskId, userId)
              case None         => DBIO.successful(Some(freshTask))
            }
          case None => DBIO.successful(None)
        }
      case None =>
        DBIO.successful(None)
    }
  }

  /**
   * Gets the metadata for a task from its audit_task_id.
   *
   * @param taskId              The audit_task_id to look up.
   * @param routeStreetId       Route-street id to carry through onto the task, when auditing along a route.
   * @param routeStreetPosition The street's walking-order position within that route.
   * @param includeCompleted    Match the task even if it is completed. Needed by the exploreAddress resume path
   *                            (#4451), which must reload a drop-in street the session already finished.
   * @param userId              The user the task is for, for [[streetAuditState]]'s per-user columns.
   */
  def selectTaskFromTaskId(
      taskId: Int,
      userId: String,
      routeStreetId: Option[Int] = None,
      routeStreetPosition: Option[Int] = None,
      includeCompleted: Boolean = false
  ): DBIO[Option[NewTask]] = {
    val matchingTasks = if (includeCompleted) auditTasks else activeTasks
    val newTask       = for {
      at                    <- matchingTasks if at.auditTaskId === taskId
      se                    <- streetEdgeTable.streetsWithTutorial if at.streetEdgeId === se.streetEdgeId
      sp                    <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc                    <- streetAuditState(userId) if sp.streetEdgeId === sc.streetEdgeId
      (smsEdgeId, maxSpeed) <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === smsEdgeId
    } yield (
      se.streetEdgeId, se.geom, at.currentLng, at.currentLat, se.wayType, at.startPointReversed, at.taskStart,
      sc.completedByAnyUser, sp.priority, at.completed, at.auditTaskId.?, at.currentMissionId, at.currentMissionStart,
      routeStreetId, routeStreetPosition, maxSpeed, false, // reportedNoImagery is route-scoped; see NewTask.
      sc.needsReaudit, sc.mappedByThisUser, sc.lastMappedAt, sc.newImageryDate
    ).mapTo[NewTask]

    newTask.result.headOption
  }

  /**
   * Get tasks in the region. Called when a user begins auditing. Includes completed tasks, despite return type!
   *
   * Three kinds of row come back, and the client tells them apart by `completed` and `auditTaskId`: a street the user
   * finished (completed, with the audit's id), a street they left part-walked (not completed, with the open task's id,
   * and positioned where they stopped rather than at the street's start), and a street they have never touched (not
   * completed, no id). Only audits with up-to-date imagery count as finished: a street re-imaged since the user's
   * audit comes back as an available task, so the Explore mini-map and next-task logic re-offer it (#4384).
   */
  def selectTasksInARegion(regionId: Int, userId: String): DBIO[Seq[NewTask]] = {
    // A street the user audited more than once is represented by its most recent audit_task (highest id).
    val userCompletedStreets = upToDateCompletedTasks
      .filter(_.userId === userId)
      .groupBy(_.streetEdgeId)
      .map { case (_, tasks) => tasks.map(_.auditTaskId).max }
      .join(auditTasks)
      .on(_ === _.auditTaskId)
      .map { case (_, task) => task }

    // The same streets' unfinished work, carrying the saved position and direction so the labeler picks the street up
    // where they stopped (#5370). Disjoint from userCompletedStreets by construction: resumableTasksForUser drops any
    // street this user already has an up-to-date completed audit of, so the COALESCEs below never have to choose.
    val userResumableStreets = resumableTasksForUser(userId, Some(regionId))

    val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)
    val tasks         = for {
      ((ser, ucs), urs) <- edgesInRegion
        .joinLeft(userCompletedStreets)
        .on(_.streetEdgeId === _.streetEdgeId)
        .joinLeft(userResumableStreets)
        .on { case ((ser, _), urs) => ser.streetEdgeId === urs.streetEdgeId }
      se                    <- streetEdgeTable.streets if ser.streetEdgeId === se.streetEdgeId
      sep                   <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau                  <- streetAuditState(userId) if sep.streetEdgeId === scau.streetEdgeId
      (smsEdgeId, maxSpeed) <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === smsEdgeId
    } yield (
      se.streetEdgeId,
      se.geom,
      // Resume where the labeler stopped; an untouched street starts at its own start.
      urs.map(_.currentLng).ifNull(se.x1),
      urs.map(_.currentLat).ifNull(se.y1),
      se.wayType,
      urs.map(_.startPointReversed).getOrElse(false), // the open task's walking direction; false for a fresh street.
      ucs.map(_.taskStart).ifNull(urs.map(_.taskStart)).getOrElse(OffsetDateTime.now),
      scau.completedByAnyUser,
      sep.priority,
      ucs.isDefined,                                         // completed is true if the user has audited this street.
      ucs.map(_.auditTaskId).ifNull(urs.map(_.auditTaskId)), // the completed audit's id, else the open task's.
      ucs.flatMap(_.currentMissionId).ifNull(urs.flatMap(_.currentMissionId)),
      ucs.flatMap(_.currentMissionStart).ifNull(urs.flatMap(_.currentMissionStart)),
      None: Option[Int], // routeStreetId
      None: Option[Int], // routeStreetPosition
      maxSpeed,
      false, // reportedNoImagery is route-scoped; see NewTask.
      scau.needsReaudit,
      scau.mappedByThisUser,
      scau.lastMappedAt,
      scau.newImageryDate
    ).mapTo[NewTask]

    tasks.result
  }

  /**
   * Streets the route's labeler reported as imagery-less during *this* walk of it.
   *
   * A report from a previous walk is evidence for the offline checker (#4922) but not this walk's decision, and
   * honoring it would skip streets whose imagery has since landed. street_edge_issue records only a user and a
   * timestamp, so the walk is matched per street: the report must come after that street's own task in this walk.
   * Bounding by the walk's start instead would pull in reports filed while auditing the same street outside it.
   *
   * @param userRouteId The walk of the route to bound reports by.
   * @return A query of street edge ids, for use as an `in` subquery.
   */
  def streetsReportedNoImageryDuringRoute(userRouteId: Int): Query[Rep[Int], Int, Seq] = {
    auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId.bind)
      .join(auditTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .join(streetEdgeIssues)
      .on { case ((_, auditTask), issue) =>
        StreetEdgeIssueTable.reportedNoImageryDuringTask(
          issue,
          auditTask.streetEdgeId,
          auditTask.userId,
          auditTask.taskStart
        )
      }
      .map { case (_, issue) => issue.streetEdgeId }
  }

  /**
   * The route task to resume on, if the labeler has one still open: the furthest along the route they got.
   *
   * Streets given up on for missing imagery are excluded: they stay incomplete on purpose (#4922), so otherwise a
   * reload drops the labeler back onto one, losing progress on later streets (#5008).
   *
   * @param userRouteId The walk of the route being resumed.
   * @return The task to resume, or None if no open task remains.
   */
  def resumableRouteTask(userRouteId: Int): DBIO[Option[ResumableRouteTask]] = {
    auditTaskUserRoutes
      .join(auditTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .join(routeStreets)
      .on { case ((link, _), routeStreet) => link.routeStreetId === routeStreet.routeStreetId }
      .filter { case ((link, auditTask), _) =>
        !auditTask.completed && link.userRouteId === userRouteId.bind &&
        !(auditTask.streetEdgeId in streetsReportedNoImageryDuringRoute(userRouteId))
      }
      .sortBy { case (_, routeStreet) => routeStreet.position.desc }
      .map { case ((link, _), routeStreet) =>
        (link.auditTaskId, routeStreet.routeStreetId, routeStreet.position).mapTo[ResumableRouteTask]
      }
      .result
      .headOption
  }

  /**
   * The user's open tasks that they may be handed back to finish, at most one per street (#5370).
   *
   * An abandoned street is the labeler's own half-finished work: their labels hang off that audit_task_id and their
   * walked metres are recorded on it, so handing the street back from its start makes them re-walk and re-label what
   * they already did. The region-audit counterpart of [[resumableRouteTask]].
   *
   * The no-imagery exclusion below uses the same StreetEdgeIssueTable.reportedNoImageryDuringTask test that
   * ExploreService's page-load resume applies to the mission's current task. Only that test is shared: the other two
   * exclusions here would change that path's behaviour if it adopted them.
   *
   * Three exclusions, each for a reason the street is not really resumable:
   *   - Drop-in tasks (`start_offset_m` set) cover only the stretch from where free exploration began (#4451).
   *     Resuming one as a region task would draw the un-walked stretch before the drop-in as audited and let the
   *     labeler complete a street they never covered.
   *   - A street with an up-to-date completed audit by this user is done, whatever open row came after it -- an admin
   *     `?streetEdgeId=` visit can leave one.
   *   - A street the labeler bounced off for missing imagery during this task (#4922). The report is what leaves the
   *     task incomplete, so without this the street comes back on every pick with imagery that still will not load.
   *
   * Newest open row per street, and only then the exclusions: if the newest row is a give-up, the street is fresh
   * rather than falling back to an older row, which would put the labeler back on a street whose latest verdict was
   * "no imagery".
   *
   * @param userId   The labeler whose own unfinished work this is; nobody resumes anyone else's task.
   * @param regionId Narrows the per-street grouping to one region's streets. Worth passing whenever the caller only
   *                 cares about a region: ungrouped, the aggregate covers every open task the user has anywhere, which
   *                 for a heavy mapper on the dev copy of Seattle is 10,375 rows collapsing to 3,951 groups.
   * @return A query of whole audit_task rows, for use as a join or an `in` subquery.
   */
  def resumableTasksForUser(userId: String, regionId: Option[Int] = None): Query[AuditTaskTableDef, AuditTask, Seq] = {
    val openTasks = activeTasks.filter(task => task.userId === userId && task.startOffsetM.isEmpty)
    val inScope   = regionId match {
      case Some(region) =>
        openTasks.filter(
          _.streetEdgeId in nonDeletedStreetEdgeRegions.filter(_.regionId === region).map(_.streetEdgeId)
        )
      case None => openTasks
    }

    // Kept to a single column so the grouped query is only ever used as an `in` subquery -- carrying the group key
    // through a join makes Slick emit SQL that references the grouped subquery from outside its own FROM clause,
    // which Postgres rejects at runtime (see selectTasksInRoute).
    val newestOpenTaskIds = inScope.groupBy(_.streetEdgeId).map { case (_, group) => group.map(_.auditTaskId).max }

    stillResumable(auditTasks.filter(_.auditTaskId.? in newestOpenTaskIds), userId)
  }

  /**
   * Drops the tasks whose street has since been settled some other way, leaving only ones worth handing back.
   *
   * Written as `NOT EXISTS` because that states the condition directly, but the plan is the planner's to choose:
   * measured on the dev database, Postgres converts both into anti-joins (a hash anti-join over a sequential scan of
   * street_edge_issue when the outer side is a whole region's streets, a nested-loop anti-join when it is one street).
   * That is fine at today's sizes and is the reason this is worth revisiting rather than asserting about: the
   * street_edge_issue lookup is by (user_id, street_edge_id) and the only index on that table is on street_edge_id
   * alone, so the user half is always a filter. A composite index is the follow-up if this ever shows up in a profile.
   */
  private def stillResumable(
      tasks: Query[AuditTaskTableDef, AuditTask, Seq],
      userId: String
  ): Query[AuditTaskTableDef, AuditTask, Seq] = {
    tasks
      .filterNot(task =>
        upToDateCompletedTasks
          .filter(completed => completed.userId === userId && completed.streetEdgeId === task.streetEdgeId)
          .exists
      )
      .filterNot(task =>
        streetEdgeIssues
          .filter(StreetEdgeIssueTable.reportedNoImageryDuringTask(_, task.streetEdgeId, userId.bind, task.taskStart))
          .exists
      )
  }

  /**
   * The open task to pick up if the labeler is sent down this street again, by [[resumableTasksForUser]]'s rules.
   *
   * Scoped to the street before the newest-row pick rather than after, so this is an index lookup on a handful of
   * rows. Filtering [[resumableTasksForUser]] on the street instead would leave its per-street aggregate covering the
   * user's whole history to answer a one-street question -- measured on the dev copy of Seattle, 9.1 ms and 562
   * buffers against 0.17 ms and 12, on a query that runs once per next-street pick.
   *
   * @param userId       The labeler being handed the street.
   * @param streetEdgeId The street the next-task chooser landed on.
   * @return The audit_task_id to resume, or None when the street should start fresh.
   */
  def resumableTaskIdOnStreet(userId: String, streetEdgeId: Int): DBIO[Option[Int]] = {
    val newestOpenTask = activeTasks
      .filter(task => task.userId === userId && task.streetEdgeId === streetEdgeId && task.startOffsetM.isEmpty)
      .sortBy(_.auditTaskId.desc)
      .take(1)

    stillResumable(newestOpenTask, userId).map(_.auditTaskId).result.headOption
  }

  /**
   * Gets a list of tasks associated with a user's route.
   * @param userRouteId ID of the user_route.
   */
  def selectTasksInRoute(userRouteId: Int): DBIO[Seq[NewTask]] = {
    // The owner is read first because [[streetAuditState]] filters a grouped subquery by user, and correlating that
    // against an outer column is the shape Postgres rejects (see latestCompletedTaskIds below). Deriving it from the
    // walk also beats a parameter, since the route endpoint is unauthenticated.
    userRoutes.filter(_.userRouteId === userRouteId).map(_.userId).result.headOption.flatMap {
      case Some(ownerId) => selectTasksInRouteFor(userRouteId, ownerId)
      case None          => DBIO.successful(Seq.empty[NewTask]) // No such walk, so no streets to hand out.
    }
  }

  private def selectTasksInRouteFor(userRouteId: Int, userId: String): DBIO[Seq[NewTask]] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now

    val edgesInRoute = userRoutes
      .filter(_.userRouteId === userRouteId)
      .join(routeStreets)
      .on(_.routeId === _.routeId)
      .join(streetEdgeTable.streets)
      .on { case ((_, _routeStreet), _streetEdge) => _routeStreet.streetEdgeId === _streetEdge.streetEdgeId }
      .map { case ((_userRoute, _routeStreet), _streetEdge) => (_streetEdge, _routeStreet) }

    // A route street the user audited more than once is represented by its most recent audit_task (highest id).
    // Keyed by route_street rather than by street: an out-and-back route walks the same street twice, and each
    // traversal is its own task, so keying by street would mark the return leg done and hand it the outbound
    // leg's audit task.
    // The latest completed task per route_street row, as ids. Kept to a single column so the grouped query is only
    // ever used as an `in` subquery — carrying the group key through a join makes Slick emit SQL that references
    // the grouped subquery from outside its own FROM clause, which Postgres rejects at runtime.
    val latestCompletedTaskIds = auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId)
      .join(completedTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .groupBy { case (link, _) => link.routeStreetId }
      .map { case (_, rows) => rows.map { case (_, task) => task.auditTaskId }.max }

    val userCompletedStreets = auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId)
      .join(auditTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .filter { case (_, auditTask) => auditTask.auditTaskId.? in latestCompletedTaskIds }
      .map { case (link, auditTask) => (link.routeStreetId, auditTask) }

    val reportedStreets = streetsReportedNoImageryDuringRoute(userRouteId)

    val tasks = for {
      ((_se1, _rs), ucs) <- edgesInRoute.joinLeft(userCompletedStreets).on {
        case ((_, _routeStreet), (_routeStreetId, _)) => _routeStreet.routeStreetId === _routeStreetId
      }
      _se2                    <- streetEdgeTable.streets if _se1.streetEdgeId === _se2.streetEdgeId
      _sep                    <- streetEdgePriorities if _se2.streetEdgeId === _sep.streetEdgeId
      _scau                   <- streetAuditState(userId) if _sep.streetEdgeId === _scau.streetEdgeId
      (_smsEdgeId, _maxSpeed) <- osmWayTable.streetMaxSpeeds if _se2.streetEdgeId === _smsEdgeId
    } yield (
      _se2.streetEdgeId,
      _se2.geom,
      _se2.x1,
      _se2.y1,
      _se2.wayType,
      _rs.reverse,
      ucs.map { case (_, _task) => _task.taskStart }.getOrElse(timestamp),
      _scau.completedByAnyUser,
      _sep.priority,
      ucs.isDefined, // completed is true if the user has audited this street before.
      ucs.map { case (_, _task) => _task.auditTaskId },
      ucs.flatMap { case (_, _task) => _task.currentMissionId },
      ucs.flatMap { case (_, _task) => _task.currentMissionStart },
      _rs.routeStreetId.asColumnOf[Option[Int]],
      _rs.position.asColumnOf[Option[Int]],
      _maxSpeed,
      _se2.streetEdgeId in reportedStreets, // reportedNoImagery
      _scau.needsReaudit,
      _scau.mappedByThisUser,
      _scau.lastMappedAt,
      _scau.newImageryDate
    ).mapTo[NewTask]

    tasks.result
  }

  /**
   * Saves a new audit task.
   */
  def insert(completedTask: AuditTask): DBIO[Int] = {
    (auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask
  }

  /**
   * Update the `completed` column of the specified audit task row.
   */
  def updateCompleted(auditTaskId: Int, completed: Boolean): DBIO[Int] = {
    auditTasks.filter(_.auditTaskId === auditTaskId).map(_.completed).update(completed)
  }

  /**
   * Update the progress columns (task_end, position, mission, audited_distance_m) of the specified audit task row.
   */
  def updateTaskProgress(
      auditTaskId: Int,
      timestamp: OffsetDateTime,
      lat: Double,
      lng: Double,
      missionId: Int,
      currMissionStart: Option[Point],
      auditedDistanceM: Option[Double]
  ): DBIO[Int] = {
    val q = auditTasks
      .filter(_.auditTaskId === auditTaskId)
      .map(t => (t.taskEnd, t.currentLat, t.currentLng, t.currentMissionId, t.currentMissionStart, t.auditedDistanceM))
    q.update((timestamp, lat, lng, Some(missionId), currMissionStart, auditedDistanceM))
  }

  /**
   * Update a single task's flag given the flag type and the status to change to.
   * @param auditTaskId ID of the task to update.
   * @param flag One of "low_quality", "incomplete", or "stale".
   * @param state The state to set the flag to.
   * @return Number of rows updated.
   */
  def updateTaskFlag(auditTaskId: Int, flag: String, state: Boolean): DBIO[Int] = {
    val q = for {
      t <- auditTasks if t.auditTaskId === auditTaskId
    } yield flagColumn(t, flag)

    q.update(state)
  }

  /**
   * Update all flags of a single type for tasks starting before a specified date.
   * @param userId ID of the user whose tasks we're updating.
   * @param date Date before which to update tasks.
   * @param flag One of "low_quality", "incomplete", or "stale".
   * @param state The state to set the flag to.
   * @return Number of rows updated.
   */
  def updateTaskFlagsBeforeDate(userId: String, date: OffsetDateTime, flag: String, state: Boolean): DBIO[Int] = {
    val q = for {
      t <- auditTasks if t.userId === userId && t.taskStart < date
    } yield flagColumn(t, flag)

    q.update(state)
  }

  /**
   * The column behind an admin-set task flag.
   *
   * @param flag One of "low_quality", "incomplete", or "stale".
   * @return That flag's column on the task.
   */
  private def flagColumn(t: AuditTaskTableDef, flag: String): Rep[Boolean] = flag match {
    case "low_quality" => t.lowQuality
    case "incomplete"  => t.incomplete
    case "stale"       => t.stale
  }

  /**
   * Syncs the machine-owned outdated_imagery flag against street_imagery (#4384).
   *
   * Sets the flag on completed audits that ended before their street's median_newest_capture -- i.e. at least half
   * the street's sampled points show imagery newer than the audit -- and clears it on flagged audits that fail that
   * test (e.g. after corrected imagery data), so the sync is idempotent in both directions. The set-pass also stamps
   * outdated_imagery_at and the clear-pass nulls it (#4928); since the set-pass only touches unflagged rows, the
   * stamp marks the false-to-true edge and survives re-runs, so "flagged since when" reads straight off the column.
   * The comparison is
   * deliberately NOT against newest_capture: a single newer pano (a partial re-drive, one stray corner pano) doesn't
   * invalidate the audit of a whole street, and re-audits are expensive enough that we err toward flagging too few
   * streets rather than too many (review consensus on #4649). Streets with no street_imagery row (or a NULL
   * median_newest_capture -- every street until the imagery-age poll has sampled it) are assumed up to date and never
   * flagged. The tutorial street is excluded. Unlike the manually-set flags above, this flag is never set by admins,
   * so the clear-pass owns every TRUE value -- including tutorial-street rows, which the set-pass can never produce.
   *
   * The two passes share one outdated test (`auditPredatesImagery`), so together they partition audit_task exactly and
   * the sync stays idempotent. Three details of that test:
   *
   *   - The strict < is deliberately conservative with GSV's varying-precision capture dates: a month-only capture
   *     date standardizes to the 1st, so an audit any time in that month is not flagged.
   *   - task_end is a timestamptz, so a bare ::date would resolve in the connection's TimeZone and could flip a
   *     borderline audit between runs. Pinning to UTC makes the comparison deterministic, and rounds in the
   *     conservative direction for Western-hemisphere cities (an evening audit lands on the next UTC day). For
   *     UTC-positive cities the rounding goes the other way: an audit in the first local hours of a capture month's
   *     1st lands on the previous UTC date and gets flagged despite covering the new imagery -- a narrow window
   *     (offset hours, once per capture month) accepted until the comparison uses each city's local timezone.
   *   - A capture date in the future is bad data (a bogus provider value, a typo'd import), not new imagery. An
   *     unguarded future date would flag every audit on the street -- including each fresh re-audit -- leaving it
   *     un-completable until the next poll happened to lower the median. Ignoring future dates here keeps the street
   *     routable and lets the flag clear itself once the bad row is corrected.
   *
   * @return (number of audits flagged, number of audits unflagged)
   */
  def syncOutdatedImageryFlags: DBIO[(Int, Int)] = {
    val auditPredatesImagery = """street_imagery.median_newest_capture IS NOT NULL
          AND street_imagery.median_newest_capture <= (now() AT TIME ZONE 'UTC')::date
          AND (audit_task.task_end AT TIME ZONE 'UTC')::date < street_imagery.median_newest_capture"""
    val setPass              = sqlu"""
      UPDATE audit_task
      SET outdated_imagery = TRUE, outdated_imagery_at = now()
      FROM street_imagery
      WHERE audit_task.street_edge_id = street_imagery.street_edge_id
          AND audit_task.completed
          AND NOT audit_task.outdated_imagery
          AND #$auditPredatesImagery
          AND #${FilteredTables.notTutorialStreet("audit_task.street_edge_id")};
    """
    val clearPass = sqlu"""
      UPDATE audit_task
      SET outdated_imagery = FALSE, outdated_imagery_at = NULL
      WHERE audit_task.outdated_imagery
          AND (
              audit_task.street_edge_id = #${FilteredTables.tutorialStreetId()}
              OR NOT EXISTS (
                  SELECT FROM street_imagery
                  WHERE street_imagery.street_edge_id = audit_task.street_edge_id
                      AND #$auditPredatesImagery
              )
          );
    """
    setPass.zip(clearPass)
  }
}
