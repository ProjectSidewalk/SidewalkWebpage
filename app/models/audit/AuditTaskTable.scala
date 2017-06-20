package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString}
import java.sql.Timestamp
import java.text.SimpleDateFormat
import java.util.{Calendar, Date, TimeZone, UUID}

import models.street.{StreetEdge, StreetEdgeAssignmentCountTable, StreetEdgeTable}
import models.user.User
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.util.Random

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp], completed: Boolean)
case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp, completed: Boolean)  {
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
      "completed" -> completed
    )
    val feature = Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    Json.obj("type" -> "FeatureCollection", "features" -> List(feature))
  }
}

/**
 *
 */
class AuditTaskTable(tag: Tag) extends Table[AuditTask](tag, Some("sidewalk"), "audit_task") {
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
    val completed = r.nextBooleanOption.getOrElse(false)
    NewTask(edgeId, geom, x1, y1, x2, y2, taskStart, completed)
  })

  val db = play.api.db.slick.DB
  val assignmentCount = TableQuery[StreetEdgeAssignmentCountTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val labels = TableQuery[LabelTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val users = TableQuery[UserTable]

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

  def auditCounts: List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(audit_task_id) FROM (SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |FROM    generate_series(0, current_date - '11/17/2015') n) AS calendar
        |LEFT JOIN sidewalk.audit_task
        |ON audit_task.task_start::date = calendar_date::date
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
    auditTasks.filter(_.completed).list.size
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
         | FROM sidewalk.audit_task
         | WHERE audit_task.task_end::date = now()::date""".stripMargin
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
        | FROM sidewalk.audit_task
        | WHERE audit_task.task_end::date = now()::date - interval '1' day""".stripMargin
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
    auditTasks.filter(_.userId === userId.toString).filter(_.completed).list.size
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
    * Verify if there are tasks available for the user in the given region
    *
    * @param userId user id
    */
  def isTaskAvailable(userId: UUID, regionId: Int): Boolean = db.withSession { implicit session =>
    val selectAvailableTaskQuery = Q.query[(Int, String), AuditTask](
      """SELECT audit_task.* FROM sidewalk.user_current_region
        |INNER JOIN sidewalk.region
        |ON region.region_id = ?
        |INNER JOIN sidewalk.street_edge
        |ON ST_Intersects(region.geom, street_edge.geom)
        |LEFT JOIN sidewalk.audit_task
        |ON street_edge.street_edge_id = audit_task.street_edge_id
        |WHERE user_current_region.user_id = ?
        |AND audit_task.audit_task_id IS NULL
      """.stripMargin
    )

    val availableTasks = selectAvailableTaskQuery((regionId, userId.toString)).list
    availableTasks.nonEmpty
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
    * Return audited street edges
    *
    * @return
    */
  def selectStreetsAudited: List[StreetEdge] = db.withSession { implicit session =>
    val completedTasks = auditTasks.filter(_.completed === true)
    val _streetEdges = (for {
      (_auditTasks, _streetEdges) <- completedTasks.innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges).filter(edge => edge.deleted === false)
    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList  // Filter out the duplicated street edge
  }

  /**
   * Return street edges audited by the given user
   *
   * @param userId User Id
   * @return
   */
  def selectStreetsAuditedByAUser(userId: UUID): List[StreetEdge] =  db.withSession { implicit session =>
    val completedTasks = auditTasks.filter(_.completed === true)
    val _streetEdges = (for {
      (_auditTasks, _streetEdges) <- completedTasks.innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId) if _auditTasks.userId === userId.toString
    } yield _streetEdges).filter(edge => edge.deleted === false)

    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList
  }


  /**
    * Return audit counts for the last 31 days.
    *
    * @param userId User id
    */
  def selectAuditCountsPerDayByUserId(userId: UUID): List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.query[String, (String, Int)](
      """SELECT calendar_date::date, COUNT(audit_task_id) FROM (SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |FROM    generate_series(0, 30) n) AS calendar
        |LEFT JOIN sidewalk.audit_task
        |ON audit_task.task_start::date = calendar_date::date
        |AND audit_task.user_id = ?
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
    auditTasks.filter(_.userId === userId.toString).list
  }

  /**
   * get a new task for the user
   *
   * Reference for creating java.sql.timestamp
   * http://stackoverflow.com/questions/308683/how-can-i-get-the-current-date-and-time-in-utc-or-gmt-in-java
   * http://alvinalexander.com/java/java-timestamp-example-current-time-now
   *
   * Subqueries in Slick
   * http://stackoverflow.com/questions/14425844/why-does-slick-generate-a-subquery-when-take-method-is-called
   * http://stackoverflow.com/questions/14920153/how-to-write-nested-queries-in-select-clause
   *
   * @param username User name. Todo. Change it to user id
   * @return
   */
  def selectANewTask(username: String): NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val completedTasks = for {
      u <- users.filter(_.username === username)
      at <- auditTasks if at.userId === u.userId
    } yield (u.username.?, at.streetEdgeId.?)

    val edges = (for {
      (e, c) <- streetEdges.leftJoin(completedTasks).on(_.streetEdgeId === _._2)
      if c._1.isEmpty
    } yield e).filter(edge => edge.deleted === false).take(100).list

    // Increment the assignment count and return the task
    val e: StreetEdge = Random.shuffle(edges).head
    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, timestamp, completed=false)
  }

  /**
   * Get task without username
   *
   * @return
   */
  def selectANewTask: NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount)
        .on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).filter(edge => edge.deleted === false).take(100).list
    assert(edges.nonEmpty)

    val e: StreetEdge = Random.shuffle(edges).head

    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, timestamp, completed=false)
  }

  /**
    * Get a new task specified by the street edge id.
    *
    * @param streetEdgeId Street edge id
    * @return
    */
  def selectANewTask(streetEdgeId: Int): NewTask = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount)
        .on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).filter(edge => edge.deleted === false && edge.streetEdgeId === streetEdgeId).list
    assert(edges.nonEmpty)

    val e: StreetEdge = edges.head

    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, timestamp, completed=false)
  }


  /**
   * Get a task that is in a given region
    *
    * @param regionId region id
   * @return
   */
  def selectANewTaskInARegion(regionId: Int): NewTask = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val selectEdgeQuery = Q.query[Int, StreetEdge](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp FROM region
       |INNER JOIN street_edge AS st_e
       |ON ST_Intersects(st_e.geom, region.geom)
       |WHERE st_e.deleted = FALSE AND region.region_id = ?""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery(regionId).list
    edges match {
      case edges if edges.nonEmpty =>
        // Increment the assignment count and return the task
        val e: StreetEdge = Random.shuffle(edges).head
        StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, timestamp, completed=false)
      case _ => selectANewTask // The list is empty for whatever the reason
    }
  }

  /**
   * et a task that is in a given region
   *
   * @param regionId region id
   * @param user User object. Todo. Change this to user id.
   * @return
   */
  def selectANewTaskInARegion(regionId: Int, user: User) = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)
    val userId: String = user.userId.toString

    val selectEdgeQuery = Q.query[(String, Int), StreetEdge](
//      Changed the query to make sure audit tasks that are not marked as complete are audited again.
      """
       |WITH result AS (
       |	SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2,
       |         st_e.way_type, st_e.deleted, st_e.timestamp, audit_task.completed
       |  FROM sidewalk.region
       |	INNER JOIN sidewalk.street_edge AS st_e
       |	  ON ST_Intersects(st_e.geom, region.geom)
       |	LEFT JOIN sidewalk.audit_task
       |	  ON st_e.street_edge_id = audit_task.street_edge_id
       |	  AND audit_task.user_id = ?
       |	WHERE st_e.deleted = FALSE
       |	  AND region.region_id = ?
       |)
       |SELECT * FROM result as r1
       |WHERE NOT EXISTS (
       |	SELECT street_edge_id FROM result GROUP BY street_edge_id
       |  HAVING max(cast(completed as int))=1 AND street_edge_id = r1.street_edge_id
       |)""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((userId, regionId)).list
    edges match {
      case edges if edges.nonEmpty =>
        // Increment the assignment count and return the task
        val e: StreetEdge = Random.shuffle(edges).head
        StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, timestamp, completed=false)
      case _ =>
        selectANewTask // The list is empty for whatever the reason. Probably the user has audited all the streets in the region
    }
  }

  /**
    * Get tasks in the region
    *
    * @param regionId Region id
    * @return
    */
  def selectCompletedTasksInARegion(regionId: Int, userId: UUID): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val selectCompletedTasksInARegionQuery = Q.query[(String, Int), NewTask](
      """SELECT street.street_edge_id,
        |       street.geom,
        |       street.x1,
        |       street.y1,
        |       street.x2,
        |       street.y2,
        |       street.timestamp,
        |       audit_task.completed
        |  FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge AS street
        |  ON ST_Intersects(street.geom, region.geom)
        |LEFT JOIN sidewalk.audit_task
        |  ON street.street_edge_id = audit_task.street_edge_id
        |  AND audit_task.user_id = ?
        |WHERE region.region_id = ?
        |  AND street.deleted = FALSE
        |  AND audit_task.completed = TRUE
        |ORDER BY audit_task.task_end""".stripMargin
    )

    val result = selectCompletedTasksInARegionQuery((userId.toString, regionId)).list
    val uniqueTasks = for ((edgeId, tasks) <- result.groupBy(_.edgeId)) yield tasks.head

    uniqueTasks.toList.map(task =>
      NewTask(task.edgeId, task.geom, task.x1, task.y1, task.x2, task.y2, timestamp, task.completed)
    )
  }

  /**
    * Get tasks in the region
    *
    * @param regionId Region id
    * @return
    */
  def selectTasksInARegion(regionId: Int): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val selectTaskQuery = Q.query[Int, NewTask](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.timestamp, NULL as audit_task_id
        |  FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge AS st_e
        |  ON ST_Intersects(st_e.geom, region.geom)
        |WHERE region.region_id = ?
        |  AND st_e.deleted IS FALSE""".stripMargin
    )

    val newTasks = selectTaskQuery(regionId).list

    newTasks.map(task =>
      NewTask(task.edgeId, task.geom, task.x1, task.y1, task.x2, task.y2, timestamp, task.completed)
    )
  }

  /**
    * Get tasks in the region
    *
    * @param regionId Region id
    * @param userId User id
    * @return
    */
  def selectTasksInARegion(regionId: Int, userId: UUID): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Calendar.getInstance(TimeZone.getTimeZone("UTC")).getTime.getTime)

    val selectIncompleteTaskQuery = Q.query[(String, Int), NewTask](
      """SELECT street.street_edge_id,
        |       street.geom,
        |       street.x1,
        |       street.y1,
        |       street.x2,
        |       street.y2,
        |       street.timestamp,
        |       audit_task.completed
        |  FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge AS street
        |  ON ST_Intersects(street.geom, region.geom)
        |LEFT JOIN sidewalk.audit_task
        |  ON street.street_edge_id = audit_task.street_edge_id
        |  AND audit_task.user_id = ?
        |WHERE region.region_id = ?
        |  AND street.deleted = FALSE""".stripMargin
    )

    val result = selectIncompleteTaskQuery((userId.toString, regionId)).list
    val uniqueTasks = for ((edgeId, tasks) <- result.groupBy(_.edgeId)) yield {
      val completedTasks = tasks.filter(_.completed)
      if (completedTasks.isEmpty) {
        tasks.head
      } else {
        completedTasks.head
      }
    }

    uniqueTasks.toList.map(task =>
      NewTask(task.edgeId, task.geom, task.x1, task.y1, task.x2, task.y2, timestamp, task.completed)
    )
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
