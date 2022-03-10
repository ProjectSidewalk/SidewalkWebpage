package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString}
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import models.street._
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable}
import models.mission.MissionProgressCVGroundtruthTable
import models.street.StreetEdgePriorityTable
import models.user.{User, UserStatTable}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], completed: Boolean, currentLat: Float, currentLng: Float, startPointReversed: Boolean)
case class NewTask(edgeId: Int, geom: LineString,
                   currentLng: Float, currentLat: Float, x1: Float, y1: Float, x2: Float, y2: Float,
                   startPointReversed: Boolean, // Did we start at x1,y1 instead of x2,y2?
                   taskStart: Timestamp,
                   completedByAnyUser: Boolean, // Has any user has audited this street
                   priority: Double,
                   completed: Boolean // Has the user audited this street before (null if no corresponding user)
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
      "x1" -> x1,
      "y1" -> y1,
      "x2" -> x2,
      "y2" -> y2,
      "start_point_reversed" -> startPointReversed,
      "task_start" -> taskStart.toString,
      "completed_by_any_user" -> completedByAnyUser,
      "priority" -> priority,
      "completed" -> completed
    )
    val feature = Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    Json.obj("type" -> "FeatureCollection", "features" -> List(feature))
  }
}

class AuditTaskTable(tag: slick.lifted.Tag) extends Table[AuditTask](tag, Some("sidewalk"), "audit_task") {
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id", O.Nullable)
  def userId = column[String]("user_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def taskStart = column[Timestamp]("task_start", O.NotNull)
  def taskEnd = column[Option[Timestamp]]("task_end", O.Nullable)
  def completed = column[Boolean]("completed", O.NotNull)
  def currentLat = column[Float]("current_lat", O.NotNull)
  def currentLng = column[Float]("current_lng", O.NotNull)
  def startPointReversed = column[Boolean]("start_point_reversed", O.NotNull)

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed, currentLat, currentLng, startPointReversed) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the audit_task table.
 */
object AuditTaskTable {
  import MyPostgresDriver.plainImplicits._

  implicit val auditTaskConverter = GetResult[AuditTask](r => {
    AuditTask(r.nextInt, r.nextIntOption, r.nextString, r.nextInt, r.nextTimestamp, r.nextTimestampOption, r.nextBoolean, r.nextFloat, r.nextFloat, r.nextBoolean)
  })

  implicit val newTaskConverter = GetResult[NewTask](r => {
    val edgeId = r.nextInt
    val geom = r.nextGeometry[LineString]
    val currentLng = r.nextFloat
    val currentLat = r.nextFloat
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val startPointReversed = r.nextBoolean
    val taskStart = r.nextTimestamp
    val completedByAnyUser = r.nextBoolean
    val priority = r.nextDouble
    val completed = r.nextBooleanOption.getOrElse(false)
    NewTask(edgeId, geom, currentLng, currentLat, x1, y1, x2, y2, startPointReversed, taskStart, completedByAnyUser, priority, completed)
  })

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTable]
  val users = TableQuery[UserTable]

  val completedTasks = auditTasks.filter(_.completed)
  val streetEdgesWithoutDeleted = streetEdges.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = StreetEdgeRegionTable.nonDeletedStreetEdgeRegions

  // Sub query with columns (street_edge_id, completed_by_any_user): (Int, Boolean).
  // TODO it would be better to only consier "good user" audits here, but it would take too long to calculate each time.
  def streetCompletedByAnyUser: Query[(Column[Int], Column[Boolean]), (Int, Boolean), Seq] = {
    // Completion count for audited streets.
    val completionCnt = completedTasks.groupBy(_.streetEdgeId).map { case (_street, group) => (_street, group.length) }

    // Gets completion count of 0 for unaudted streets w/ a left join, then checks if completion count is > 0.
    streetEdgesWithoutDeleted.leftJoin(completionCnt).on(_.streetEdgeId === _._1).map {
      case (_edge, _cnt) => (_edge.streetEdgeId, _cnt._2.ifNull(0.asColumnOf[Int]) > 0)
    }
  }

