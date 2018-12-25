package formats.json

import java.sql.Timestamp

import models.audit.AuditTaskTable.AuditMission
import play.api.libs.json._

import play.api.libs.functional.syntax._

object MissionFormat {

  implicit val auditMissionWrites: Writes[AuditMission] = (
    (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "mission_id").write[Int] and
      (__ \ "completed").write[Boolean] and
      (__ \ "mission_start").write[Timestamp] and
      (__ \ "mission_end").write[Timestamp] and
      (__ \ "label_id").writeNullable[Int] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "label_type").writeNullable[String]
    )(unlift(AuditMission.unapply _))
}
