package models.audit

import java.sql.Timestamp

import models.label._
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.jdbc.{StaticQuery => Q, GetResult}

case class AuditTaskInteraction(auditTaskInteractionId: Int, auditTaskId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], temporaryLabelId: Option[Int], timestamp: java.sql.Timestamp)

case class InteractionWithLabel(auditTaskInteractionId: Int, auditTaskId: Int, action: String,
                                gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float],
                                heading: Option[Float], pitch: Option[Float], zoom: Option[Int],
                                note: Option[String], timestamp: java.sql.Timestamp,
                                labelType: Option[String], labelLat: Option[Float], labelLng: Option[Float])

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
  val labelPoints = TableQuery[LabelPointTable]

  implicit val interactionWithLabelConverter = GetResult[InteractionWithLabel](r => {
    InteractionWithLabel(r.nextInt, r.nextInt, r.nextString, r.nextStringOption, r.nextFloatOption, r.nextFloatOption,
      r.nextFloatOption, r.nextFloatOption, r.nextIntOption, r.nextStringOption, r.nextTimestamp,
      r.nextStringOption, r.nextFloatOption, r.nextFloatOption)
  })


  def save(interaction: AuditTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Int =
      (auditTaskInteractions returning auditTaskInteractions.map(_.auditTaskInteractionId)).insert(interaction)
    interactionId
  }

  /**
   * Get a list of audit task interaction
    *
    * @param auditTaskId
   * @return
   */
  def auditInteractions(auditTaskId: Int): List[AuditTaskInteraction] = db.withSession { implicit session =>
    auditTaskInteractions.filter(record => record.auditTaskId === auditTaskId).list
  }

  /**
    * Get a list of audit task interactions with corresponding labels.
    * It would be faster to do this with a raw sql query. Update if too slow.
    *
    * @param auditTaskId
    * @return
    */
  def auditInteractionsWithLabels(auditTaskId: Int): List[InteractionWithLabel] = db.withSession { implicit session =>
    val selectInteractionWithLabelQuery = Q.query[Int, InteractionWithLabel](
      """SELECT interaction.audit_task_interaction_id, interaction.audit_task_id, interaction.action,
        |interaction.gsv_panorama_id, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
        |interaction.zoom, interaction. note, interaction.timestamp, label_type.label_type,
        |label_point.lat AS label_lat, label_point.lng AS label_lng
        |FROM sidewalk.audit_task_interaction AS interaction
        |LEFT JOIN sidewalk.label
        |ON interaction.temporary_label_id = label.temporary_label_id
        |AND interaction.audit_task_id = label.audit_task_id
        |LEFT JOIN sidewalk.label_type
        |ON label.label_type_id = label_type.label_type_id
        |LEFT JOIN sidewalk.label_point
        |ON label.label_id = label_point.label_id
        |WHERE interaction.audit_task_id = ?
        |ORDER BY interaction.timestamp""".stripMargin
    )
    val interactions: List[InteractionWithLabel] = selectInteractionWithLabelQuery(auditTaskId).list
    interactions
  }
}
