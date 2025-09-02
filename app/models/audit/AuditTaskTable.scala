package models.audit

import com.google.inject.ImplementedBy
import models.region.RegionTableDef
import models.route.{AuditTaskUserRouteTableDef, RouteStreetTableDef, UserRouteTableDef}
import models.street._
import models.user.{RoleTableDef, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresProfile.api._
import models.utils.{ConfigTableDef, MyPostgresProfile}
import org.locationtech.jts.geom.{LineString, Point}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval

import java.time.OffsetDateTime
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
    currentLat: Float,
    currentLng: Float,
    startPointReversed: Boolean,
    currentMissionId: Option[Int],
    currentMissionStart: Option[Point],
    lowQuality: Boolean,
    incomplete: Boolean,
    stale: Boolean
)
case class NewTask(
    edgeId: Int,
    geom: LineString,
    currentLng: Float,
    currentLat: Float,
    wayType: String,             // OSM road type (residential, trunk, etc.).
    startPointReversed: Boolean, // Notes if we start at x1,y1 instead of x2,y2.
    taskStart: OffsetDateTime,
    completedByAnyUser: Boolean, // Notes if any user has audited this street.
    priority: Double,
    completed: Boolean,       // Notes if the user audited this street before (null if no corresponding user).
    auditTaskId: Option[Int], // If it's not actually a "new" task, include the audit_task_id.
    currentMissionId: Option[Int],
    currentMissionStart: Option[Point], // If a mission was started mid-task, the loc where it started.
    routeStreetId: Option[Int]
) // The route_street_id if this task is part of a route.
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

case class StreetEdgeWithAuditStatus(
    streetEdgeId: Int,
    geom: LineString,
    regionId: Int,
    wayType: String,
    audited: Boolean
)

class AuditTaskTableDef(tag: slick.lifted.Tag) extends Table[AuditTask](tag, "audit_task") {
  def auditTaskId: Rep[Int]                   = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId: Rep[Option[Int]]       = column[Option[Int]]("amt_assignment_id")
  def userId: Rep[String]                     = column[String]("user_id")
  def streetEdgeId: Rep[Int]                  = column[Int]("street_edge_id")
  def taskStart: Rep[OffsetDateTime]          = column[OffsetDateTime]("task_start")
  def taskEnd: Rep[OffsetDateTime]            = column[OffsetDateTime]("task_end")
  def completed: Rep[Boolean]                 = column[Boolean]("completed")
  def currentLat: Rep[Float]                  = column[Float]("current_lat")
  def currentLng: Rep[Float]                  = column[Float]("current_lng")
  def startPointReversed: Rep[Boolean]        = column[Boolean]("start_point_reversed")
  def currentMissionId: Rep[Option[Int]]      = column[Option[Int]]("current_mission_id")
  def currentMissionStart: Rep[Option[Point]] = column[Option[Point]]("current_mission_start")
  def lowQuality: Rep[Boolean]                = column[Boolean]("low_quality")
  def incomplete: Rep[Boolean]                = column[Boolean]("incomplete")
  def stale: Rep[Boolean]                     = column[Boolean]("stale")

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed, currentLat, currentLng,
    startPointReversed, currentMissionId, currentMissionStart, lowQuality, incomplete, stale) <> (
    (AuditTask.apply _).tupled,
    AuditTask.unapply
  )

//  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
//    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
//
//  def user: ForeignKeyQuery[UserTable, SidewalkUser] =
//    foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("audit_task_current_mission_id_fkey", currentMissionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[AuditTaskTable])
trait AuditTaskTableRepository {}

class AuditTaskTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends AuditTaskTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val auditTasks               = TableQuery[AuditTaskTableDef]
  val streetEdges              = TableQuery[StreetEdgeTableDef]
  val regions                  = TableQuery[RegionTableDef]
  val streetEdgeRegionTable    = TableQuery[StreetEdgeRegionTableDef]
  val configTable              = TableQuery[ConfigTableDef]
  val streetEdgePriorities     = TableQuery[StreetEdgePriorityTableDef]
  val userStats                = TableQuery[UserStatTableDef]
  val roleTable                = TableQuery[RoleTableDef]
  val userRoleTable            = TableQuery[UserRoleTableDef]
  val auditTaskIncompleteTable = TableQuery[AuditTaskIncompleteTableDef]
  val routeStreets             = TableQuery[RouteStreetTableDef]
  val userRoutes               = TableQuery[UserRouteTableDef]
  val auditTaskUserRoutes      = TableQuery[AuditTaskUserRouteTableDef]

  val activeTasks = auditTasks
    .joinLeft(auditTaskIncompleteTable)
    .on(_.auditTaskId === _.auditTaskId)
    .filter(x => !x._1.completed && x._2.isEmpty)
    .map(_._1)
  val completedTasks              = auditTasks.filter(_.completed)
  val streetEdgesWithoutDeleted   = streetEdges.filterNot(_.deleted)
  val regionsWithoutDeleted       = regions.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = for {
    _ser <- streetEdgeRegionTable
    _se  <- streetEdgesWithoutDeleted if _ser.streetEdgeId === _se.streetEdgeId
    _r   <- regionsWithoutDeleted if _ser.regionId === _r.regionId
  } yield _ser

  // Sub query with columns (street_edge_id, completed_by_any_user): (Int, Boolean).
  // TODO it would be better to only consider "good user" audits here, but it takes too long to calculate each time.
  def streetCompletedByAnyUser: Query[(Rep[Int], Rep[Boolean]), (Int, Boolean), Seq] = {
    // Completion count for audited streets.
    val completionCnt = completedTasks.groupBy(_.streetEdgeId).map { case (_street, group) => (_street, group.length) }

    // Gets completion count of 0 for unaudited streets w/ a left join, then checks if completion count is > 0.
    streetEdgesWithoutDeleted.joinLeft(completionCnt).on(_.streetEdgeId === _._1).map { case (_edge, _cnt) =>
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
   * Gets the list of streets in the specified region that the user has not audited.
   */
  def getStreetEdgeRegionsNotAuditedQuery(
      userId: String,
      regionId: Int
  ): Query[StreetEdgeRegionTableDef, StreetEdgeRegion, Seq] = {
    val edgesAuditedByUser = completedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map(_._1)

    nonDeletedStreetEdgeRegions
      .filter(_.regionId === regionId)
      .joinLeft(edgesAuditedByUser)
      .on(_.streetEdgeId === _)
      .filter(_._2.isEmpty)
      .map(_._1)
  }

  /**
   * Gets the list of streets in the specified region that the user has not audited.
   */
  def getStreetEdgeIdsNotAudited(user: String, regionId: Int): DBIO[Seq[Int]] = {
    getStreetEdgeRegionsNotAuditedQuery(user, regionId).map(_.streetEdgeId).result
  }

  /**
   * Get a set of regions where the user has explored all the street edges.
   */
  def getRegionsCompletedByUser(userId: String): DBIO[Seq[Int]] = {
    val edgesAuditedByUser = completedTasks.filter(_.userId === userId).groupBy(_.streetEdgeId).map(_._1)

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
   * Returns a true if the user has a completed audit task for the given street edge, false otherwise.
   */
  def userHasAuditedStreet(streetEdgeId: Int, user: String): DBIO[Boolean] = {
    completedTasks.filter(task => task.streetEdgeId === streetEdgeId && task.userId === user).exists.result
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

    // Filter out the duplicated street edges.
    val _distinctCompleted = _filteredTasks.groupBy(_.streetEdgeId).map(_._1)

    // Left join list of streets with list of audited streets to record whether each street has been audited.
    val streetsWithAuditedStatus = streetEdgesWithoutDeleted
      .join(streetEdgeRegionTable)
      .on(_.streetEdgeId === _.streetEdgeId)
      .filter(x => (x._2.regionId inSetBind regionIds) || regionIds.isEmpty)
      .joinLeft(_distinctCompleted)
      .on(_._1.streetEdgeId === _)
      .map(s => (s._1._1.streetEdgeId, s._1._1.geom, s._1._2.regionId, s._1._1.wayType, !s._2.isEmpty))

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
      _se <- streetEdges if _at.streetEdgeId === _se.streetEdgeId
      _ut <- userStats if _at.userId === _ut.userId
      _ur <- userRoleTable if _ut.userId === _ur.userId
      _r  <- roleTable if _ur.roleId === _r.roleId
    } yield (_se.streetEdgeId, _at.auditTaskId, _ut.userId, _r.role, _ut.highQuality, _at.taskStart, _at.taskEnd,
      _se.geom)
    auditedStreets.result.map(_.map(AuditedStreetWithTimestamp.tupled))
  }

  /**
   * Return street edges audited by the given user.
   */
  def getAuditedStreets(userId: String): DBIO[Seq[StreetEdge]] = {
    completedTasks
      .join(streetEdgesWithoutDeleted)
      .on(_.streetEdgeId === _.streetEdgeId)
      .filter(_._1.userId === userId)
      .map(_._2)
      .distinct
      .result
  }

  /**
   * Gets total distance audited by a user in meters.
   */
  def getDistanceAudited(userId: String): DBIO[Float] = {
    completedTasks
      .filter(_.userId === userId)
      .join(streetEdges)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map(_._2.geom.transform(26918).length)
      .sum
      .getOrElse(0f)
      .result
  }

  /**
   * Get the sum of the line distance of all streets in the region that the user has not audited.
   */
  def getUnauditedDistance(userId: String, regionId: Int): DBIO[Float] = {
    getStreetEdgeRegionsNotAuditedQuery(userId, regionId)
      .join(streetEdgesWithoutDeleted)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map(_._2.geom.transform(26918).length)
      .sum
      .result
      .map(_.getOrElse(0f))
  }

  /**
   * Get a new task specified by the street edge id.
   */
  def selectANewTask(
      streetEdgeId: Int,
      missionId: Int,
      reverseStartPoint: Boolean = false,
      routeStreetId: Option[Int] = None
  ): DBIO[NewTask] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now

    // Join with other queries to get completion count and priority for each of the street edges.
    val edges = for {
      se   <- streetEdgesWithoutDeleted if se.streetEdgeId === streetEdgeId
      scau <- streetCompletedByAnyUser if se.streetEdgeId === scau._1
      sep  <- streetEdgePriorities if scau._1 === sep.streetEdgeId
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
      routeStreetId
    )

    edges.result.head.map(NewTask.tupled)
  }

  /**
   * Get a NewTask object for the tutorial. Some dummy values are filled in specifically for the tutorial.
   */
  def getATutorialTask(missionId: Int): DBIO[NewTask] = {
    val timestamp: OffsetDateTime = OffsetDateTime.now
    streetEdges
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
          false, // completed is always false for a new task.
          None: Option[Int], // auditTaskId is None for a new task.
          missionId.asColumnOf[Option[Int]],
          None: Option[Point], // currentMissionStart is None for a new task.
          None: Option[Int] // routeStreetId is None for the tutorial task.
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
      se  <- streetEdgesWithoutDeleted if ser.streetEdgeId === se.streetEdgeId
      sp  <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc  <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
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
      false, // completed is false for a new task.
      None: Option[Int], // auditTaskId is None for a new task.
      Some(missionId).asColumnOf[Option[Int]],
      None: Option[Point], // currentMissionStart is None for a new task.
      None: Option[Int] // routeStreetId
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
   */
  def selectTaskFromTaskId(taskId: Int, routeStreetId: Option[Int] = None): DBIO[Option[NewTask]] = {
    val newTask = for {
      at <- activeTasks if at.auditTaskId === taskId
      se <- streetEdges if at.streetEdgeId === se.streetEdgeId
      sp <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc <- streetCompletedByAnyUser if sp.streetEdgeId === sc._1
    } yield (
      se.streetEdgeId, se.geom, at.currentLng, at.currentLat, se.wayType, at.startPointReversed, at.taskStart, sc._2,
      sp.priority, at.completed, at.auditTaskId.?, at.currentMissionId, at.currentMissionStart, routeStreetId
    )

    newTask.result.headOption.map(_.map(NewTask.tupled))
  }

  /**
   * Get tasks in the region. Called when a user begins auditing. Includes completed tasks, despite return type!
   */
  def selectTasksInARegion(regionId: Int, userId: String): DBIO[Seq[NewTask]] = {
    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    val userCompletedStreets = completedTasks
      .filter(_.userId === userId)
      .groupBy(_.streetEdgeId)
      .map(_._2.map(_.auditTaskId).max)
      .join(auditTasks)
      .on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)
    val tasks         = for {
      (ser, ucs) <- edgesInRegion.joinLeft(userCompletedStreets).on(_.streetEdgeId === _._1)
      se         <- streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep        <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau       <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
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
      ucs.isDefined, // completed is true if the user has audited this street before.
      ucs.map(_._3), // fill auditTaskId using the existing audit_task for this street if the user has one.
      ucs.map(_._4).flatten, // fill currentMissionId if the user has an existing mission for this street.
      ucs.map(_._5).flatten, // fill currentMissionStart if the user has an existing mission for this street.
      None: Option[Int]
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
      .join(streetEdgesWithoutDeleted)
      .on(_._2.streetEdgeId === _.streetEdgeId)
      .map { case ((_userRoute, _routeStreet), _streetEdge) => (_streetEdge, _routeStreet) }

    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    val userCompletedStreets = auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId)
      .join(completedTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .groupBy(_._2.streetEdgeId)
      .map(_._2.map(_._2.auditTaskId).max)
      .join(auditTasks)
      .on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val tasks = for {
      ((_se1, _rs), ucs) <- edgesInRoute.joinLeft(userCompletedStreets).on(_._1.streetEdgeId === _._1)
      _se2               <- streetEdges if _se1.streetEdgeId === _se2.streetEdgeId
      _sep               <- streetEdgePriorities if _se2.streetEdgeId === _sep.streetEdgeId
      _scau              <- streetCompletedByAnyUser if _sep.streetEdgeId === _scau._1
    } yield (
      _se2.streetEdgeId,
      _se2.geom,
      _se2.x1,
      _se2.y1,
      _se2.wayType,
      _rs.reverse,
      ucs.map(_._2).getOrElse(timestamp), // taskStart is now, or the existing task start if the user has one.
      _scau._2, // completedByAnyUser
      _sep.priority,
      ucs.isDefined, // completed is true if the user has audited this street before.
      ucs.map(_._3), // fill auditTaskId using the existing audit_task for this street if the user has one.
      ucs.flatMap(_._4), // fill currentMissionId if the user has an existing mission for this street.
      ucs.flatMap(_._5), // fill currentMissionStart if the user has an existing mission for this street.
      _rs.routeStreetId.asColumnOf[Option[Int]]
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
   * Update the `current_lat`, `current_lng`, `mission_id`, and `task_end` columns of the specified audit task row.
   */
  def updateTaskProgress(
      auditTaskId: Int,
      timestamp: OffsetDateTime,
      lat: Float,
      lng: Float,
      missionId: Int,
      currMissionStart: Option[Point]
  ): DBIO[Int] = {
    val q = auditTasks
      .filter(_.auditTaskId === auditTaskId)
      .map(t => (t.taskEnd, t.currentLat, t.currentLng, t.currentMissionId, t.currentMissionStart))
    q.update((timestamp, lat, lng, Some(missionId), currMissionStart))
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
}
