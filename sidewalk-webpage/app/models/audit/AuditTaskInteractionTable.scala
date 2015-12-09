package models.audit

import java.sql.Timestamp

import models.label.LabelTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AuditTaskInteraction(auditTaskInteractionId: Int, auditTaskId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], temporaryLabelId: Option[Int], timestamp: java.sql.Timestamp)

class AuditTaskInteractionTable(tag: Tag) extends Table[AuditTaskInteraction](tag, Some("sidewalk"), "audit_task_interaction") {
  def auditTaskInteractionId = column[Int]("audit_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def action = column[String]("action", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.Nullable)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def heading = column[Option[Float]]("heading", O.Nullable)
  def pitch = column[Option[Float]]("pitch", O.Nullable)
  def zoom = column[Option[Int]]("zoom", O.Nullable)
  def note = column[Option[String]]("note", O.Nullable)
  def temporaryLabelId = column[Option[Int]]("temporary_label_id", O.Nullable)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)

  def * = (auditTaskInteractionId, auditTaskId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note,
    temporaryLabelId, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskInteractionTable {
  val db = play.api.db.slick.DB
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
  val labels = TableQuery[LabelTable]

  def save(interaction: AuditTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Int =
      (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)).insert(interaction)
    interactionId
  }

  /**
   * Get a list of audit task interaction
   * @param auditTaskId
   * @return
   */
  def auditInteractions(auditTaskId: Int): List[AuditTaskInteraction] = db.withSession { implicit session =>
    auditTaskInteractions.leftJoin(labels)
    auditTaskInteractions.filter(record => record.auditTaskId === auditTaskId).list
  }
}
