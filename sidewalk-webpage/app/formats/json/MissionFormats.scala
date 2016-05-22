package formats.json

import models.mission.Mission
import play.api.libs.json._
import play.api.libs.functional.syntax._

object MissionFormats {
  case class MissionSubmission(label: String, level: Int, regionId: Option[Int], distance: Option[Double], coverage: Option[Double])

  implicit val missionSubmissionReads: Reads[MissionSubmission] = (
    (JsPath \ "label").read[String] and
      (JsPath \ "level").read[Int] and
      (JsPath \ "region_id").readNullable[Int] and
      (JsPath \ "distance").readNullable[Double] and
      (JsPath \ "coverage").readNullable[Double]
    )(MissionSubmission.apply _)

  implicit val missionReads: Reads[Mission] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "region_id").readNullable[Int] and
      (JsPath \ "label").read[String] and
      (JsPath \ "level").read[Int] and
      (JsPath \ "distance").readNullable[Double] and
      (JsPath \ "distance_ft").readNullable[Double] and
      (JsPath \ "distance_mi").readNullable[Double] and
      (JsPath \ "coverage").readNullable[Double] and
      (JsPath \ "deleted").read[Boolean]
    )(Mission.apply _)

  implicit val missionWrites: Writes[Mission] = (
    (__ \ "missionId").write[Int] and
      (__ \ "regionId").writeNullable[Int] and
      (__ \ "label").write[String] and
      (__ \ "level").write[Int] and
      (__ \ "distance").writeNullable[Double] and
      (__ \ "distance_ft").writeNullable[Double] and
      (__ \ "distance_mi").writeNullable[Double] and
      (__ \ "coverage").writeNullable[Double] and
      (__ \ "deleted").write[Boolean]
    )(unlift(Mission.unapply _))


}
