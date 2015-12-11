package models.audit

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskIncomplete(auditTaskIncompletId: Int, auditTaskId: Int, issueDescription: String, lat: Float, lng: Float)

class AuditTaskIncompleteTable(tag: Tag) extends Table[AuditTaskIncomplete](tag, Some("sidewalk"), "audit_task_incomplete") {
  def auditTaskIncompleteId = column[Int]("audit_task_incomplete_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def issueDescription = column[String]("issue_description", O.NotNull)
  def lat = column[Float]("lat", O.NotNull)
  def lng = column[Float]("lng", O.NotNull)

  def * = (auditTaskIncompleteId, auditTaskId, issueDescription, lat, lng) <> ((AuditTaskIncomplete.apply _).tupled, AuditTaskIncomplete.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("audit_task_incomplete_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskIncompleteTable {
  val db = play.api.db.slick.DB
  val incompletes = TableQuery[AuditTaskIncompleteTable]

  def list: List[AuditTaskIncomplete] = db.withTransaction { implicit session =>
    incompletes.list
  }

  /**
   * Saves a new audit task environment
   *
   * Reference for getting the item that has been inserted right now.
   * http://stackoverflow.com/questions/21894377/returning-autoinc-id-after-insert-in-slick-2-0
   * @param incomplete
   * @return
   */
  def save(incomplete: AuditTaskIncomplete): Int = db.withTransaction { implicit session =>
    val auditTaskIncompleteId: Int =
      (incompletes returning incompletes.map(_.auditTaskIncompleteId)) += incomplete
    auditTaskIncompleteId
  }
}
