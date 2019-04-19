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
import models.user.User
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], completed: Boolean)
case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp,
                   completedByAnyUser: Boolean, // Has any user has audited this street
                   priority: Double,
                   completed: Boolean    // Has the user audited this street before (null if no corresponding user)
                  )  {
  /**
    * This method converts the data into the GeoJSON format
    * @return
    */
  def toJSON: JsObject = {
    val coordinates: Array[Coordinate] = geom.getCoordinates
    val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
    val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
    val properties = Json.obj(
      "street_edge_id" -> edgeId,
      "x1" -> x1,
      "y1" -> y1,
      "x2" -> x2,
      "y2" -> y2,
      "task_start" -> taskStart.toString,
      "completed_by_any_user" -> completedByAnyUser,
      "priority" -> priority,
      "completed" -> completed
    )
    val feature = Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    Json.obj("type" -> "FeatureCollection", "features" -> List(feature))
  }
}

/**
 *
 */
class AuditTaskTable(tag: slick.lifted.Tag) extends Table[AuditTask](tag, Some("sidewalk"), "audit_task") {
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey, O.AutoInc)
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id", O.Nullable)
  def userId = column[String]("user_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def taskStart = column[Timestamp]("task_start", O.NotNull)
  def taskEnd = column[Option[Timestamp]]("task_end", O.Nullable)
  def completed = column[Boolean]("completed", O.NotNull)

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd, completed) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}


/**
 * Data access object for the audit_task table
 */
object AuditTaskTable {
  import MyPostgresDriver.plainImplicits._

  implicit val auditTaskConverter = GetResult[AuditTask](r => {
    AuditTask(r.nextInt, r.nextIntOption, r.nextString, r.nextInt, r.nextTimestamp, r.nextTimestampOption, r.nextBoolean)
  })

//  case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp, completed: Boolean)

  implicit val newTaskConverter = GetResult[NewTask](r => {
    val edgeId = r.nextInt
    val geom = r.nextGeometry[LineString]
    val x1 = r.nextFloat
    val y1 = r.nextFloat
    val x2 = r.nextFloat
    val y2 = r.nextFloat
    val taskStart = r.nextTimestamp
    val completedByAnyUser = r.nextBoolean
    val priority = r.nextDouble
    val completed = r.nextBooleanOption.getOrElse(false)
    NewTask(edgeId, geom, x1, y1, x2, y2, taskStart, completedByAnyUser, priority, completed)
  })

  val db = play.api.db.slick.DB
  val auditTasks = TableQuery[AuditTaskTable]
  val labels = TableQuery[LabelTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTable]
  val users = TableQuery[UserTable]

  val completedTasks = auditTasks.filter(_.completed)
  val streetEdgesWithoutDeleted = streetEdges.filterNot(_.deleted)
  val nonDeletedStreetEdgeRegions = StreetEdgeRegionTable.nonDeletedStreetEdgeRegions

