package formats.json

import java.sql.Timestamp

import models.label._
import play.api.libs.json._
import play.api.libs.functional.syntax._

object LabelFormat {
  implicit val labelWrites: Writes[Label] = (
    (__ \ "label_id").write[Int] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "mission_id").write[Int] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "photographer_heading").write[Float] and
      (__ \ "photographer_pitch").write[Float] and
      (__ \ "panorama_lat").write[Float] and
      (__ \ "panorama_lng").write[Float] and
      (__ \ "deleted").write[Boolean] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "time_created").writeNullable[Timestamp] and
      (__ \ "tutorial").write[Boolean] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "agree_count").write[Int] and
      (__ \ "disagree_count").write[Int] and
      (__ \ "notsure_count").write[Int] and
      (__ \ "correct").writeNullable[Boolean]
    )(unlift(Label.unapply _))
}
