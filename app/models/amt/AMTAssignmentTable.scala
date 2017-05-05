package models.amt

import java.sql.Timestamp

import models.condition.{Condition, ConditionTable}
import models.turker.{Turker, TurkerTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Option[Timestamp],
                         turkerId: Int, conditionId: Int, routeId: Int, completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Timestamp]("assignment_end", O.NotNull)
  def turkerId = column[String]("turker_id", O.NotNull)
  def conditionId = column[Int]("condition_id", O.NotNull)
  def routeId = column[Int]("route_id", O.NotNull)
  def completed = column[Boolean]("completed")

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, turkerId, conditionId, routeId,
    completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)

  def condition: ForeignKeyQuery[ConditionTable, Condition] =
    foreignKey("amt_assignment_condition_id_fkey", conditionId, TableQuery[ConditionTable])(_.amtConditionId)

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

