package formats.json

import models.gsv.GSVDataSlim
import models.label.{AdminValidationData, LabelMetadata, LabelValidationTableDef, LabelMetadataUserDash, LabelValidationMetadata, LabelCVMetadata}
import java.sql.Timestamp
import models.label._
import play.api.libs.json._
import play.api.libs.functional.syntax._

object LabelFormat {
  implicit val labelWrites: Writes[Label] = (
    (__ \ "label_id").write[Int] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "mission_id").write[Int] and
      (__ \ "user_id").write[String] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "deleted").write[Boolean] and
      (__ \ "temporary_label_id").write[Int] and
      (__ \ "time_created").write[Timestamp] and
      (__ \ "tutorial").write[Boolean] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "agree_count").write[Int] and
      (__ \ "disagree_count").write[Int] and
      (__ \ "unsure_count").write[Int] and
      (__ \ "correct").writeNullable[Boolean] and
      (__ \ "severity").writeNullable[Int] and
      (__ \ "temporary").write[Boolean] and
      (__ \ "description").writeNullable[String] and
      (__ \ "tags").write[List[String]]
    )(unlift(Label.unapply))

  implicit val labelCVMetadataWrite: Writes[LabelCVMetadata] = (
    (__ \ "label_id").write[Int] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "agree_count").write[Int] and
      (__ \ "disagree_count").write[Int] and
      (__ \ "unsure_count").write[Int] and
      (__ \ "pano_width").writeNullable[Int] and
      (__ \ "pano_height").writeNullable[Int] and
      (__ \ "pano_x").write[Int] and
      (__ \ "pano_y").write[Int] and
      (__ \ "canvas_width").write[Int] and
      (__ \ "canvas_height").write[Int] and
      (__ \ "canvas_x").write[Int] and
      (__ \ "canvas_y").write[Int] and
      (__ \ "zoom").write[Int] and
      (__ \ "heading").write[Float] and
      (__ \ "pitch").write[Float] and
      (__ \ "camera_heading").write[Float] and
      (__ \ "camera_pitch").write[Float]
  )(unlift(LabelCVMetadata.unapply))

  implicit val gsvDataSlimWrite: Writes[GSVDataSlim] = (
    (__ \ "gsv_panorama_id").write[String] and
      (__ \ "width").writeNullable[Int] and
      (__ \ "height").writeNullable[Int] and
      (__ \ "lat").writeNullable[Float] and
      (__ \ "lng").writeNullable[Float] and
      (__ \ "camera_heading").writeNullable[Float] and
      (__ \ "camera_pitch").writeNullable[Float]
    )(unlift(GSVDataSlim.unapply))

  def validationLabelMetadataToJson(labelMetadata: LabelValidationMetadata, adminData: Option[AdminValidationData] = None): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "label_type" -> labelMetadata.labelType,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "image_capture_date" -> labelMetadata.imageCaptureDate,
      "label_timestamp" -> labelMetadata.timestamp,
      "lat" -> labelMetadata.lat,
      "lng" -> labelMetadata.lng,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasXY.x,
      "canvas_y" -> labelMetadata.canvasXY.y,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "street_edge_id" -> labelMetadata.streetEdgeId,
      "region_id" -> labelMetadata.regionId,
      "correct" -> labelMetadata.validationInfo.correct,
      "agree_count" -> labelMetadata.validationInfo.agreeCount,
      "disagree_count" -> labelMetadata.validationInfo.disagreeCount,
      "unsure_count" -> labelMetadata.validationInfo.unsureCount,
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "tags" -> labelMetadata.tags,
      "admin_data" -> adminData.map(ad => Json.obj(
        "username" -> ad.username,
        "previous_validations" -> ad.previousValidations.map(prevVal => Json.obj(
          "username" -> prevVal._1,
          "validation" -> LabelValidationTable.validationOptions.get(prevVal._2)
        ))
      ))
    )
  }

  def labelMetadataWithValidationToJsonAdmin(labelMetadata: LabelMetadata, adminData: AdminValidationData): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
      "image_capture_date" -> labelMetadata.imageCaptureDate,
      "heading" -> labelMetadata.pov.heading,
      "pitch" -> labelMetadata.pov.pitch,
      "zoom" -> labelMetadata.pov.zoom,
      "canvas_x" -> labelMetadata.canvasXY.x,
      "canvas_y" -> labelMetadata.canvasXY.y,
      "audit_task_id" -> labelMetadata.auditTaskId,
      "street_edge_id" -> labelMetadata.streetEdgeId,
      "region_id" -> labelMetadata.regionId,
      "user_id" -> labelMetadata.userId,
      "username" -> labelMetadata.username,
      "timestamp" -> labelMetadata.timestamp,
      "label_type_key" -> labelMetadata.labelTypeKey,
      "label_type_value" -> labelMetadata.labelTypeValue,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "num_agree" -> labelMetadata.validations("agree"),
      "num_disagree" -> labelMetadata.validations("disagree"),
      "num_unsure" -> labelMetadata.validations("unsure"),
      "tags" -> labelMetadata.tags,
      "low_quality" -> labelMetadata.lowQualityIncompleteStaleFlags._1,
      "incomplete" -> labelMetadata.lowQualityIncompleteStaleFlags._2,
      "stale" -> labelMetadata.lowQualityIncompleteStaleFlags._3,
      // The part below is just lifted straight from Admin Validate without much care.
      "admin_data" -> Json.obj(
        "username" -> adminData.username,
        "previous_validations" -> adminData.previousValidations.map(prevVal => Json.obj(
          "username" -> prevVal._1,
          "validation" -> LabelValidationTable.validationOptions.get(prevVal._2)
        ))
      )
    )
  }

  // Has the label metadata excluding username, user_id, and audit_task_id.
  def labelMetadataWithValidationToJson(labelMetadata: LabelMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
      "image_capture_date" -> labelMetadata.imageCaptureDate,
      "heading" -> labelMetadata.pov.heading,
      "pitch" -> labelMetadata.pov.pitch,
      "zoom" -> labelMetadata.pov.zoom,
      "canvas_x" -> labelMetadata.canvasXY.x,
      "canvas_y" -> labelMetadata.canvasXY.y,
      "street_edge_id" -> labelMetadata.streetEdgeId,
      "region_id" -> labelMetadata.regionId,
      "timestamp" -> labelMetadata.timestamp,
      "label_type_key" -> labelMetadata.labelTypeKey,
      "label_type_value" -> labelMetadata.labelTypeValue,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "num_agree" -> labelMetadata.validations("agree"),
      "num_disagree" -> labelMetadata.validations("disagree"),
      "num_unsure" -> labelMetadata.validations("unsure"),
      "comments" -> labelMetadata.comments,
      "tags" -> labelMetadata.tags
    )
  }

//  def labelMetadataUserDashToJson(label: LabelMetadataUserDash): JsObject = {
//    Json.obj(
//      "label_id" -> label.labelId,
//      "gsv_panorama_id" -> label.gsvPanoramaId,
//      "heading" -> label.heading,
//      "pitch" -> label.pitch,
//      "zoom" -> label.zoom,
//      "canvas_x" -> label.canvasX,
//      "canvas_y" -> label.canvasY,
//      "label_type" -> label.labelType,
//      "time_validated" -> label.timeValidated,
//      "validator_comment" -> label.validatorComment,
//      "image_url" -> GoogleMapsHelper.getImageUrl(label.gsvPanoramaId, label.heading, label.pitch, label.zoom)
//    )
//  }

  implicit val tagWrites: Writes[Tag] = (
    (__ \ "tag_id").write[Int] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "tag_name").write[String] and
      (__ \ "mutually_exclusive_with").writeNullable[String]
    )(unlift(Tag.unapply))
}
