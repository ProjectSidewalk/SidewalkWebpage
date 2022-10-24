package formats.json

import java.sql.Timestamp

import models.audit.AuditTaskTable.AuditTaskWithALabel
import models.audit.{AuditTask, AuditTaskInteraction}
import play.api.libs.json._

import play.api.libs.functional.syntax._

object TaskFormats {

  implicit val auditTaskWrites: Writes[AuditTask] = (
    (__ \ "audit_task_id").write[Int] and
      (__ \ "amt_assignment_id").writeNullable[Int] and
      (__ \ "user_id").write[String] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "task_start").write[Timestamp] and
      (__ \ "task_end").write[Timestamp] and
      (__ \ "completed").write[Boolean] and
      (__ \ "current_lat").write[Float] and
      (__ \ "current_lng").write[Float] and
      (__ \ "start_point_reversed").write[Boolean]
    )(unlift(AuditTask.unapply _))

  implicit val auditTaskInteractionWrites: Writes[AuditTaskInteraction] = (
    (__ \ "audit_task_interaction_id").write[Int] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "mission_id").write[Int] and
      (__ \ "action").write[String] and
      (__ \ "gsv_panorama_id").writeNullable[String] and
      (__ \ "lat").writeNullable[Float] and
      (__ \ "lng").writeNullable[Float] and
      (__ \ "heading").writeNullable[Float] and
      (__ \ "pitch").writeNullable[Float] and
      (__ \ "zoom").writeNullable[Int] and
      (__ \ "note").writeNullable[String] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "timestamp").write[Timestamp]
    )(unlift(AuditTaskInteraction.unapply _))

  implicit val auditTaskWithALabelWrites: Writes[AuditTaskWithALabel] = (
    (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "task_start").write[Timestamp] and
      (__ \ "task_end").write[Timestamp] and
      (__ \ "label_id").writeNullable[Int] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "label_type").writeNullable[String]
    )(unlift(AuditTaskWithALabel.unapply _))
}
