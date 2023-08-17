package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString, Point}
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import models.street._
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable}
import models.street.StreetEdgePriorityTable
import models.user.{UserRoleTable, UserStatTable}
import models.mission.{Mission, MissionTable}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int,
                     taskStart: Timestamp, taskEnd: Timestamp, completed: Boolean, currentLat: Float, currentLng: Float,
                     startPointReversed: Boolean, currentMissionId: Option[Int], currentMissionStart: Option[Point])
case class NewTask(edgeId: Int, geom: LineString,
                   currentLng: Float, currentLat: Float,
                   wayType: String, // OSM road type (residential, trunk, etc.).
                   startPointReversed: Boolean, // Notes if we start at x1,y1 instead of x2,y2.
                   taskStart: Timestamp,
                   completedByAnyUser: Boolean, // Notes if any user has audited this street.
                   priority: Double,
                   completed: Boolean, // Notes if the user audited this street before (null if no corresponding user).
                   auditTaskId: Option[Int], // If it's not actually a "new" task, include the audit_task_id.
                   currentMissionId: Option[Int],
                   currentMissionStart: Option[Point], // If a mission was started mid-task, the loc where it started.
                   routeStreetId: Option[Int] // The route_street_id if this task is part of a route.
                  )  {
  /**
    * Converts the data into the GeoJSON format.
    */
  def toJSON: JsObject = {
    val coordinates: Array[Coordinate] = geom.getCoordinates
    val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
    val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
    val properties = Json.obj(
      "street_edge_id" -> edgeId,
      "current_lng" -> currentLng,
      "current_lat" -> currentLat,
      "way_type" -> wayType,
      "start_point_reversed" -> startPointReversed,
      "task_start" -> taskStart.toString,
      "completed_by_any_user" -> completedByAnyUser,
      "priority" -> priority,
      "completed" -> completed,
      "audit_task_id" -> auditTaskId,
      "current_mission_id" -> currentMissionId,
      "current_mission_start" -> currentMissionStart.map(p => geojson.LatLng(p.getY, p.getX)),
      "route_street_id" -> routeStreetId
    )
    val feature: JsObject = Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    Json.obj("type" -> "FeatureCollection", "features" -> List(feature))
  }
}
case class AuditedStreetWithTimestamp(streetEdgeId: Int, auditTaskId: Int,
                                      userId: String, role: String, highQuality: Boolean,
                                      taskStart: Timestamp, taskEnd: Timestamp,
                                      geom: LineString) {
  def toGeoJSON: JsObject = {
    val coordinates: Array[Coordinate] = geom.getCoordinates
    val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
    val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
    val properties = Json.obj(
      "street_edge_id" -> streetEdgeId,
      "audit_task_id" -> auditTaskId,
      "user_id" -> userId,
      "role" -> role,
      "high_quality_user" -> highQuality,
      "task_start" -> taskStart.toString,
      "task_end" -> taskEnd.toString
    )
    Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
  }
}

case class StreetEdgeWithAuditStatus(streetEdgeId: Int, geom: LineString, regionId: Int, wayType: String, audited: Boolean)

class AuditTaskTable(tag: slick.lifted.Tag) extends Table[AuditTask](tag, Some("sidewalk"), "audit_task") {
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id", O.Nullable)
  def userId = column[String]("user_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def taskStart = column[Timestamp]("task_start", O.NotNull)
  def taskEnd = column[Timestamp]("task_end", O.NotNull)
  def completed = column[Boolean]("completed", O.NotNull)
  def currentLat = column[Float]("current_lat", O.NotNull)
  def currentLng = column[Float]("current_lng", O.NotNull)
  def startPointReversed = column[Boolean]("start_point_reversed", O.NotNull)
  def currentMissionId = column[Option[Int]]("current_mission_id", O.Nullable)
  def currentMissionStart = column[Option[Point]]("current_mission_start", O.Nullable)

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed, currentLat, currentLng, startPointReversed, currentMissionId, currentMissionStart) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_current_mission_id_fkey", currentMissionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task table.
 */
object AuditTaskTable {
  import MyPostgresDriver.plainImplicits._

  implicit val auditTaskConverter = GetResult[AuditTask](r => {
    AuditTask(r.nextInt, r.nextIntOption, r.nextString, r.nextInt, r.nextTimestamp, r.nextTimestamp, r.nextBoolean,
      r.nextFloat, r.nextFloat, r.nextBoolean, r.nextIntOption, r.nextGeometryOption[Point])
  })