  case class AuditCountPerDay(date: String, count: Int)
  case class AuditTaskWithALabel(userId: String, username: String, auditTaskId: Int, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], labelId: Option[Int], temporaryLabelId: Option[Int], labelType: Option[String])

  /**
    * This method returns all the tasks
    *
    * @return
    */
  def all: List[AuditTask] = db.withSession { implicit session =>
    auditTasks.list
  }

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

  /**
    * Returns a count of the number of audits performed on each day since the tool was launched (11/17/2015).
    *
    * @return
    */
  def auditCounts: List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(audit_task_id)
        |FROM
        |(
        |    SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |    FROM generate_series(0, current_date - '11/17/2015') n
        |) AS calendar
        |LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectAuditCountQuery.list.map(x => AuditCountPerDay.tupled(x))
  }

  /**
    * Returns the number of tasks completed
    * @return
    */
  def countCompletedAudits: Int = db.withSession { implicit session =>
    completedTasks.list.size
  }

  /**
    * Returns the number of tasks completed today
    *
    * Author: Manaswi Saha
    * Date: Aug 30, 2016
    */
  def countCompletedAuditsToday: Int = db.withSession { implicit session =>
//    val dateFormat = new SimpleDateFormat("Y-mm-dd")
//    val today = dateFormat.format(Calendar.getInstance().getTime())
//    auditTasks.filter(_.taskEnd.toString() == today).filter(_.completed).list.size

    val countTasksQuery = Q.queryNA[Int](
      """SELECT audit_task_id
        |FROM sidewalk.audit_task
        |WHERE audit_task.task_end::date = now()::date
        |    AND audit_task.completed = TRUE""".stripMargin
    )
    countTasksQuery.list.size
  }

  /**
    * Returns the number of tasks completed
    *
    * Author: Manaswi Saha
    * Date: Aug 30, 2016
    */
  def countCompletedAuditsYesterday: Int = db.withSession { implicit session =>
    val countTasksQuery = Q.queryNA[Int](
      """SELECT audit_task_id
        |FROM sidewalk.audit_task
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |    AND audit_task.completed = TRUE""".stripMargin
    )
    countTasksQuery.list.size
  }

  /**
    * Returns the number of tasks completed by the given user
    *
    * @param userId
    * @return
    */
  def countCompletedAuditsByUserId(userId: UUID): Int = db.withSession { implicit session =>
    completedTasks.filter(_.userId === userId.toString).list.size
  }


  /**
    * Find a task
    *
    * @param auditTaskId
    * @return
    */
  def find(auditTaskId: Int): Option[AuditTask] = db.withSession { implicit session =>
    val auditTaskList = auditTasks.filter(_.auditTaskId === auditTaskId).list
    auditTaskList.headOption
  }

  /**
    * Gets list streets that the user has not audited.
    *
    * @param user
    * @return
    */
  def streetEdgeIdsNotAuditedByUser(user: UUID): List[Int] = db.withSession { implicit session =>

    val edgesAuditedByUser: List[Int] =
      completedTasks.filter(_.userId === user.toString).groupBy(_.streetEdgeId).map(_._1).list

    streetEdgesWithoutDeleted.filterNot(_.streetEdgeId inSet edgesAuditedByUser).map(_.streetEdgeId).list
  }

  /**
    * Gets the list of streets in the specified region that the user has not audited.
    *
    * @param user
    * @param regionId
    * @return
    */
  def streetEdgeIdsNotAuditedByUser(user: UUID, regionId: Int): List[Int] = db.withSession { implicit session =>

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
    * Verify if there are tasks available for the user in the given region
    *
    * @param user user id
    */
  def isTaskAvailable(user: UUID, regionId: Int): Boolean = db.withSession { implicit session =>

    val availableTasks: Int = streetEdgeIdsNotAuditedByUser(user, regionId).length
    availableTasks > 0
  }

  /**
    * Get a set of regions where the user has not completed all the street edges.
    *
    * @param user UUID for the user
    * @return
    */
  def selectIncompleteRegions(user: UUID): Set[Int] = db.withSession { implicit session =>
    nonDeletedStreetEdgeRegions
      .filter(_.streetEdgeId inSet streetEdgeIdsNotAuditedByUser(user))
      .map(_.regionId)
      .list.toSet
  }

  /**
    * Return a list of tasks associated with labels
    *
    * @param userId User id
    * @return
    */
  def selectTasksWithLabels(userId: UUID): List[AuditTaskWithALabel] = db.withSession { implicit session =>
    val userTasks = for {
      (_users, _tasks) <- users.innerJoin(auditTasks).on(_.userId === _.userId)
      if _users.userId === userId.toString
    } yield (_users.userId, _users.username, _tasks.auditTaskId, _tasks.streetEdgeId, _tasks.taskStart, _tasks.taskEnd)

    val userTaskLabels = for {
      (_userTasks, _labels) <- userTasks.leftJoin(labels).on(_._3 === _.auditTaskId)
      if _labels.deleted === false
    } yield (_userTasks._1, _userTasks._2, _userTasks._3, _userTasks._4, _userTasks._5, _userTasks._6, _labels.labelId.?, _labels.temporaryLabelId, _labels.labelTypeId.?)

    val tasksWithLabels = for {
      (_labelTypes, _userTaskLabels) <- labelTypes.innerJoin(userTaskLabels).on(_.labelTypeId === _._9)
    } yield (_userTaskLabels._1, _userTaskLabels._2, _userTaskLabels._3, _userTaskLabels._4, _userTaskLabels._5, _userTaskLabels._6, _userTaskLabels._7, _userTaskLabels._8, _labelTypes.labelType.?)

    tasksWithLabels.list.map(x => AuditTaskWithALabel.tupled(x))
  }


  /**
   * Get the last audit task that the user conducted
   *
   * @param userId User id
   * @return
   */
  def lastAuditTask(userId: UUID): Option[AuditTask] = db.withSession { implicit session =>
    auditTasks.filter(_.userId === userId.toString).list.lastOption
  }

  /**
    * Returns a true if the user has a completed audit task for the given street edge, false otherwise.
    *
    * @param streetEdgeId
    * @param user
    * @return
    */
  def userHasAuditedStreet(streetEdgeId: Int, user: UUID): Boolean = db.withSession { implicit session =>
    completedTasks.filter(task => task.streetEdgeId === streetEdgeId && task.userId === user.toString).list.nonEmpty
  }

  /**
    * Returns true if there is a completed audit task for the given street edge, false otherwise.
    *
    * @param streetEdgeId
    * @return
    */
  def anyoneHasAuditedStreet(streetEdgeId: Int): Boolean = db.withSession { implicit session =>
    completedTasks.filter(_.streetEdgeId === streetEdgeId).list.nonEmpty
  }

  /**
    * Return audited street edges
    *
    * @return
    */
  def selectStreetsAudited: List[StreetEdge] = db.withSession { implicit session =>
    val _streetEdges = for {
      (_tasks, _edges) <- completedTasks.innerJoin(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
    } yield _edges

    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList  // Filter out the duplicated street edge
  }

  /**
   * Return street edges audited by the given user
   *
   * @param userId User Id
   * @return
   */
  def selectStreetsAuditedByAUser(userId: UUID): List[StreetEdge] =  db.withSession { implicit session =>
    val _streetEdges = for {
      (_tasks, _edges) <- completedTasks.innerJoin(streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
      if _tasks.userId === userId.toString
    } yield _edges

    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }


  /**
    * Return audit counts for the last 31 days.
    *
    * @param userId User id
    */
  def selectAuditCountsPerDayByUserId(userId: UUID): List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.query[String, (String, Int)](
      """SELECT calendar_date::date, COUNT(audit_task_id)
        |FROM
        |(
        |    SELECT current_date - (n || ' day')::INTERVAL AS calendar_date
        |    FROM generate_series(0, 30) n
        |) AS calendar
        |LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
        |                              AND audit_task.user_id = ?
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectAuditCountQuery(userId.toString).list.map(x => AuditCountPerDay.tupled(x))
  }

  /**
    *
    * @param userId
    * @return
    */
  def selectCompletedTasks(userId: UUID): List[AuditTask] = db.withSession { implicit session =>
    completedTasks.filter(_.userId === userId.toString).list
  }

  /**
    * Get the sum of the line distance of all streets in the region that the user has not audited.
    *
    * @param userId
    * @param regionId
    * @return
    */
  def getUnauditedDistance(userId: UUID, regionId: Int): Float = db.withSession { implicit session =>
    val streetsLeft: List[Int] = streetEdgeIdsNotAuditedByUser(userId, regionId)
    streetEdgesWithoutDeleted.filter(_.streetEdgeId inSet streetsLeft).map(_.geom.transform(26918).length).list.sum
  }

  /**
    * Get a new task specified by the street edge id. Used when calling the /audit/street route.
    *
    * @param streetEdgeId Street edge id
    * @return
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
    } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, userCompleted)

    NewTask.tupled(edges.first)
  }

  /**
    * Helper method for creating a task for computer vision ground truth auditing. In CV ground truth auditing, we create
    * a task for *each* pano that needs to be audited, corresponding to the street segment closest to the pano. This method
    * fetches the id of the pano closest to the provided panoid. This panoid *must* be part of an active CV groundtruth
    * mission for the provided user.
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
    * Creates a computer vision ground truth audit task and inserts it into the database
    * @param user user performing the CV ground truth audit
    * @param panoid panoId that corresponds to the task
    * @return
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
   *
   * @param regionId region id
   * @param user User ID.
   * @return
   */
  def selectANewTaskInARegion(regionId: Int, user: UUID): Option[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    // Get the streets that the user has not already completed.
    val edgesInRegion = streetEdges.filter(_.streetEdgeId inSet streetEdgeIdsNotAuditedByUser(user, regionId))

    // Join with other queries to get completion count and priority for each of the street edges.
    val possibleTasks = for {
      sp <- streetEdgePriorities
      se <- edgesInRegion if sp.streetEdgeId === se.streetEdgeId
      sc <- streetCompletedByAnyUser if se.streetEdgeId === sc._1
    } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, sc._2, sp.priority, false)

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
    * Get tasks in the region. Called when a list of tasks is requested through the API.
    *
    * @param regionId Region id
    * @return
    */
  def selectTasksInARegion(regionId: Int): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val tasks = for {
      ser <- nonDeletedStreetEdgeRegions if ser.regionId === regionId
      se <- streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau <- streetCompletedByAnyUser if sep.streetEdgeId === scau._1
    } yield (se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, false)

    tasks.list.map(NewTask.tupled(_))
  }

  /**
    * Get tasks in the region. Called when a user begins auditing a region.
    *
    * @param regionId Region id
    * @param user User id
    * @return
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
      se.streetEdgeId, se.geom, se.x1, se.y1, se.x2, se.y2, timestamp, scau._2, sep.priority, ucs._2.?.getOrElse(false))

    tasks.list.map(NewTask.tupled(_))
  }

  def isAuditComplete(auditTaskId: Int): Boolean = db.withSession { implicit session =>
    auditTasks.filter(_.auditTaskId === auditTaskId).list.headOption.map(_.completed).getOrElse(false)
  }


  /**
   * Saves a new audit task.
   *
   * Reference for rturning the last inserted item's id
   * http://stackoverflow.com/questions/21894377/returning-autoinc-id-after-insert-in-slick-2-0
    *
    * @param completedTask completed task
   * @return
   */
  def save(completedTask: AuditTask): Int = db.withTransaction { implicit session =>
    val auditTaskId: Int =
      (auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask
    auditTaskId
  }

  /**
    * Update the `completed` column of the specified audit task row.
    * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
    *
    * @param auditTaskId Audit task id
    * @param completed A completed flag
    * @return
    */
  def updateCompleted(auditTaskId: Int, completed: Boolean) = db.withTransaction { implicit session =>
    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.completed
    q.update(completed)
  }

  /**
    * Update the `task_end` column of the specified audit task row
    *
    * @param auditTaskId
    * @param timestamp
    * @return
    */
  def updateTaskEnd(auditTaskId: Int, timestamp: Timestamp) = db.withTransaction { implicit session =>
    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.taskEnd
    q.update(Some(timestamp))
  }
}
