package formats.json

import java.sql.Timestamp

import models.label._
import play.api.libs.json._
import play.api.libs.functional.syntax._

object LabelFormats {
//  implicit val labelReads: Reads[Label] = (
//    (JsPath \ "label_id").read[Int] and
//      (JsPath \ "audit_task_id").readNullable[Int] and
//      (JsPath \ "gsv_panorama_id").read[String] and
//      (JsPath \ "label_type_id").read[Int] and
//      (JsPath \ "photographer_heading").read[Float] and
//      (JsPath \ "photographer_pitch").read[Float] and
//      (JsPath \ "panorama_lat").read[Float] and
//      (JsPath \ "panorama_lng").read[Float] and
//      (JsPath \ "deleted").read[Boolean] and
//      (JsPath \ "temporary_label_id").readNullable[Int]
//    )(Label.apply _)

  implicit val labelWrites: Writes[Label] = (
    (__ \ "label_id").write[Int] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "photographer_heading").write[Float] and
      (__ \ "photographer_pitch").write[Float] and
      (__ \ "panorama_lat").write[Float] and
      (__ \ "panorama_lng").write[Float] and
      (__ \ "deleted").write[Boolean] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "time_created").writeNullable[Timestamp]
    )(unlift(Label.unapply _))

}
