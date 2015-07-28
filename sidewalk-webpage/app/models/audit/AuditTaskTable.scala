package models.audit

import com.vividsolutions.jts.geom.{Coordinate, LineString}
import java.sql.Timestamp
import java.util.{Calendar, Date}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{UserTable, DBUser => User}
import play.api.libs.json._
import play.api.Play.current
import play.extras.geojson
import scala.slick.lifted.ForeignKeyQuery

case class AuditTask(auditTaskId: Int, amtAssignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Option[Timestamp])
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
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey)
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id")
  def userId = column[String]("user_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def taskStart = column[Timestamp]("task_start", O.NotNull)
  def taskEnd = column[Option[Timestamp]]("task_end")

  def * = (auditTaskId, amtAssignmentId, userId, streetEdgeId, taskStart, taskEnd) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("audit_task_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def user: ForeignKeyQuery[UserTable, User] =
    foreignKey("", userId, TableQuery[UserTable])(_.userId)
}


/**
 * Data access object for the audit_task table
 */
object AuditTaskTable {
  val db = play.api.db.slick.DB
  val assignmentCount = TableQuery[StreetEdgeAssignmentCountTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val users = TableQuery[UserTable]

  val rand = new scala.util.Random

  def all: List[AuditTask] = db.withSession { implicit session =>
    auditTasks.list
  }

  def save(completedTask: AuditTask): Int = db.withTransaction { implicit session =>
    auditTasks += completedTask
    completedTask.auditTaskId
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
    val calendar: Calendar = Calendar.getInstance()
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

    val e = edges(rand.nextInt(edges.size - 1))
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
  }

  /**
   * Get task without username
   * @return
   */
  def getNewTask: NewTask = db.withSession { implicit session =>
    val calendar: Calendar = Calendar.getInstance()
    val now: Date = calendar.getTime
    val currentTimestamp: Timestamp = new Timestamp(now.getTime)

    var edges = (for {
      (_streetEdges, _asgCount) <- streetEdges.innerJoin(assignmentCount).on(_.streetEdgeId === _.streetEdgeId).sortBy(_._2.completionCount)
    } yield _streetEdges).take(100).list

    val e = edges(rand.nextInt(edges.size - 1))
    NewTask(e.streetEdgeId, e.geom, e.x1, e.y1, e.x2, e.y2, currentTimestamp)
  }
}