  implicit val newTaskConverter = GetResult[NewTask](r => {
    NewTask(r.nextInt, r.nextGeometry[LineString], r.nextFloat, r.nextFloat, r.nextString, r.nextBoolean,
      r.nextTimestamp, r.nextBoolean, r.nextDouble, r.nextBooleanOption.getOrElse(false), r.nextIntOption,
      r.nextIntOption, r.nextGeometryOption[Point], r.nextIntOption)
  })

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTable]
  val users = TableQuery[UserTable]

  val activeTasks = auditTasks
    .leftJoin(AuditTaskIncompleteTable.incompletes).on(_.auditTaskId === _.auditTaskId)
    .filter(x => !x._1.completed && x._2.auditTaskIncompleteId.?.isEmpty)
    .map(_._1)
  val completedTasks = auditTasks.filter(_.completed)
  val streetEdgesWithoutDeleted = streetEdges.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = StreetEdgeRegionTable.nonDeletedStreetEdgeRegions

  // Sub query with columns (street_edge_id, completed_by_any_user): (Int, Boolean).
  // TODO it would be better to only consider "good user" audits here, but it takes too long to calculate each time.
  def streetCompletedByAnyUser: Query[(Column[Int], Column[Boolean]), (Int, Boolean), Seq] = {
    // Completion count for audited streets.
    val completionCnt = completedTasks.groupBy(_.streetEdgeId).map { case (_street, group) => (_street, group.length) }

    // Gets completion count of 0 for unaudited streets w/ a left join, then checks if completion count is > 0.
    streetEdgesWithoutDeleted.leftJoin(completionCnt).on(_.streetEdgeId === _._1).map {
      case (_edge, _cnt) => (_edge.streetEdgeId, _cnt._2.ifNull(0.asColumnOf[Int]) > 0)
    }
  }

  case class AuditCountPerDay(date: String, count: Int)
  case class AuditTaskWithALabel(userId: String, username: String, auditTaskId: Int, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Timestamp, labelId: Option[Int], temporaryLabelId: Option[Int], labelType: Option[String])

