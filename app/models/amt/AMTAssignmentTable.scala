package models.amt

import java.sql.Timestamp

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Option[Timestamp],
                         workerId: String, confirmationCode: Option[String], completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id")
  def assignmentId = column[String]("assignment_id")
  def assignmentStart = column[Timestamp]("assignment_start")
  def assignmentEnd = column[Option[Timestamp]]("assignment_end")
  def workerId = column[String]("turker_id")
  def confirmationCode = column[Option[String]]("confirmation_code")
  def completed = column[Boolean]("completed")

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, workerId, confirmationCode, completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

/**
 * Data access object for the amt_assignment table
 */
object AMTAssignmentTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val amtAssignments = TableQuery[AMTAssignmentTable]

  val TURKER_TUTORIAL_PAY: Double = 0.43D
  val TURKER_PAY_PER_MILE: Double = 4.17D
  val TURKER_PAY_PER_METER: Double = TURKER_PAY_PER_MILE / 1609.34D
  val VOLUNTEER_PAY: Double = 0.0D

  def save(asg: AMTAssignment): Future[Int] = {
    db.run((amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg)
  }

  def getConfirmationCode(workerId: String, assignmentId: String): Future[String] = {
    val confCodeQuery = amtAssignments
      .filter(x => x.workerId === workerId && x.assignmentId === assignmentId)
      .sortBy(_.assignmentStart.desc)
      .map(_.confirmationCode)
    db.run(confCodeQuery.result.head).map(_.getOrElse(""))
  }

  def getMostRecentAssignmentId(workerId: String): Future[String] = db.run {
    amtAssignments.filter(x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentId).result.head
  }

  def getMostRecentAMTAssignmentId(workerId: String): Future[Int] = db.run {
    amtAssignments.filter( x => x.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.amtAssignmentId).result.head
  }

  /**
    * Update the `assignment_end` timestamp column of the specified amt_assignment row
    *
    * @param amtAssignmentId
    * @param timestamp
    * @return
    */
  def updateAssignmentEnd(amtAssignmentId: Int, timestamp: Timestamp): Future[Int] = {
    db.run(amtAssignments.filter(_.amtAssignmentId === amtAssignmentId).map(a => a.assignmentEnd).update(Some(timestamp)))
  }

  /**
    * Update the `completed`  column of the specified amt_assignment row
    *
    * @param amtAssignmentId
    * @param completed
    * @return
    */
  def updateCompleted(amtAssignmentId: Int, completed: Boolean): Future[Int] = {
    db.run(amtAssignments.filter(_.amtAssignmentId === amtAssignmentId).map(a => a.completed).update(completed))
  }
}
