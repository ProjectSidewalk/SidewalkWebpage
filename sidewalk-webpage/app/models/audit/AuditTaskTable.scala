package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString}
import java.sql.Timestamp
import java.util.{UUID, Calendar, Date}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdge, StreetEdgeTable}
import models.user.User
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{UserTable, DBUser}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q, GetResult}
import scala.util.Random

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp])
case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp, completed: Boolean)  {
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

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

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
    AuditTask(r.nextInt, r.nextIntOption, r.nextString, r.nextInt, r.nextTimestamp, r.nextTimestampOption)
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
    val completed = r.nextIntOption.isDefined
    NewTask(edgeId, geom, x1, y1, x2, y2, taskStart, completed)
  })

  val db = play.api.db.slick.DB
  val assignmentCount = TableQuery[StreetEdgeAssignmentCountTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val users = TableQuery[UserTable]

  case class AuditCountPerDay(date: String, count: Int)

  /**
    * This method returns all the tasks
    *
    * @return
    */
  def all: List[AuditTask] = db.withSession { implicit session =>
    auditTasks.list
  }

  /**
    * This method returns the size of the entire table
    *
    * @return
    */
  def size: Int = db.withSession { implicit session =>
    auditTasks.list.size
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
  def auditedStreets: List[StreetEdge] = db.withSession { implicit session =>
    val _streetEdges = (for {
      (_auditTasks, _streetEdges) <- auditTasks.innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId)
    } yield _streetEdges).filter(edge => edge.deleted === false)
    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList  // Filter out the duplicated street edge
  }

  /**
   * Return street edges audited by the given user
   *
   * @param userId User Id
   * @return
   */
  def auditedStreets(userId: UUID): List[StreetEdge] =  db.withSession { implicit session =>
    val _streetEdges = (for {
      (_auditTasks, _streetEdges) <- auditTasks.innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId) if _auditTasks.userId === userId.toString
    } yield _streetEdges).filter(edge => edge.deleted === false)

    _streetEdges.list
  }

  def auditCounts: List[AuditCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(audit_task_id) FROM (SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |FROM    generate_series(0, 30) n) AS calendar
        |LEFT JOIN sidewalk.audit_task
        |ON audit_task.task_start::date = calendar_date::date
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectAuditCountQuery.list.map(x => AuditCountPerDay.tupled(x))
  }

  /**
    * Return audit counts for the last 31 days.
    *
    * @param userId User id
    */
  def auditCounts(userId: UUID): List[AuditCountPerDay] = db.withSession { implicit session =>
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
  def getNewTask(username: String): NewTask = db.withSession { implicit session =>
    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

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
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
  }

  /**
   * Get task without username
   *
   * @return
   */
  def getNewTask: NewTask = db.withSession { implicit session =>
    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount)
        .on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).filter(edge => edge.deleted === false).take(100).list
    assert(edges.nonEmpty)

    val e: StreetEdge = Random.shuffle(edges).head

    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
  }

  /**
    * Get a new task specified by the street edge id.
    *
    * @param streetEdgeId Street edge id
    * @return
    */
  def getNewTask(streetEdgeId: Int): NewTask = db.withSession { implicit session =>
    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount)
        .on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).filter(edge => edge.deleted === false && edge.streetEdgeId === streetEdgeId).list
    assert(edges.nonEmpty)

    val e: StreetEdge = edges.head

    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
  }


  /**
   * Get a task that is connected to the end point of the current task (street edge)
   *
   * @param streetEdgeId Street edge id
   */
  def getConnectedTask(streetEdgeId: Int, lat: Float, lng: Float): NewTask = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter  // For plain query

    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    // Todo: I don't think this query takes into account if the auditor has looked at the area or not.
    val selectEdgeQuery = Q.query[(Float, Float, Int), StreetEdge](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp
         | FROM sidewalk.street_edge_street_node AS st_e_st_n
         | INNER JOIN (SELECT st_n.street_node_id FROM sidewalk.street_node AS st_n
         |   ORDER BY st_n.geom <-> st_setsrid(st_makepoint(?, ?), 4326)
         |   LIMIT 1) AS st_n_view
         | ON st_e_st_n.street_node_id = st_n_view.street_node_id
         | INNER JOIN sidewalk.street_edge AS st_e
         | ON st_e_st_n.street_edge_id = st_e.street_edge_id
         | INNER JOIN sidewalk.street_edge_assignment_count AS st_e_asg
         | ON st_e.street_edge_id = st_e_asg.street_edge_id
         | WHERE NOT st_e_st_n.street_edge_id = ?
         | ORDER BY st_e_asg.completion_count ASC""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((lng, lat, streetEdgeId)).list
    edges match {
      case edges if edges.nonEmpty =>
        val e = edges.head

        StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
      case _ =>
        getNewTask // The list is empty for whatever the reason
    }
  }

  /**
   * Get a task that is in a given region
    *
    * @param regionId region id
   * @return
   */
  def getNewTaskInRegion(regionId: Int): NewTask = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter

    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

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
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
      case _ => getNewTask // The list is empty for whatever the reason
    }
  }

  /**
   * et a task that is in a given region
   *
   * @param regionId region id
   * @param user User object. Todo. Change this to user id.
   * @return
   */
  def getNewTaskInRegion(regionId: Int, user: User) = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter

    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)
    val userId: String = user.userId.toString

    val selectEdgeQuery = Q.query[(String, Int), StreetEdge](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp FROM sidewalk.region
       | INNER JOIN sidewalk.street_edge AS st_e
       | ON ST_Intersects(st_e.geom, region.geom)
       | LEFT JOIN sidewalk.audit_task
       | ON st_e.street_edge_id = audit_task.street_edge_id AND audit_task.user_id = ?
       | WHERE st_e.deleted = FALSE AND region.region_id = ? AND audit_task.audit_task_id ISNULL""".stripMargin
    )

    val edges: List[StreetEdge] = selectEdgeQuery((userId, regionId)).list
    edges match {
      case edges if edges.nonEmpty =>
        // Increment the assignment count and return the task
        val e: StreetEdge = Random.shuffle(edges).head
        StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp, completed=false)
      case _ =>
        getNewTask // The list is empty for whatever the reason. Probably the user has audited all the streets in the region
    }
  }

  /**
    * Get tasks in the region
    *
    * @param regionId Region id
    * @return
    */
  def getTasksInRegion(regionId: Int): List[NewTask] = db.withSession { implicit session =>
    val selectTaskQuery = Q.query[Int, NewTask](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.timestamp, NULL as audit_task_id
        |FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge AS st_e
        |ON ST_Intersects(st_e.geom, region.geom)
        |WHERE region.region_id = ? AND st_e.deleted IS FALSE""".stripMargin
    )
    selectTaskQuery(regionId).list
  }

  /**
    * Get tasks in the region
    *
    * @param regionId Region id
    * @param userId User id
    * @return
    */
  def getTasksInRegion(regionId: Int, userId: UUID): List[NewTask] = db.withSession { implicit session =>
    val calendar: Calendar = Calendar.getInstance
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val selectTaskQuery = Q.query[(String, Int), NewTask](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.timestamp, completed_audit.audit_task_id
        |FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge AS st_e
        |ON ST_Intersects(st_e.geom, region.geom)
        |LEFT JOIN (
        |    SELECT street_edge_id, audit_task_id FROM sidewalk.audit_task
        |    WHERE user_id = ?
        |) AS completed_audit
        |ON st_e.street_edge_id = completed_audit.street_edge_id
        |WHERE region.region_id = ? AND st_e.deleted IS FALSE""".stripMargin
    )

    selectTaskQuery((userId.toString, regionId)).list
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
}
