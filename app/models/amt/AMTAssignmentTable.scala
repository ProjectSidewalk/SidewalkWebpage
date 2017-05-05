package models.amt

import java.sql.Timestamp

import models.route.{Route, RouteTable}
import models.turker.{Turker, TurkerTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Option[Timestamp],
                         turkerId: String, conditionId: Int, routeId: Int, completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Option[Timestamp]]("assignment_end", O.Nullable)
  def turkerId = column[String]("turker_id", O.NotNull)
  def conditionId = column[Int]("condition_id", O.NotNull)
  def routeId = column[Int]("route_id", O.NotNull)
  def completed = column[Boolean]("completed", O.NotNull)

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, turkerId, conditionId, routeId,
    completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("amt_assignment_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

  def condition: ForeignKeyQuery[AMTConditionTable, AMTCondition] =
    foreignKey("amt_assignment_condition_id_fkey", conditionId, TableQuery[AMTConditionTable])(_.amtConditionId)

  def turker: ForeignKeyQuery[TurkerTable, Turker] =
    foreignKey("amt_assignment_turker_id_fkey", turkerId, TableQuery[TurkerTable])(_.turkerId)
}

/**
 * Data access object for the AMTAssignment table
 */
object AMTAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTAssignmentTable]

  def save(asg: AMTAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
    asgId
  }
}

