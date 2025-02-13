package models.amt

import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTableDef}
import models.utils.MyPostgresProfile

import java.sql.Timestamp
import java.time.Instant
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String, assignmentStart: Timestamp,
                         assignmentEnd: Timestamp, workerId: String, confirmationCode: String, completed: Boolean)

class AMTAssignmentTableDef(tag: Tag) extends Table[AMTAssignment](tag, "amt_assignment") {
  def amtAssignmentId: Rep[Int] = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId: Rep[String] = column[String]("hit_id")
  def assignmentId: Rep[String] = column[String]("assignment_id")
  def assignmentStart: Rep[Timestamp] = column[Timestamp]("assignment_start")
  def assignmentEnd: Rep[Timestamp] = column[Timestamp]("assignment_end")
  def workerId: Rep[String] = column[String]("turker_id")
  def confirmationCode: Rep[String] = column[String]("confirmation_code")
  def completed: Rep[Boolean] = column[Boolean]("completed")

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, workerId, confirmationCode, completed) <>
    ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object AMTAssignmentTable {
  val TURKER_TUTORIAL_PAY: Double = 1.00D
  val TURKER_PAY_PER_MILE: Double = 5.00D
  val TURKER_PAY_PER_METER: Double = TURKER_PAY_PER_MILE / 1609.34D
  val TURKER_PAY_PER_LABEL_VALIDATION = 0.012D
  val VOLUNTEER_PAY: Double = 0.0D
}

@ImplementedBy(classOf[AMTAssignmentTable])
trait AMTAssignmentTableRepository {
  def insert(asg: AMTAssignment): DBIO[Int]
}

@Singleton
class AMTAssignmentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AMTAssignmentTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val amtAssignments = TableQuery[AMTAssignmentTableDef]
  val missions = TableQuery[MissionTableDef]

  def insert(asg: AMTAssignment): DBIO[Int] = {
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
  }
//
//  def getConfirmationCode(workerId: String, assignmentId: String): String = {
//    amtAssignments.filter(a => a.workerId === workerId && a.assignmentId === assignmentId).sortBy(_.assignmentStart.desc).map(_.confirmationCode).first
//  }
//
//  def getMostRecentAssignmentId(workerId: String): DBIO[String] = {
//    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentId).result.head
//  }
//
//  def getMostRecentAMTAssignmentId(workerId: String): Int = {
//    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.amtAssignmentId).first
//  }
//
//  def getMostRecentAsmtEnd(workerId: String): Option[Timestamp] = {
//    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.assignmentEnd).firstOption
//  }

  def missionsInAssignment(asmt: AMTAssignment): DBIO[Seq[Mission]] = {
    missions.filter(m => m.missionEnd > asmt.assignmentStart && m.missionEnd < asmt.assignmentEnd && m.completed).result
  }
//
//  /**
//    * Get the number of milliseconds between now and the end time of the worker's most recent assignment.
//    */
//  def getMsLeftOnMostRecentAsmt(workerId: String): Option[Long] = {
//    val now: Timestamp = Timestamp.from(Instant.now)
//    val endOption: Option[Timestamp] = getMostRecentAsmtEnd(workerId)
//    endOption.map(end => end.getTime - now.getTime)
//  }
//
//  def getMostRecentConfirmationCode(workerId: String): Option[String] = {
//    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).map(_.confirmationCode).firstOption
//  }

  def getMostRecentAssignment(workerId: String): DBIO[Option[AMTAssignment]] = {
    amtAssignments.filter(_.workerId === workerId).sortBy(_.assignmentStart.desc).result.headOption
  }

//  def getAssignment(workerId: String, assignmentId: String): Option[AMTAssignment] = {
//    amtAssignments.filter(a => a.workerId === workerId && a.assignmentId === assignmentId).firstOption
//  }
//
//  /**
//    * Update the `completed` column of the specified amt_assignment row.
//    */
//  def updateCompleted(amtAssignmentId: Int, completed: Boolean): Int = {
//    val q = for { asg <- amtAssignments if asg.amtAssignmentId === amtAssignmentId } yield asg.completed
//    q.update(completed)
//  }
}
