package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString}
import java.sql.Timestamp
import java.util.{UUID, Calendar, Date}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{UserTable, DBUser => User}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson
import scala.slick.lifted.ForeignKeyQuery
import play.api.db.slick._
import scala.slick.jdbc.GetResult
import scala.slick.jdbc.{StaticQuery => Q}
import scala.util.Random

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Timestamp)
case class NewTask(edgeId: Int, geom: LineString, x1: Float, y1: Float, x2: Float, y2: Float, taskStart: Timestamp)  {
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
      "task_start" -> taskStart.toString
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
  def taskEnd = column[Timestamp]("task_end", O.Nullable)

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user: ForeignKeyQuery[UserTable, User] =
    foreignKey("audit_task_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}


/**
 * Data access object for the audit_task table
 */
object AuditTaskTable {
  val calendar: Calendar = Calendar.getInstance
  val db = play.api.db.slick.DB
  val assignmentCount = TableQuery[StreetEdgeAssignmentCountTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val users = TableQuery[UserTable]


  def all: List[AuditTask] = db.withSession { implicit session =>
    auditTasks.list
  }

  /**
   * Return an audited edges
   * @param userId
   * @return
   */
  def auditedStreets(userId: UUID): List[StreetEdge] =  db.withSession { implicit session =>
    val _streetEdges = for {
      (_auditTasks, _streetEdges) <- auditTasks.innerJoin(streetEdges).on(_.streetEdgeId === _.streetEdgeId) if _auditTasks.userId === userId.toString
    } yield _streetEdges

    _streetEdges.list
  }

  /**
   * Given a
   *
   * Reference for creating java.sql.timestamp
   * http://stackoverflow.com/questions/308683/how-can-i-get-the-current-date-and-time-in-utc-or-gmt-in-java
   * http://alvinalexander.com/java/java-timestamp-example-current-time-now
   *
   * Subqueries in Slick
   * http://stackoverflow.com/questions/14425844/why-does-slick-generate-a-subquery-when-take-method-is-called
   * http://stackoverflow.com/questions/14920153/how-to-write-nested-queries-in-select-clause
   *
   * @param username
   * @return
   */
  def getNewTask(username: String): NewTask = db.withSession { implicit session =>
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val completedTasks = for {
      u <- users.filter(_.username === username)
      at <- auditTasks if at.userId === u.userId
    } yield (u.username.?, at.streetEdgeId.?)

    val edges = (for {
      (e, c) <- streetEdges.leftJoin(completedTasks).on(_.streetEdgeId === _._2)
      if c._1.isEmpty
    } yield e).take(100).list

    // Increment the assignment count and return the task
    val e: StreetEdge = Random.shuffle(edges).head
    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
  }

  /**
   * Get task without username
   * @return
   */
  def getNewTask: NewTask = db.withSession { implicit session =>
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount)
        .on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).take(100).list

    val e: StreetEdge = Random.shuffle(edges).head

    StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
  }


  /**
   * Get a task that is connected to the end point of the current task (street edge)
   * @param streetEdgeId Street edge id
   */
  def getNewTask(streetEdgeId: Int, lat: Float, lng: Float): NewTask = db.withSession { implicit session =>
    import models.street.StreetEdgeTable.streetEdgeConverter  // For plain query

    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    val selectEdgeQuery = Q.query[(Float, Float, Int), StreetEdge](
      """SELECT st_e.street_edge_id, st_e.geom, st_e.source, st_e.target, st_e.x1, st_e.y1, st_e.x2, st_e.y2, st_e.way_type, st_e.deleted, st_e.timestamp
        FROM sidewalk.street_edge_street_node AS st_e_st_n
        INNER JOIN (SELECT st_n.street_node_id FROM sidewalk.street_node AS st_n
        ORDER BY st_n.geom <-> st_setsrid(st_makepoint(?, ?), 4326)
        LIMIT 1) AS st_n_view
        ON st_e_st_n.street_node_id = st_n_view.street_node_id
        INNER JOIN sidewalk.street_edge AS st_e
        ON st_e_st_n.street_edge_id = st_e.street_edge_id
        INNER JOIN sidewalk.street_edge_assignment_count AS st_e_asg
        ON st_e.street_edge_id = st_e_asg.street_edge_id
        WHERE NOT st_e_st_n.street_edge_id = ?
        ORDER BY st_e_asg.completion_count ASC"""
    )

    val edges: List[StreetEdge] = selectEdgeQuery((lng, lat, streetEdgeId)).list
    edges match {
      case edges if (edges.size > 0) => {
        val e = edges(0)
        StreetEdgeAssignmentCountTable.incrementAssignment(e.streetEdgeId)
        NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
      }
      case _ => {
        getNewTask // The list is empty for whatever the reason
      }
    }
  }

  /**
   *
   * @return
   */
  def getOnboardingTask: NewTask = db.withSession { implicit session =>
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)
    val e: StreetEdge = streetEdges.filter(_.wayType === "onboarding").list.head
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
  }

  /**
   * Saves a new audit task.
   *
   * Reference for rturning the last inserted item's id
   * http://stackoverflow.com/questions/21894377/returning-autoinc-id-after-insert-in-slick-2-0
   * @param completedTask
   * @return
   */
  def save(completedTask: AuditTask): Int = db.withTransaction { implicit session =>
    val auditTaskId: Int =
      (auditTasks returning auditTasks.map(_.auditTaskId)) += completedTask
    auditTaskId
  }
}
