package formats.json

import models.label.LabelType
import models.mission.{Mission, MissionType}
import play.api.libs.functional.syntax.*
import play.api.libs.json.*

import java.time.OffsetDateTime

object MissionFormats {
  given missionWrites: Writes[Mission] = (
    (__ \ "mission_id").write[Int] and
      (__ \ "mission_type").write[String].contramap[MissionType](_.name) and
      (__ \ "user_id").write[String] and
      (__ \ "mission_start").write[OffsetDateTime] and
      (__ \ "mission_end").write[OffsetDateTime] and
      (__ \ "completed").write[Boolean] and
      (__ \ "pay").write[Double] and
      (__ \ "paid").write[Boolean] and
      (__ \ "distance_meters").writeNullable[Double] and
      (__ \ "distance_progress").writeNullable[Double] and
      (__ \ "region_id").writeNullable[Int] and
      (__ \ "labels_validated").writeNullable[Int] and
      (__ \ "labels_progress").writeNullable[Int] and
      (__ \ "label_type").writeNullable[LabelType] and
      (__ \ "skipped").write[Boolean] and
      (__ \ "current_audit_task_id").writeNullable[Int] and
      (__ \ "user_route_id").writeNullable[Int]
  )((o: Mission) => Tuple.fromProductTyped(o))
}
