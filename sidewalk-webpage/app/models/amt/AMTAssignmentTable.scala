package models.amt

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AMTAssignment(amtAssignmentId: Option[Int], hitId: String, assignmentId: String, assignmentStart: Timestamp, assignmentEnd: Option[Timestamp])

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Option[Int]]("amt_assignment_id", O.PrimaryKey)
  def hitId = column[String]("amt_hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Option[Timestamp]]("assignment_end")

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

/**
 * Data access object for the label table
 */
object AMTAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTAssignmentTable]
}

