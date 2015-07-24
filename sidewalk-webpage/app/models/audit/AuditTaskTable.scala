package models.audit

import java.sql.Timestamp
import java.util.{UUID, Calendar, Date}
import models.street.{StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
//import models.{User, User}
import models.daos.slick.DBTableDefinitions.{UserTable, DBUser => User}
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery


case class AuditTask(auditTaskId: Int, assignmentId: Option[Int], userId: String, streetEdgeId: Int, taskStart: Timestamp, taskEnd: Timestamp)
case class NewTask(edgeId: Int, taskStart: Timestamp)
/**
 *
 */
class AuditTaskTable(tag: Tag) extends Table[AuditTask](tag, "audit_task") {
  def auditTaskId = column[Int]("audit_task_id", O.PrimaryKey)
  def assignmentId = column[Option[Int]]("assignment_id")
  def userId = column[String]("user_id")
  def streetEdgeId = column[Int]("street_edge_id")
  def taskStart = column[Timestamp]("timestamp")
  def taskEnd = column[Timestamp]("timestamp")

  def * = (auditTaskId, assignmentId, userId, streetEdgeId, taskStart, taskEnd) <> ((AuditTask.apply _).tupled, AuditTask.unapply)

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
  val auditTasks = TableQuery[AuditTaskTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val users = TableQuery[UserTable]

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

//    val completedTasks = for {
//      u <- users.filter(_.username == username)
//      at <- auditTasks if at.userId == u.userId
//    } yield at.streetEdgeId
//
//    streetEdges.outerJoin(completedTasks)

    NewTask(0, currentTimestamp)
  }
}