  /**
    * Returns a count of the number of audits performed on each day with audits.
    */
  def auditCounts: List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date, COUNT(audit_task_id)
        |FROM (
        |    SELECT audit_task_id, task_start::date AS calendar_date
        |    FROM audit_task
        |) AS calendar
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectAuditCountQuery.list.map(x => AuditCountPerDay.tupled(x))
  }

  /**
    * Returns the number of tasks completed.
    */
  def countCompletedAudits: Int = db.withSession { implicit session =>
    completedTasks.length.run
  }

  /**
    * Returns the number of tasks completed today.
    */
  def countCompletedAuditsToday: Int = db.withSession { implicit session =>
    val countTasksQuery = Q.queryNA[Int](
      """SELECT COUNT(audit_task_id)
        |FROM audit_task
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
        |    AND audit_task.completed = TRUE""".stripMargin
    )
    countTasksQuery.first
  }

  /**
    * Returns the number of tasks completed.
    */
  def countCompletedAuditsPastWeek: Int = db.withSession { implicit session =>
    val countTasksQuery = Q.queryNA[Int](
      """SELECT COUNT(audit_task_id)
        |FROM audit_task
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
        |    AND audit_task.completed = TRUE""".stripMargin
    )
    countTasksQuery.first
  }

  /**
    * Returns the number of tasks completed by the given user.
    */
  def countCompletedAudits(userId: UUID): Int = db.withSession { implicit session =>
    completedTasks.filter(_.userId === userId.toString).length.run
  }

  /**
    * Find a task.
    */
  def find(auditTaskId: Int): Option[AuditTask] = db.withSession { implicit session =>
    val auditTaskList = auditTasks.filter(_.auditTaskId === auditTaskId).list
    auditTaskList.headOption
  }

  /**
    * Gets list streets that the user has not audited.
    */
  def getStreetEdgeIdsNotAudited(user: UUID): List[Int] = db.withSession { implicit session =>

    val edgesAuditedByUser: List[Int] =
      completedTasks.filter(_.userId === user.toString).groupBy(_.streetEdgeId).map(_._1).list

    streetEdgesWithoutDeleted.filterNot(_.streetEdgeId inSet edgesAuditedByUser).map(_.streetEdgeId).list
  }

  /**
    * Gets the list of streets in the specified region that the user has not audited.
    */
  def getStreetEdgeIdsNotAudited(user: UUID, regionId: Int): List[Int] = db.withSession { implicit session =>

    val edgesAuditedByUser: List[Int] =
      completedTasks.filter(_.userId === user.toString).groupBy(_.streetEdgeId).map(_._1).list

    val unAuditedEdges = for {
      _ser <- nonDeletedStreetEdgeRegions if _ser.regionId === regionId
      _edges <- streetEdges if _ser.streetEdgeId === _edges.streetEdgeId
      if !(_edges.streetEdgeId inSet edgesAuditedByUser)
    } yield _edges

    unAuditedEdges.map(_.streetEdgeId).list
  }

  /**
    * Returns a list of streetEdgeIds for streets that were completed after the specified time in the given region.
    */
  def streetsCompletedAfterTime(regionId: Int, timestamp: Timestamp): List[Int] = db.withSession { implicit session =>
    (for {
      at <- completedTasks if at.taskEnd > timestamp
      ser <- nonDeletedStreetEdgeRegions if at.streetEdgeId === ser.streetEdgeId
      if ser.regionId === regionId
    } yield ser.streetEdgeId).list
  }

  /**
    * Check if there are tasks available for the user in the given region.
    */
  def isTaskAvailable(user: UUID, regionId: Int): Boolean = db.withSession { implicit session =>

    val availableTasks: Int = getStreetEdgeIdsNotAudited(user, regionId).length
    availableTasks > 0
  }

  /**
    * Get a set of regions where the user has not completed all the street edges.
    */
  def selectIncompleteRegions(user: UUID): Set[Int] = db.withSession { implicit session =>
    nonDeletedStreetEdgeRegions
      .filter(_.streetEdgeId inSet getStreetEdgeIdsNotAudited(user))
      .map(_.regionId)
      .list.toSet
  }

  /**
    * Return a list of tasks associated with labels.
    */
  def selectTasksWithLabels(userId: UUID): List[AuditTaskWithALabel] = db.withSession { implicit session =>
    val userTasks = for {
      (_users, _tasks) <- users.innerJoin(auditTasks).on(_.userId === _.userId)
      if _users.userId === userId.toString
    } yield (_users.userId, _users.username, _tasks.auditTaskId, _tasks.streetEdgeId, _tasks.taskStart, _tasks.taskEnd)

    val userTaskLabels = for {
      (_userTasks, _labels) <- userTasks.leftJoin(LabelTable.labelsWithExcludedUsers).on(_._3 === _.auditTaskId)
    } yield (_userTasks._1, _userTasks._2, _userTasks._3, _userTasks._4, _userTasks._5, _userTasks._6, _labels.labelId.?, _labels.temporaryLabelId, _labels.labelTypeId.?)

    val tasksWithLabels = for {
      (_labelTypes, _userTaskLabels) <- labelTypes.innerJoin(userTaskLabels).on(_.labelTypeId === _._9)
    } yield (_userTaskLabels._1, _userTaskLabels._2, _userTaskLabels._3, _userTaskLabels._4, _userTaskLabels._5, _userTaskLabels._6, _userTaskLabels._7, _userTaskLabels._8, _labelTypes.labelType.?)

    tasksWithLabels.list.map(x => AuditTaskWithALabel.tupled(x))
  }

  /**
    * Returns a true if the user has a completed audit task for the given street edge, false otherwise.
    */
  def userHasAuditedStreet(streetEdgeId: Int, user: UUID): Boolean = db.withSession { implicit session =>
    completedTasks.filter(task => task.streetEdgeId === streetEdgeId && task.userId === user.toString).list.nonEmpty
  }

  /**
    * Return all street edges and whether they have been audited or not. If provided, filter for only given regions.
    */
  def selectStreetsWithAuditStatus(filterLowQuality: Boolean, regionIds: List[Int]): List[StreetEdgeWithAuditStatus] = db.withSession { implicit session =>
    // Optionally filter out data marked as low quality.
    val _filteredTasks = if (filterLowQuality) {
      for {
        _ct <- completedTasks
        _ut <- UserStatTable.userStats if _ct.userId === _ut.userId
        if _ut.highQuality
      } yield _ct
    } else {
      completedTasks
    }

    // Filter out the duplicated street edges.
    val _distinctCompleted = _filteredTasks.groupBy(_.streetEdgeId).map(_._1)

    // Left join list of streets with list of audited streets to record whether each street has been audited.
    val streetsWithAuditedStatus = streetEdgesWithoutDeleted
      .innerJoin(StreetEdgeRegionTable.streetEdgeRegionTable).on(_.streetEdgeId === _.streetEdgeId)
      .filter(x => (x._2.regionId inSet regionIds) || regionIds.isEmpty)
      .leftJoin(_distinctCompleted).on(_._1.streetEdgeId === _)
      .map(s => (s._1._1.streetEdgeId, s._1._1.geom, s._1._2.regionId, s._1._1.wayType, !s._2.?.isEmpty))

    streetsWithAuditedStatus.list.map(StreetEdgeWithAuditStatus.tupled)
  }

  /**
   * Get the streets that have been audited, with the time they were audited, and metadata about the user who audited.
   */
  def getAuditedStreetsWithTimestamps: List[AuditedStreetWithTimestamp] = db.withSession { implicit session =>
    val auditedStreets = for {
      _at <- completedTasks
      _se <- streetEdges if _at.streetEdgeId === _se.streetEdgeId
      _ut <- UserStatTable.userStats if _at.userId === _ut.userId
      _ur <- UserRoleTable.userRoles if _ut.userId === _ur.userId
      _r <- UserRoleTable.roles if _ur.roleId === _r.roleId
    } yield (_se.streetEdgeId, _at.auditTaskId, _ut.userId, _r.role, _ut.highQuality, _at.taskStart, _at.taskEnd, _se.geom)
    auditedStreets.list.map(AuditedStreetWithTimestamp.tupled)
  }

  /**
   * Return street edges audited by the given user.
   */
  def getAuditedStreets(userId: UUID): List[StreetEdge] =  db.withSession { implicit session =>
    val _streetEdges = for {
      (_tasks, _edges) <- completedTasks.innerJoin(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
      if _tasks.userId === userId.toString
    } yield _edges

    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }

  /**
    * Gets total distance audited by a user in meters.
    */
  def getDistanceAudited(userId: UUID): Float = db.withSession { implicit session =>
    completedTasks
      .filter(_.userId === userId.toString)
      .innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId)
      .map(_._2.geom.transform(26918).length)
      .sum.run.getOrElse(0F)
  }

  /**
    * Get the sum of the line distance of all streets in the region that the user has not audited.
    */
  def getUnauditedDistance(userId: UUID, regionId: Int): Float = db.withSession { implicit session =>
    val streetsLeft: List[Int] = getStreetEdgeIdsNotAudited(userId, regionId)
    streetEdgesWithoutDeleted.filter(_.streetEdgeId inSet streetsLeft).map(_.geom.transform(26918).length).list.sum
  }

  /**
    * Get a new task specified by the street edge id. Used when calling the /explore/street route.
    */
  def selectANewTask(streetEdgeId: Int, missionId: Int, reverseStartPoint: Boolean = false, routeStreetId: Option[Int] = None): NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Join with other queries to get completion count and priority for each of the street edges.
    val edges = for {
      se <- streetEdgesWithoutDeleted if se.streetEdgeId === streetEdgeId
      scau <- streetCompletedByAnyUser if se.streetEdgeId === scau._1
      sep <- streetEdgePriorities if scau._1 === sep.streetEdgeId
    } yield (se.streetEdgeId, se.geom, if (reverseStartPoint) se.x2 else se.x1, if (reverseStartPoint) se.y2 else se.y1, se.wayType, reverseStartPoint, timestamp, scau._2, sep.priority, false, None: Option[Int], Some(missionId).asColumnOf[Option[Int]], None: Option[Point], routeStreetId)

    NewTask.tupled(edges.first)
  }

  /**
   * Get a NewTask object for the tutorial. Some dummy values are filled in specifically for the tutorial.
   */
  def getATutorialTask(missionId: Int): NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val tutorialTask = streetEdges
      .filter(_.streetEdgeId === LabelTable.tutorialStreetId)
      .map(e => (e.streetEdgeId, e.geom, e.x1, e.y1, e.wayType, false, timestamp, false, 1.0, false, None: Option[Int], missionId.asColumnOf[Option[Int]], None: Option[Point], None: Option[Int]))
    NewTask.tupled(tutorialTask.first)
  }

  /**
   * Get a task that is in a given region. Used if a user has already been assigned a region, or from /explore/region.
   */
  def selectANewTaskInARegion(regionId: Int, user: UUID, missionId: Int): Option[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Get the streets that the user has not already completed.
    val edgesInRegion = streetEdges.filter(_.streetEdgeId inSet getStreetEdgeIdsNotAudited(user, regionId))

    // Join with other queries to get completion count and priority for each of the street edges.
    val possibleTasks = for {
      sp <- streetEdgePriorities
      se <- edgesInRegion if sp.streetEdgeId === se.streetEdgeId
      sc <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
    } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.wayType, false, timestamp, sc._2, sp.priority, false, None: Option[Int], Some(missionId).asColumnOf[Option[Int]], None: Option[Point], None: Option[Int])

    // Get the priority of the highest priority task.
    val highestPriority: Option[Double] = possibleTasks.map(_._9).max.run

    // Get list of tasks that have this priority.
    val highestPriorityTasks: Option[List[NewTask]] = highestPriority.map { highPriority =>
      possibleTasks.filter(_._9 === highPriority).list.map(NewTask.tupled)
    }

    // Choose one of the highest priority tasks at random.
    highestPriorityTasks.flatMap(scala.util.Random.shuffle(_).headOption)
  }

  /**
    * Gets the metadata for a task from its audit_task_id.
    */
  def selectTaskFromTaskId(taskId: Int, routeStreetId: Option[Int] = None): Option[NewTask] = db.withSession { implicit session =>
    val newTask = for {
      at <- activeTasks if at.auditTaskId === taskId
      se <- streetEdges if at.streetEdgeId === se.streetEdgeId
      sp <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc <- streetCompletedByAnyUser if sp.streetEdgeId === sc._1
    } yield (se.streetEdgeId, se.geom, at.currentLng, at.currentLat, se.wayType, at.startPointReversed, at.taskStart, sc._2, sp.priority, at.completed, at.auditTaskId.?, at.currentMissionId, at.currentMissionStart, routeStreetId)

    newTask.firstOption.map(NewTask.tupled)
  }

  /**
    * Get tasks in the region. Called when a user begins auditing. Includes completed tasks, despite return type!
    */
  def selectTasksInARegion(regionId: Int, user: UUID): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)

    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    val userCompletedStreets = completedTasks
      .filter(_.userId === user.toString)
      .groupBy(_.streetEdgeId).map(_._2.map(_.auditTaskId).max)
      .innerJoin(auditTasks).on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val tasks = for {
      (ser, ucs) <- edgesInRegion.leftJoin(userCompletedStreets).on(_.streetEdgeId === _._1)
      se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
    } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.wayType, false, ucs._2.?.getOrElse(timestamp), scau._2, sep.priority, ucs._1.?.isDefined, ucs._3.?, ucs._4, ucs._5, None: Option[Int])

    tasks.list.map(NewTask.tupled(_))
  }

  /**
   * Saves a new audit task.
   */
  def save(completedTask: AuditTask): Int = db.withSession { implicit session =>
    val auditTaskId: Int =
      (auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask
    auditTaskId
  }

  /**
    * Update the `current_mission_start` column of the specified audit task row.
    */
  def updateMissionStart(auditTaskId: Int, missionStart: Point): Int = db.withSession { implicit session =>
    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.currentMissionStart
    q.update(Some(missionStart))
  }

  /**
    * Update the `completed` column of the specified audit task row.
    * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
    */
  def updateCompleted(auditTaskId: Int, completed: Boolean): Int = db.withSession { implicit session =>
    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.completed
    q.update(completed)
  }

  /**
    * Update the `current_lat`, `current_lng`, `mission_id`, and `task_end` columns of the specified audit task row.
    */
  def updateTaskProgress(auditTaskId: Int, timestamp: Timestamp, lat: Float, lng: Float, missionId: Int, currMissionStart: Option[Point]): Int = db.withSession { implicit session =>
    val q = for { t <- auditTasks if t.auditTaskId === auditTaskId } yield (t.taskEnd, t.currentLat, t.currentLng, t.currentMissionId, t.currentMissionStart)
    q.update((timestamp, lat, lng, Some(missionId), currMissionStart))
  }
}
