package models.audit

import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}


case class AuditTaskIncomplete(auditTaskIncompleteId: Int, auditTaskId: Int, missionId: Int, issueDescription: String, lat: Float, lng: Float)

class AuditTaskIncompleteTableDef(tag: Tag) extends Table[AuditTaskIncomplete](tag, "audit_task_incomplete") {
  def auditTaskIncompleteId: Rep[Int] = column[Int]("audit_task_incomplete_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def issueDescription: Rep[String] = column[String]("issue_description")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")

  def * = (auditTaskIncompleteId, auditTaskId, missionId, issueDescription, lat, lng) <> ((AuditTaskIncomplete.apply _).tupled, AuditTaskIncomplete.unapply)

//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("audit_task_incomplete_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
//
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("audit_task_incomplete_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[AuditTaskIncompleteTable])
trait AuditTaskIncompleteTableRepository {
  def insert(incomplete: AuditTaskIncomplete): DBIO[Int]
}

@Singleton
class AuditTaskIncompleteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AuditTaskIncompleteTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val incompletes = TableQuery[AuditTaskIncompleteTableDef]

  /**
   * Saves a new audit task environment.
   */
  def insert(incomplete: AuditTaskIncomplete): DBIO[Int] = {
    (incompletes returning incompletes.map(_.auditTaskIncompleteId)) += incomplete
  }
}