  case class AuditCountPerDay(date: String, count: Int)
  case class AuditTaskWithALabel(userId: String, username: String, auditTaskId: Int, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], labelId: Option[Int], temporaryLabelId: Option[Int], labelType: Option[String])

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
      (_userTasks, _labels) <- userTasks.leftJoin(LabelTable.labelsWithoutDeletedOrOnboarding).on(_._3 === _.auditTaskId)
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
    * Returns true if there is a completed audit task for the given street edge, false otherwise.
    */
  def anyoneHasAuditedStreet(streetEdgeId: Int): Boolean = db.withSession { implicit session =>
    completedTasks.filter(_.streetEdgeId === streetEdgeId).list.nonEmpty
  }

  /**
    * Return audited street edges.
    */
  def selectStreetsAudited(filterLowQuality: Boolean): List[StreetEdge] = db.withSession { implicit session =>
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

    val _streetEdges = for {
      (_tasks, _edges) <- _filteredTasks.innerJoin(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
    } yield _edges

    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList  // Filter out the duplicated street edges.
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
    * Get the sum of the line distance of all streets in the region that the user has not audited.
    */
  def getUnauditedDistance(userId: UUID, regionId: Int): Float = db.withSession { implicit session =>
    val streetsLeft: List[Int] = getStreetEdgeIdsNotAudited(userId, regionId)
    streetEdgesWithoutDeleted.filter(_.streetEdgeId inSet streetsLeft).map(_.geom.transform(26918).length).list.sum
  }

  /**
    * Get a new task specified by the street edge id. Used when calling the /audit/street route.
    */
  def selectANewTask(streetEdgeId: Int, user: Option[UUID]): NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Set completed to true if the user has already audited this street.
    val userCompleted: Boolean = if (user.isDefined) userHasAuditedStreet(streetEdgeId, user.get) else false

    // Join with other queries to get completion count and priority for each of the street edges.
    val edges = for {
      se <- streetEdgesWithoutDeleted if se.streetEdgeId === streetEdgeId
      scau <- streetCompletedByAnyUser if se.streetEdgeId === scau._1
      sep <- streetEdgePriorities if scau._1 === sep.streetEdgeId
    } yield (se.streetEdgeId, se.geom, se.x2, se.y2, se.x1, se.y1, se.x2, se.y2, false, timestamp, scau._2, sep.priority, userCompleted)

    NewTask.tupled(edges.first)
  }

  /**
    * Helper method for creating a task for computer vision ground truth auditing.
    *
    * In CV ground truth auditing, we create a task for *each* pano that needs to be audited, corresponding to the
    * street segment closest to the pano. This method fetches the id of the pano closest to the provided panoid. This
    * panoid *must* be part of an active CV groundtruth mission for the provided user.
    * @param user the user performing a CV ground truth audit
    * @param panoid panoId to query
    * @return street segment id closest to pano
    */
  def getStreetEdgeIdClosestToCVPanoId(user: User, panoid:String): Option[Int] = {
    val (panoLat, panoLng): (Option[Float], Option[Float]) = MissionProgressCVGroundtruthTable.getPanoLatLng(user.userId, panoid)
    (panoLat, panoLng) match {
      case (Some(lat), Some(lng)) =>
        LabelTable.getStreetEdgeIdClosestToLatLng(lat, lng)
      case _ =>  None
    }
  }

  /**
    * Creates a computer vision ground truth audit task and inserts it into the database.
    * @param user user performing the CV ground truth audit
    * @param panoid panoId that corresponds to the task
    */
  def createCVGroundTruthTaskByPanoId(user: User, panoid:String): Option[NewTask] = {
    val closestStreetEdgeId: Option[Int] = getStreetEdgeIdClosestToCVPanoId(user, panoid)
    closestStreetEdgeId match {
      case Some(id) => Some(AuditTaskTable.selectANewTask(id, None))
      case None => None
    }
  }

  /**
   * Get a task that is in a given region. Used if a user has already been assigned a region, or from /audit/region.
   */
  def selectANewTaskInARegion(regionId: Int, user: UUID): Option[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Get the streets that the user has not already completed.
    val edgesInRegion = streetEdges.filter(_.streetEdgeId inSet getStreetEdgeIdsNotAudited(user, regionId))

    // Join with other queries to get completion count and priority for each of the street edges.
    val possibleTasks = for {
      sp <- streetEdgePriorities
      se <- edgesInRegion if sp.streetEdgeId === se.streetEdgeId
      sc <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
    } yield (se.streetEdgeId, se.geom, se.x2, se.y2, se.x1, se.y1, se.x2, se.y2, false, timestamp, sc._2, sp.priority, false)

    // Get the priority of the highest priority task.
    val highestPriority: Option[Double] = possibleTasks.map(_._12).max.run

    // Get list of tasks that have this priority.
    val highestPriorityTasks: Option[List[NewTask]] = highestPriority.map { highPriority =>
      possibleTasks.filter(_._12 === highPriority).list.map(NewTask.tupled)
    }

    // Choose one of the highest priority tasks at random.
    highestPriorityTasks.flatMap(scala.util.Random.shuffle(_).headOption)
  }

  /**
    * Gets the metadata for a task from its audit_task_id.
    */
  def selectTaskFromTaskId(taskId: Int): Option[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val newTask = for {
      at <- auditTasks if at.auditTaskId === taskId
      se <- streetEdges if at.streetEdgeId === se.streetEdgeId
      sp <- streetEdgePriorities if se.streetEdgeId === sp.streetEdgeId
      sc <- streetCompletedByAnyUser if sp.streetEdgeId === sc._1
    } yield (se.streetEdgeId, se.geom, at.currentLng, at.currentLat, se.x1, se.y1, se.x2, se.y2, at.startPointReversed, timestamp, sc._2, sp.priority, false)

    newTask.list.map(NewTask.tupled).headOption
  }

  /**
    * Get tasks in the region. Called when a list of tasks is requested through the API.
    */
  def selectTasksInARegion(regionId: Int): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val tasks = for {
      ser <- nonDeletedStreetEdgeRegions if ser.regionId === regionId
      se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
    } yield (se.streetEdgeId, se.geom, se.x2, se.y2, se.x1, se.y1, se.x2, se.y2, false, timestamp, scau._2, sep.priority, false)

    tasks.list.map(NewTask.tupled(_))
  }

  /**
    * Get tasks in the region. Called when a user begins auditing a region.
    */
  def selectTasksInARegion(regionId: Int, user: UUID): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val edgesInRegion = nonDeletedStreetEdgeRegions.filter(_.regionId === regionId)

    val userCompletedStreets = completedTasks.filter(_.userId === user.toString).groupBy(_.streetEdgeId).map{ x => (x._1, true) }

    val tasks = for {
      (ser, ucs) <- edgesInRegion.leftJoin(userCompletedStreets).on(_.streetEdgeId === _._1)
      se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
    } yield (
      se.streetEdgeId, se.geom, se.x2, se.y2, se.x1, se.y1, se.x2, se.y2, false, timestamp, scau._2, sep.priority, ucs._2.?.getOrElse(false))

    tasks.list.map(NewTask.tupled(_))
  }

  /**
   * Saves a new audit task.
   */
  def save(completedTask: AuditTask): Int = db.withTransaction { implicit session =>
    val auditTaskId: Int =
      (auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask
    auditTaskId
  }

  /**
    * Update the `completed` column of the specified audit task row.
    * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
    */
  def updateCompleted(auditTaskId: Int, completed: Boolean): Int = db.withTransaction { implicit session =>
    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.completed
    q.update(completed)
  }

  /**
    * Update the `current_lat`, `current_lng`, and `task_end` columns of the specified audit task row.
    */
  def updateTaskProgress(auditTaskId: Int, timestamp: Timestamp, lat: Float, lng: Float): Int = db.withTransaction { implicit session =>
    val q = for { t <- auditTasks if t.auditTaskId === auditTaskId } yield (t.taskEnd, t.currentLat, t.currentLng)
    q.update((Some(timestamp), lat, lng))
  }
}
