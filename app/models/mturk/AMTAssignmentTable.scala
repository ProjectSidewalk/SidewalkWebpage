package models.mturk

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String, assignmentStart: OffsetDateTime,
                         assignmentEnd: OffsetDateTime, workerId: String, confirmationCode: String, completed: Boolean)

class AMTAssignmentTableDef(tag: Tag) extends Table[AMTAssignment](tag, "amt_assignment") {
  def amtAssignmentId: Rep[Int] = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId: Rep[String] = column[String]("hit_id")
  def assignmentId: Rep[String] = column[String]("assignment_id")
  def assignmentStart: Rep[OffsetDateTime] = column[OffsetDateTime]("assignment_start")
  def assignmentEnd: Rep[OffsetDateTime] = column[OffsetDateTime]("assignment_end")
  def workerId: Rep[String] = column[String]("turker_id")
  def confirmationCode: Rep[String] = column[String]("confirmation_code")
  def completed: Rep[Boolean] = column[Boolean]("completed")

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, workerId, confirmationCode, completed) <>
    ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)
}

@ImplementedBy(classOf[AMTAssignmentTable])
trait AMTAssignmentTableRepository { }

@Singleton
class AMTAssignmentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AMTAssignmentTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
}
