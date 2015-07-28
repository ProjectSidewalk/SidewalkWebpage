package models.audit

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AuditTaskInteraction(auditTaskInteractionId: Option[Int], auditTaskId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], timestamp: java.sql.Timestamp)

/**
 *
 */
class AuditTaskInteractionTable(tag: Tag) extends Table[AuditTaskInteraction](tag, Some("sidewalk"), "audit_task_interaction") {
  def auditTaskInteractionId = column[Option[Int]]("audit_task_interaction_id", O.PrimaryKey)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def action = column[String]("action", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.NotNull)
  def lat = column[Option[Float]]("lat", O.NotNull)
  def lng = column[Option[Float]]("lng", O.NotNull)
  def heading = column[Option[Float]]("heading", O.NotNull)
  def pitch = column[Option[Float]]("pitch", O.NotNull)
  def zoom = column[Option[Int]]("zoom", O.NotNull)
  def note = column[Option[String]]("note")
  def timestamp = column[java.sql.Timestamp]("timestamp")

  def * = (auditTaskInteractionId, auditTaskId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskInteractionTable {
  val db = play.api.db.slick.DB
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]

  def save(interaction: AuditTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Option[Int] =
      (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)) += interaction
    interactionId.getOrElse(-1)
  }

}
