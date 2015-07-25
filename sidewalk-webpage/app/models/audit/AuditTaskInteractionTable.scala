package models.audit

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AuditTaskInteraction(auditTaskInteractionId: Int, auditTaskId: Int, action: String, gsvPanoramaId: String, lat: Float, lng: Float, heading: Float, pitch: Float, zoom: Int, note: String, timestamp: Timestamp)

/**
 *
 */
class AuditTaskInteractionTable(tag: Tag) extends Table[AuditTaskInteraction](tag, Some("sidewalk"), "audit_task_interaction") {
  def auditTaskInteractionId = column[Int]("audit_task_interaction_id", O.PrimaryKey)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def action = column[String]("action", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def lat = column[Float]("lat", O.NotNull)
  def lng = column[Float]("lng", O.NotNull)
  def heading = column[Float]("heading", O.NotNull)
  def pitch = column[Float]("pitch", O.NotNull)
  def zoom = column[Int]("zoom", O.NotNull)
  def note = column[String]("note")
  def timestamp = column[Timestamp]("timestamp")

  def * = (auditTaskInteractionId, auditTaskId, action, gsvPanoramaId, lat, lng, heading, pitch, zoom, note, timestamp) <> ((AuditTaskInteraction.apply _).tupled, AuditTaskInteraction.unapply)
}

/**
 * Data access object for the label table
 */
object AuditTaskInteractionTable {
  val db = play.api.db.slick.DB
  val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
}
