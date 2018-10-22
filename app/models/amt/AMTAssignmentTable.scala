package models.amt

import java.sql.Timestamp

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Option[Timestamp],
                         workerId: String, confirmationCode: Option[String], completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Option[Timestamp]]("assignment_end")
  def workerId = column[String]("turker_id", O.NotNull)
  def confirmationCode = column[Option[String]]("confirmation_code")
  def completed = column[Boolean]("completed", O.NotNull)

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, workerId, confirmationCode, completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

/**
 * Data access object for the amt_assignment table
 */
object AMTAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTAssignmentTable]

  val TURKER_TUTORIAL_PAY: Double = 0.43D
  val TURKER_PAY_PER_MILE: Double = 4.17D
  val TURKER_PAY_PER_METER: Double = TURKER_PAY_PER_MILE / 1609.34D
  val VOLUNTEER_PAY: Double = 0.0D

  def save(asg: AMTAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
    asgId
  }

  def getConfirmationCode(workerId: String, assignmentId: String): String = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId && x.assignmentId === assignmentId).sortBy(_.assignmentStart.desc).map(_.confirmationCode).list.head.getOrElse("")
  }

  def getMostRecentAssignmentId(workerId: String): String = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentId).list.head
  }

  def getMostRecentAMTAssignmentId(workerId: String): Int = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.amtAssignmentId).list.head
  }

  /**
    * Update the `assignment_end` timestamp column of the specified amt_assignment row
    *
    * @param amtAssignmentId
    * @param timestamp
    * @return
    */
  def updateAssignmentEnd(amtAssignmentId: Int, timestamp: Timestamp) = db.withTransaction { implicit session =>
    val q = for { asg <- amtAssignments if asg.amtAssignmentId === amtAssignmentId } yield asg.assignmentEnd
    q.update(Some(timestamp))
  }

  /**
    * Update the `completed`  column of the specified amt_assignment row
    *
    * @param amtAssignmentId
    * @param completed
    * @return
    */
  def updateCompleted(amtAssignmentId: Int, completed: Boolean) = db.withTransaction { implicit session =>
    val q = for { asg <- amtAssignments if asg.amtAssignmentId === amtAssignmentId } yield asg.completed
    q.update(completed)
  }
}

