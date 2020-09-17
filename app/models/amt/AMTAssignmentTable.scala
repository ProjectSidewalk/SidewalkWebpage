package models.amt

import java.sql.Timestamp
import java.time.Instant

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Timestamp,
                         workerId: String, confirmationCode: String, completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Timestamp]("assignment_end")
  def workerId = column[String]("turker_id", O.NotNull)
  def confirmationCode = column[String]("confirmation_code")
  def completed = column[Boolean]("completed", O.NotNull)

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, workerId, confirmationCode, completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

/**
 * Data access object for the amt_assignment table
 */
object AMTAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTAssignmentTable]

  val TURKER_TUTORIAL_PAY: Double = 1.00D
  val TURKER_PAY_PER_MILE: Double = 5.00D
  val TURKER_PAY_PER_METER: Double = TURKER_PAY_PER_MILE / 1609.34D
  val TURKER_PAY_PER_LABEL_VALIDATION = 0.012D
  val VOLUNTEER_PAY: Double = 0.0D

  def save(asg: AMTAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
    asgId
  }

  def getConfirmationCode(workerId: String, assignmentId: String): String = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId && x.assignmentId === assignmentId).sortBy(_.assignmentStart.desc).map(_.confirmationCode).list.head
  }

  def getMostRecentAssignmentId(workerId: String): String = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentId).list.head
  }

  def getMostRecentAMTAssignmentId(workerId: String): Int = db.withTransaction { implicit session =>
    amtAssignments.filter( x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.amtAssignmentId).list.head
  }

  def getMostRecentAsmtEnd(workerId: String): Option[Timestamp] = db.withSession { implicit session =>
    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentEnd).list.headOption
  }

  /**
    * Get the number of milliseconds between now and the end time of the worker's most recent assignment.
    *
    * @param workerId
    * @return
    */
  def getMsLeftOnMostRecentAsmt(workerId: String): Option[Long] = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val endOption: Option[Timestamp] = getMostRecentAsmtEnd(workerId)
    endOption.map(end => end.getTime - now.getTime)
  }

  def getMostRecentConfirmationCode(workerId: String): Option[String] = db.withSession { implicit session =>
    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.confirmationCode).list.headOption
  }

  def getMostRecentAssignment(workerId: String): Option[AMTAssignment] = db.withSession { implicit session =>
    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).list.headOption
  }

  def getAssignment(workerId: String, assignmentId: String): Option[AMTAssignment] = db.withSession { implicit session =>
    amtAssignments.filter(a => a.workerId === workerId && a.assignmentId === assignmentId).list.headOption
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

