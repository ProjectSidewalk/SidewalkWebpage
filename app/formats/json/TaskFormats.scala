package formats.json

import org.locationtech.jts.geom.Point
import models.audit.{AuditTask, AuditTaskInteraction, AuditTaskWithALabel, NewTask}
import models.street.StreetEdgePriority
import models.utils.MyPostgresProfile.api._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import service.UpdatedStreets

import java.time.OffsetDateTime

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
      (__ \ "task_start").write[OffsetDateTime] and
      (__ \ "task_end").write[OffsetDateTime] and
      (__ \ "completed").write[Boolean] and
      (__ \ "current_lat").write[Float] and
      (__ \ "current_lng").write[Float] and
      (__ \ "start_point_reversed").write[Boolean] and
      (__ \ "current_mission_id").writeNullable[Int] and
      (__ \ "current_mission_start").writeNullable[Point] and
      (__ \ "low_quality").write[Boolean] and
      (__ \ "incomplete").write[Boolean] and
      (__ \ "stale").write[Boolean]
    )(unlift(AuditTask.unapply))

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
      (__ \ "timestamp").write[OffsetDateTime]
    )(unlift(AuditTaskInteraction.unapply))

  implicit val auditTaskWithALabelWrites: Writes[AuditTaskWithALabel] = (
    (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "task_start").write[OffsetDateTime] and
      (__ \ "task_end").write[OffsetDateTime] and
      (__ \ "label_id").writeNullable[Int] and
      (__ \ "temporary_label_id").write[Int] and
      (__ \ "label_type").writeNullable[String]
    )(unlift(AuditTaskWithALabel.unapply))

  implicit val newTaskWrites: Writes[NewTask] = (task: NewTask) => {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> task.geom,
      "properties" -> Json.obj(
        "street_edge_id" -> task.edgeId,
        "current_lng" -> task.currentLng,
        "current_lat" -> task.currentLat,
        "way_type" -> task.wayType,
        "start_point_reversed" -> task.startPointReversed,
        "task_start" -> task.taskStart.toString,
        "completed_by_any_user" -> task.completedByAnyUser,
        "priority" -> task.priority,
        "completed" -> task.completed,
        "audit_task_id" -> task.auditTaskId,
        "current_mission_id" -> task.currentMissionId,
        "current_mission_start" -> task.currentMissionStart,
        //"current_mission_start" -> currentMissionStart.map(p => geojson.LatLng(p.getY, p.getX)),
        "route_street_id" -> task.routeStreetId
      )
    )
  }

  implicit val streetEdgePriorityWrites: Writes[StreetEdgePriority] = (streetPriority: StreetEdgePriority) => {
    Json.obj(
      "street_edge_id" -> streetPriority.streetEdgeId,
      "priority" -> streetPriority.priority
    )
  }

  implicit val updatedStreetsWrites: Writes[UpdatedStreets] = (
    (__ \ "last_priority_update_time").write[OffsetDateTime] and
      (__ \ "updated_street_priorities").write[Seq[StreetEdgePriority]]
    )(unlift(UpdatedStreets.unapply))
}
