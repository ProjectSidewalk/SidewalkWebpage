package formats.json

import models.mission.Mission
import play.api.libs.json._
import play.api.libs.functional.syntax._

object MissionFormats {
  implicit val missionReads: Reads[Mission] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "region_id").readNullable[Int] and
      (JsPath \ "mission").read[String] and
      (JsPath \ "level").read[Double] and
      (JsPath \ "deleted").read[Boolean]
    )(Mission.apply _)

  implicit val missionWrites: Writes[Mission] = (
    (__ \ "missionId").write[Int] and
      (__ \ "regionId").writeNullable[Int] and
      (__ \ "mission").write[String] and
      (__ \ "level").write[Double] and
      (__ \ "deleted").write[Boolean]
    )(unlift(Mission.unapply _))
}
