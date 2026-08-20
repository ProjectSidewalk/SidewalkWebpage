package models.audit

import com.google.inject.ImplementedBy
import models.mission.MissionTableDef
import models.mturk.AMTAssignmentTableDef
import models.region.RegionTableDef
import models.route.{AuditTaskUserRouteTableDef, RouteStreetTableDef, UserRouteTableDef}
import models.street._
import models.user.{RoleTableDef, SidewalkUserTableDef, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresProfile.api._
import models.utils.{ConfigTableDef, MyPostgresProfile}
import org.locationtech.jts.geom.{LineString, Point}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
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
    outdatedImagery: Boolean = false     // Machine-managed (#4384); mirrors the column's DEFAULT FALSE.
)
case class NewTask(
    edgeId: Int,
    geom: LineString,
    currentLng: Double,
    currentLat: Double,
    wayType: WayType.Value,      // OSM road type (residential, trunk, etc.).
    startPointReversed: Boolean, // Notes if we start at x1,y1 instead of x2,y2.
    taskStart: OffsetDateTime,
    completedByAnyUser: Boolean, // Notes if any user has audited this street.
    priority: Double,
    completed: Boolean,       // Notes if the user audited this street before (null if no corresponding user).
    auditTaskId: Option[Int], // If it's not actually a "new" task, include the audit_task_id.
    currentMissionId: Option[Int],
    currentMissionStart: Option[Point], // If a mission was started mid-task, the loc where it started.
    routeStreetId: Option[Int],         // The route_street_id if this task is part of a route.
    routeStreetPosition: Option[Int],   // The street's walking-order position within that route.
    maxSpeed: Option[String]            // Raw OSM maxspeed tag for the street's way (e.g. "25 mph"), if known.
)
case class AuditedStreetWithTimestamp(
    streetEdgeId: Int,
    auditTaskId: Int,
    userId: String,
    role: String,
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
    wayType: WayType.Value,
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

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed, currentLat, currentLng,
    startPointReversed, currentMissionId, currentMissionStart, lowQuality, incomplete, stale, auditedDistanceM,
    startOffsetM, outdatedImagery) <> (
    (AuditTask.apply _).tupled,
    AuditTask.unapply
  )

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
)(implicit ec: ExecutionContext)
    extends AuditTaskTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val auditTasks            = TableQuery[AuditTaskTableDef]
  val regions               = TableQuery[RegionTableDef]
  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTableDef]
  val configTable           = TableQuery[ConfigTableDef]
  val streetEdgePriorities  = TableQuery[StreetEdgePriorityTableDef]
  val userStats             = TableQuery[UserStatTableDef]
  val roleTable             = TableQuery[RoleTableDef]
  val userRoleTable         = TableQuery[UserRoleTableDef]
  val routeStreets          = TableQuery[RouteStreetTableDef]
  val userRoutes            = TableQuery[UserRouteTableDef]
  val auditTaskUserRoutes   = TableQuery[AuditTaskUserRouteTableDef]
  val streetImagery         = TableQuery[StreetImageryTableDef]

  val activeTasks    = auditTasks.filterNot(_.completed)
  val completedTasks = auditTasks.filter(_.completed)

  // Completed audits still valid against current imagery -- the set that routing and coverage queries should use.
  // Routing view: a street whose completed audits are all on since-replaced imagery reads as not-done here, so it is
  // re-offered to users. Credit/stats/completion queries use completedTasks instead -- an outdated audit still counts
  // as the user's work and as city-wide coverage (#4384).
  val upToDateCompletedTasks = completedTasks.filterNot(_.outdatedImagery)

  val regionsWithoutDeleted       = regions.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = for {
    _ser <- streetEdgeRegionTable
    _se  <- streetEdgeTable.streets if _ser.streetEdgeId === _se.streetEdgeId
    _r   <- regionsWithoutDeleted if _ser.regionId === _r.regionId
  } yield _ser

  // Sub query with columns (street_edge_id, completed_by_any_user): (Int, Boolean).
  // TODO it would be better to only consider "good user" audits here, but it takes too long to calculate each time.
  def streetCompletedByAnyUser: Query[(Rep[Int], Rep[Boolean]), (Int, Boolean), Seq] = {
    // Completion count for audited streets. Audits on since-replaced imagery don't count as completion (#4384).
    val completionCnt =
      upToDateCompletedTasks.groupBy(_.streetEdgeId).map { case (_street, group) => (_street, group.length) }

    // Gets completion count of 0 for unaudited streets w/ a left join, then checks if completion count is > 0.
    streetEdgeTable.streetsWithTutorial.joinLeft(completionCnt).on(_.streetEdgeId === _._1).map { case (_edge, _cnt) =>
      (_edge.streetEdgeId, _cnt.map(_._2).ifNull(0.asColumnOf[Int]) > 0)
    }
  }

  /**
   * Returns a count of the number of audits performed on each day with an audit.
   */
  def getAuditCountsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    completedTasks.map(_.taskEnd.trunc("day")).groupBy(x => x).map(x => (x._1, x._2.length)).sortBy(_._1).result
  }

  /**
   * Returns the number of Explore tasks (streets) completed in the specific time range.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def countCompletedAudits(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[Int] = {
    // Filter by the given time interval.
    val tasksInTimeInterval = timeInterval match {
      case TimeInterval.Today => completedTasks.filter(l => l.taskEnd > OffsetDateTime.now().minusDays(1))
      case TimeInterval.Week  => completedTasks.filter(l => l.taskEnd >= OffsetDateTime.now().minusDays(7))
      case _                  => completedTasks
    }

    tasksInTimeInterval.length.result
  }

  /**
   * Returns the number of tasks completed by the given user.
   */
  def countCompletedAuditsForUser(userId: String): DBIO[Int] = {
    completedTasks.filter(_.userId === userId).length.result
  }

  /**
   * Find a task.
   */
  def find(auditTaskId: Int): DBIO[Option[AuditTask]] = {
    auditTasks.filter(_.auditTaskId === auditTaskId).result.headOption
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
    val edgesAuditedByUser = upToDateCompletedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map(_._1)

    nonDeletedStreetEdgeRegions
      .filter(_.regionId === regionId)
      .joinLeft(edgesAuditedByUser)
      .on(_.streetEdgeId === _)
      .filter(_._2.isEmpty)
      .map(_._1)
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
    val edgesAuditedByUser = upToDateCompletedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map(_._1)

    // Get regions that the user _hasn't_ finished.
    val incompleteRegionIds = nonDeletedStreetEdgeRegions
      .joinLeft(edgesAuditedByUser)
      .on(_.streetEdgeId === _)
      .filter(_._2.isEmpty)
      .map(_._1.regionId)
      .groupBy(x => x)
      .map(_._1)

    // Any region that is not in the incompleteRegionIds list is a region that the user has completed.
    regionsWithoutDeleted
      .joinLeft(incompleteRegionIds)
      .on(_.regionId === _)
      .filter(_._2.isEmpty)
      .map(_._1.regionId)
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
    // Optionally filter out data marked as low quality.
    val _filteredTasks = if (filterLowQuality) {
      completedTasks
        .join(userStats)
        .on(_.userId === _.userId)
        .filter(_._2.highQuality)
        .map(_._1)
    } else {
      completedTasks
    }

    // Distinct streets with any completed audit, and with a completed audit on current imagery (#4384).
    val _distinctEverCompleted = _filteredTasks.groupBy(_.streetEdgeId).map(_._1)
    val _distinctUpToDate      = _filteredTasks.filterNot(_.outdatedImagery).groupBy(_.streetEdgeId).map(_._1)

    // Left join streets against both sets: audited = has an up-to-date audit; outdated = audited before, but every
    // audit predates newer imagery (needs re-audit). Unaudited streets match neither.
    val streetsWithAuditedStatus = streetEdgeTable.streets
      .join(streetEdgeRegionTable)
      .on(_.streetEdgeId === _.streetEdgeId)
      .filter(x => (x._2.regionId inSetBind regionIds) || regionIds.isEmpty)
      .joinLeft(_distinctUpToDate)
      .on(_._1.streetEdgeId === _)
      .joinLeft(_distinctEverCompleted)
      .on(_._1._1.streetEdgeId === _)
      .map { case (((street, region), upToDate), everCompleted) =>
        (
          street.streetEdgeId,
          street.geom,
          region.regionId,
          street.wayType,
          upToDate.isDefined,
          upToDate.isEmpty && everCompleted.isDefined
        )
      }

    // If routeIds are provided, filter out streets that are not part of the route.
    val streetsWithAuditedStatusFiltered = if (routeIds.nonEmpty) {
      routeStreets
        .filter(_.routeId inSetBind routeIds)
        .join(streetsWithAuditedStatus)
        .on(_.streetEdgeId === _._1)
        .map(_._2)
    } else {
      streetsWithAuditedStatus
    }

    db.run(streetsWithAuditedStatusFiltered.result).map(s => s.map(StreetEdgeWithAuditStatus.tupled))
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
      _r  <- roleTable if _ur.roleId === _r.roleId
    } yield (_se.streetEdgeId, _at.auditTaskId, _ut.userId, _r.role, _ut.highQuality, _at.taskStart, _at.taskEnd,
      _se.geom)
    auditedStreets.result.map(_.map(AuditedStreetWithTimestamp.tupled))
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
      .filter(_._1.userId === userId)
      .map(_._2)
      .distinct
      .map(street => (street, !hasUpToDateAudit(street.streetEdgeId)))
      .result
  }

  /**
   * Whether any completed audit of the street was made against the current imagery (#4384).
   *
   * Correlated on purpose: it compiles to an EXISTS that Postgres serves from audit_task's street_edge_id index,
   * driven by the handful of streets the outer query already narrowed to. The set-membership form ("street_edge_id
   * NOT IN (SELECT ...)") reads the same but builds its hash over every completed audit in the city first.
   */
  private def hasUpToDateAudit(streetEdgeId: Rep[Int]): Rep[Boolean] = {
    upToDateCompletedTasks.filter(_.streetEdgeId === streetEdgeId).exists
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
      .filterNot { case (streetEdgeId, _) => hasUpToDateAudit(streetEdgeId) }

    for {
      (streetEdgeId, lastAudited) <- userStreets
      _se                         <- streetEdgeTable.streets if _se.streetEdgeId === streetEdgeId
      _ser                        <- streetEdgeRegionTable if _ser.streetEdgeId === streetEdgeId
      _r                          <- regionsWithoutDeleted if _r.regionId === _ser.regionId
    } yield (_se, _r, lastAudited)
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
      .on(_._1.streetEdgeId === _.streetEdgeId)
      .map { case ((_se, _r, lastAudited), _si) =>
        (_se.streetEdgeId, _r.regionId, _r.name, _se.geom.lengthGeodesic, _si.flatMap(_.medianNewestCapture),
          lastAudited)
      }
      .sortBy { case (streetEdgeId, _, _, _, _, lastAudited) => (lastAudited.asc.nullsLast, streetEdgeId.asc) }
      .take(limit)
      .result
      .map(_.map(OutdatedStreetForUser.tupled))
  }

  /**
   * Gets total distance audited by a user in meters.
   */
  def getDistanceAudited(userId: String): DBIO[Double] = {
    completedTasks
      .filter(_.userId === userId)
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map(_._2.geom.lengthGeodesic)
      .sum
      .getOrElse(0d)
      .result
  }

  /**
   * Get the sum of the line distance of all streets in the region that the user has not audited.
   */
  def getUnauditedDistance(userId: String, regionId: Int): DBIO[Double] = {
    getStreetEdgeRegionsNotAuditedQuery(userId, regionId)
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map(_._2.geom.lengthGeodesic)
      .sum
      .result
      .map(_.getOrElse(0d))
  }

  /**
   * Get a new task specified by the street edge id.
   */
  def selectANewTask(
      streetEdgeId: Int,
      missionId: Int,
      reverseStartPoint: Boolean = false,
      routeStreetId: Option[Int] = None,
      routeStreetPosition: Option[Int] = None
  ): DBIO[NewTask] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now

    // Join with other queries to get completion count and priority for each of the street edges.
    val edges = for {
      se   <- streetEdgeTable.streets if se.streetEdgeId === streetEdgeId
      scau <- streetCompletedByAnyUser if se.streetEdgeId === scau._1
      sep  <- streetEdgePriorities if scau._1 === sep.streetEdgeId
      sms  <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === sms._1
    } yield (
      se.streetEdgeId,
      se.geom,
      if (reverseStartPoint) se.x2 else se.x1,
      if (reverseStartPoint) se.y2 else se.y1,
      se.wayType,
      reverseStartPoint,
      timestamp,
      scau._2, // completedByAnyUser
      sep.priority,
      false,             // completed
      None: Option[Int], // auditTaskId is None for a new task.
      Some(missionId).asColumnOf[Option[Int]],
      None: Option[Point], // currentMissionStart is None for a new task.
      routeStreetId,
      routeStreetPosition,
      sms._2 // maxSpeed
    )

    edges.result.head.map(NewTask.tupled)
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
          None: Option[Point], // currentMissionStart is None for a new task.
          None: Option[Int],   // routeStreetId is None for the tutorial task.
          None: Option[Int],   // routeStreetPosition is None for the tutorial task.
          None: Option[String] // maxSpeed isn't shown during the tutorial.
        )
      }
      .result
      .map(t => NewTask.tupled(t.head))
  }

  /**
   * Get a task that is in a given region. Used if a user has already been assigned a region, or if regionId is passed.
   * TODO this isn't a simple CRUD operation, so it should probably go in a Service file.
   */
  def selectANewTaskInARegion(regionId: Int, userId: String, missionId: Int): DBIO[Option[NewTask]] = {
    // Get streets the user hasn't completed. Then join w/ other queries to get completion count and priority.
    val possibleTasks = for {
      ser <- getStreetEdgeRegionsNotAuditedQuery(userId, regionId)
      se  <- streetEdgeTable.streets if ser.streetEdgeId === se.streetEdgeId
      sp  <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc  <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
      sms <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === sms._1
    } yield (
      se.streetEdgeId,
      se.geom,
      se.x1,
      se.y1,
      se.wayType,
      false, // startPointReversed is false by default.
      OffsetDateTime.now,
      sc._2, // completedByAnyUser
      sp.priority,
      false,             // completed is false for a new task.
      None: Option[Int], // auditTaskId is None for a new task.
      Some(missionId).asColumnOf[Option[Int]],
      None: Option[Point], // currentMissionStart is None for a new task.
      None: Option[Int],   // routeStreetId
      None: Option[Int],   // routeStreetPosition
      sms._2               // maxSpeed
    )

    // Get the priority of the highest priority task.
    possibleTasks.map(_._9).max.result.flatMap {
      case Some(maxPriority) =>
        // Choose one of the highest priority tasks at random.
        val rand = SimpleFunction.nullary[Double]("random")
        possibleTasks.filter(_._9 === maxPriority).sortBy(_ => rand).result.map(_.headOption.map(NewTask.tupled))
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
   */
  def selectTaskFromTaskId(
      taskId: Int,
      routeStreetId: Option[Int] = None,
      routeStreetPosition: Option[Int] = None,
      includeCompleted: Boolean = false
  ): DBIO[Option[NewTask]] = {
    val matchingTasks = if (includeCompleted) auditTasks else activeTasks
    val newTask       = for {
      at  <- matchingTasks if at.auditTaskId === taskId
      se  <- streetEdgeTable.streetsWithTutorial if at.streetEdgeId === se.streetEdgeId
      sp  <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc  <- streetCompletedByAnyUser if sp.streetEdgeId === sc._1
      sms <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === sms._1
    } yield (
      se.streetEdgeId, se.geom, at.currentLng, at.currentLat, se.wayType, at.startPointReversed, at.taskStart, sc._2,
      sp.priority, at.completed, at.auditTaskId.?, at.currentMissionId, at.currentMissionStart, routeStreetId,
      routeStreetPosition, sms._2
    )

    newTask.result.headOption.map(_.map(NewTask.tupled))
  }

  /**
   * Get tasks in the region. Called when a user begins auditing. Includes completed tasks, despite return type!
   */
  def selectTasksInARegion(regionId: Int, userId: String): DBIO[Seq[NewTask]] = {
    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    // Only audits with up-to-date imagery count: a street re-imaged since the user's audit comes back as an available
    // task (completed=false, no audit_task_id), so the Explore mini-map and next-task logic re-offer it (#4384).
    val userCompletedStreets = upToDateCompletedTasks
      .filter(_.userId === userId)
      .groupBy(_.streetEdgeId)
      .map(_._2.map(_.auditTaskId).max)
      .join(auditTasks)
      .on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)
    val tasks         = for {
      (ser, ucs) <- edgesInRegion.joinLeft(userCompletedStreets).on(_.streetEdgeId === _._1)
      se         <- streetEdgeTable.streets if ser.streetEdgeId === se.streetEdgeId
      sep        <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau       <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
      sms        <- osmWayTable.streetMaxSpeeds if se.streetEdgeId === sms._1
    } yield (
      se.streetEdgeId,
      se.geom,
      se.x1,
      se.y1,
      se.wayType,
      false, // startPointReversed is false by default.
      ucs.map(_._2).getOrElse(OffsetDateTime.now),
      scau._2, // completedByAnyUser
      sep.priority,
      ucs.isDefined,         // completed is true if the user has audited this street before.
      ucs.map(_._3),         // fill auditTaskId using the existing audit_task for this street if the user has one.
      ucs.map(_._4).flatten, // fill currentMissionId if the user has an existing mission for this street.
      ucs.map(_._5).flatten, // fill currentMissionStart if the user has an existing mission for this street.
      None: Option[Int],     // routeStreetId
      None: Option[Int],     // routeStreetPosition
      sms._2                 // maxSpeed
    )

    tasks.result.map(_.map(NewTask.tupled(_)))
  }

  /**
   * Gets a list of tasks associated with a user's route.
   * @param userRouteId ID of the user_route.
   */
  def selectTasksInRoute(userRouteId: Int): DBIO[Seq[NewTask]] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now

    val edgesInRoute = userRoutes
      .filter(_.userRouteId === userRouteId)
      .join(routeStreets)
      .on(_.routeId === _.routeId)
      .join(streetEdgeTable.streets)
      .on(_._2.streetEdgeId === _.streetEdgeId)
      .map { case ((_userRoute, _routeStreet), _streetEdge) => (_streetEdge, _routeStreet) }

    // Get task_start, audit_task_id, current_mission_id, and current_mission_start for the route's streets the user
    // has audited. If there are multiple for the same one, choose most recent (one w/ the highest audit_task_id).
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
      .groupBy(_._1.routeStreetId)
      .map(_._2.map(_._2.auditTaskId).max)

    val userCompletedStreets = auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId)
      .join(auditTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .filter { case (_, auditTask) => auditTask.auditTaskId.? in latestCompletedTaskIds }
      .map { case (link, auditTask) =>
        (link.routeStreetId, auditTask.taskStart, auditTask.auditTaskId, auditTask.currentMissionId,
          auditTask.currentMissionStart)
      }

    val tasks = for {
      ((_se1, _rs), ucs) <- edgesInRoute.joinLeft(userCompletedStreets).on(_._2.routeStreetId === _._1)
      _se2               <- streetEdgeTable.streets if _se1.streetEdgeId === _se2.streetEdgeId
      _sep               <- streetEdgePriorities if _se2.streetEdgeId === _sep.streetEdgeId
      _scau              <- streetCompletedByAnyUser if _sep.streetEdgeId === _scau._1
      _sms               <- osmWayTable.streetMaxSpeeds if _se2.streetEdgeId === _sms._1
    } yield (
      _se2.streetEdgeId,
      _se2.geom,
      _se2.x1,
      _se2.y1,
      _se2.wayType,
      _rs.reverse,
      ucs.map(_._2).getOrElse(timestamp), // taskStart is now, or the existing task start if the user has one.
      _scau._2,                           // completedByAnyUser
      _sep.priority,
      ucs.isDefined,     // completed is true if the user has audited this street before.
      ucs.map(_._3),     // fill auditTaskId using the existing audit_task for this street if the user has one.
      ucs.flatMap(_._4), // fill currentMissionId if the user has an existing mission for this street.
      ucs.flatMap(_._5), // fill currentMissionStart if the user has an existing mission for this street.
      _rs.routeStreetId.asColumnOf[Option[Int]],
      _rs.position.asColumnOf[Option[Int]],
      _sms._2 // maxSpeed
    )

    tasks.result.map(_.map(NewTask.tupled(_)))
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
    } yield flag match {
      case "low_quality" => t.lowQuality
      case "incomplete"  => t.incomplete
      case "stale"       => t.stale
    }

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
    } yield flag match {
      case "low_quality" => t.lowQuality
      case "incomplete"  => t.incomplete
      case "stale"       => t.stale
    }

    q.update(state)
  }

  /**
   * Syncs the machine-owned outdated_imagery flag against street_imagery (#4384).
   *
   * Sets the flag on completed audits that ended before their street's median_newest_capture -- i.e. at least half
   * the street's sampled points show imagery newer than the audit -- and clears it on flagged audits that fail that
   * test (e.g. after corrected imagery data), so the sync is idempotent in both directions. The comparison is
   * deliberately NOT against newest_capture: a single newer pano (a partial re-drive, one stray corner pano) doesn't
   * invalidate the audit of a whole street, and re-audits are expensive enough that we err toward flagging too few
   * streets rather than too many (review consensus on #4649). Streets with no street_imagery row (or a NULL
   * median_newest_capture -- every street until the imagery-age poll has sampled it) are assumed up to date and never
   * flagged. The tutorial street is excluded. Unlike the manually-set flags above, this flag is never set by admins,
   * so the clear-pass owns every TRUE value -- including tutorial-street rows, which the set-pass can never produce.
   *
   * The two passes apply the *same* outdated test, so together they partition audit_task exactly; any change to one
   * predicate has to be mirrored in the other or the sync stops being idempotent. Three details of that test:
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
    val setPass = sqlu"""
      UPDATE audit_task
      SET outdated_imagery = TRUE
      FROM street_imagery
      WHERE audit_task.street_edge_id = street_imagery.street_edge_id
          AND audit_task.completed
          AND NOT audit_task.outdated_imagery
          AND street_imagery.median_newest_capture IS NOT NULL
          AND street_imagery.median_newest_capture <= (now() AT TIME ZONE 'UTC')::date
          AND (audit_task.task_end AT TIME ZONE 'UTC')::date < street_imagery.median_newest_capture
          AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config);
    """
    val clearPass = sqlu"""
      UPDATE audit_task
      SET outdated_imagery = FALSE
      WHERE audit_task.outdated_imagery
          AND (
              audit_task.street_edge_id = (SELECT tutorial_street_edge_id FROM config)
              OR NOT EXISTS (
                  SELECT FROM street_imagery
                  WHERE street_imagery.street_edge_id = audit_task.street_edge_id
                      AND street_imagery.median_newest_capture IS NOT NULL
                      AND street_imagery.median_newest_capture <= (now() AT TIME ZONE 'UTC')::date
                      AND (audit_task.task_end AT TIME ZONE 'UTC')::date < street_imagery.median_newest_capture
              )
          );
    """
    setPass.zip(clearPass)
  }
}
