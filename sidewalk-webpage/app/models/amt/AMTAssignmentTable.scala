package models.amt

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String, assignmentStart: Timestamp, assignmentEnd: Option[Timestamp])

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
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

  def save(asg: AMTAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
    asgId
  }
}

