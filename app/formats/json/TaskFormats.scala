package formats.json

import java.sql.Timestamp
import com.vividsolutions.jts.geom.Point

import models.audit.{AuditTask, AuditTaskInteraction}
import play.api.libs.json._

import play.api.libs.functional.syntax._

object TaskFormats {
  implicit val pointWrites: Writes[Point] = Writes { point =>
    Json.obj(
      "lat" -> point.getX,
      "lng" -> point.getY
    )
  }

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
      (__ \ "start_point_reversed").write[Boolean] and
      (__ \ "current_mission_id").writeNullable[Int] and
      (__ \ "current_mission_start").writeNullable[Point] and
      (__ \ "low_quality").write[Boolean] and
      (__ \ "incomplete").write[Boolean] and
      (__ \ "stale").write[Boolean]
    )(unlift(AuditTask.unapply _))

  implicit val auditTaskInteractionWrites: Writes[AuditTaskInteraction] = (
    (__ \ "audit_task_interaction_id").write[Long] and
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
}
