package models.audit

import models.mission.{ Mission, MissionTable }
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class AuditTaskIncomplete(auditTaskIncompletId: Int, auditTaskId: Int, missionId: Int, issueDescription: String, lat: Float, lng: Float)

class AuditTaskIncompleteTable(tag: Tag) extends Table[AuditTaskIncomplete](tag, Some("sidewalk"), "audit_task_incomplete") {
  def auditTaskIncompleteId = column[Int]("audit_task_incomplete_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def missionId = column[Int]("mission_id")
  def issueDescription = column[String]("issue_description")
  def lat = column[Float]("lat")
  def lng = column[Float]("lng")

  def * = (auditTaskIncompleteId, auditTaskId, missionId, issueDescription, lat, lng) <> ((AuditTaskIncomplete.apply _).tupled, AuditTaskIncomplete.unapply)

  def auditTask = foreignKey("audit_task_incomplete_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission = foreignKey("audit_task_incomplete_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskIncompleteTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val incompletes = TableQuery[AuditTaskIncompleteTable]

  def list: Future[Seq[AuditTaskIncomplete]] = db.run {
    incompletes.result
  }

  /**
   * Saves a new audit task environment
   *
   * @param incomplete
   * @return
   */
  def save(incomplete: AuditTaskIncomplete): Future[Int] = db.run {
    (incompletes returning incompletes.map(_.auditTaskIncompleteId)) += incomplete
  }
}
