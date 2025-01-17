package formats.json

import java.sql.Timestamp
import models.mission.{Mission, MissionTypeTable}
import play.api.libs.json._
import play.api.libs.functional.syntax._

object MissionFormats {
  implicit val missionWrites: Writes[Mission] = (
    (__ \ "mission_id").write[Int] and
      (__ \ "mission_type").write[String].contramap[Int](MissionTypeTable.missionTypeIdToMissionType) and
      (__ \ "user_id").write[String] and
      (__ \ "mission_start").write[Timestamp] and
      (__ \ "mission_end").write[Timestamp] and
      (__ \ "completed").write[Boolean] and
      (__ \ "pay").write[Double] and
      (__ \ "paid").write[Boolean] and
      (__ \ "distance_meters").writeNullable[Float] and
      (__ \ "distance_progress").writeNullable[Float] and
      (__ \ "region_id").writeNullable[Int] and
      (__ \ "labels_validated").writeNullable[Int] and
      (__ \ "labels_progress").writeNullable[Int] and
      (__ \ "label_type_id").writeNullable[Int] and
      (__ \ "skipped").write[Boolean] and
      (__ \ "current_audit_task_id").writeNullable[Int]
  )(unlift(Mission.unapply))
}
