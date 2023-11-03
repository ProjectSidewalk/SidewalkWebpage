package models.audit

import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskIncomplete(auditTaskIncompleteId: Int, auditTaskId: Int, missionId: Int, issueDescription: String, lat: Float, lng: Float)

class AuditTaskIncompleteTable(tag: Tag) extends Table[AuditTaskIncomplete](tag, "audit_task_incomplete") {
  def auditTaskIncompleteId = column[Int]("audit_task_incomplete_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def issueDescription = column[String]("issue_description", O.NotNull)
  def lat = column[Float]("lat", O.NotNull)
  def lng = column[Float]("lng", O.NotNull)

  def * = (auditTaskIncompleteId, auditTaskId, missionId, issueDescription, lat, lng) <> ((AuditTaskIncomplete.apply _).tupled, AuditTaskIncomplete.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("audit_task_incomplete_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_incomplete_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_environment table.
 */
object AuditTaskIncompleteTable {
  val db = play.api.db.slick.DB
  val incompletes = TableQuery[AuditTaskIncompleteTable]

  /**
   * Saves a new audit task environment.
   */
  def save(incomplete: AuditTaskIncomplete): Int = db.withTransaction { implicit session =>
    val auditTaskIncompleteId: Int =
      (incompletes returning incompletes.map(_.auditTaskIncompleteId)) += incomplete
    auditTaskIncompleteId
  }
}
