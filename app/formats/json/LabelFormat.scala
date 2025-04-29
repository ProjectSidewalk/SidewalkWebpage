package formats.json

import models.label._
import models.validation.LabelValidationTable
import play.api.libs.functional.syntax._
import play.api.libs.json._

import java.time.OffsetDateTime

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
      (__ \ "time_created").write[OffsetDateTime] and
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

  implicit val POVWrites: Writes[POV] = (
    (__ \ "heading").write[Double] and
      (__ \ "pitch").write[Double] and
      (__ \ "zoom").write[Int]
    )(unlift(POV.unapply))

  implicit val locationXYWrites: Writes[LocationXY] = (
    (__ \ "x").write[Int] and
      (__ \ "y").write[Int]
    )(unlift(LocationXY.unapply))

  implicit val labelMetadataWrites: Writes[LabelMetadata] = (
    (__ \ "label_id").write[Int] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "tutorial").write[Boolean] and
      (__ \ "image_capture_date").write[String] and
      (__ \ "pov").write[POV] and
      (__ \ "canvas_location").write[LocationXY] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "region_id").write[Int] and
      (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "timestamp").write[OffsetDateTime] and
      (__ \ "label_type").write[String] and
      (__ \ "severity").write[Option[Int]] and
      (__ \ "temporary").write[Boolean] and
      (__ \ "description").write[Option[String]] and
      (__ \ "user_validation").write[Option[Int]] and
      (__ \ "validations").write[Map[String, Int]] and
      (__ \ "tags").write[List[String]] and
      (__ \ "low_quality_incomplete_stale_flags").write[(Boolean, Boolean, Boolean)] and
      (__ \ "comments").write[Option[List[String]]]
    )(unlift(LabelMetadata.unapply))

  def validationLabelMetadataToJson(labelMetadata: LabelValidationMetadata, adminData: Option[AdminValidationData] = None): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "label_type" -> labelMetadata.labelType,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "image_capture_date" -> labelMetadata.imageCaptureDate,
      "label_timestamp" -> labelMetadata.timestamp,
      "lat" -> labelMetadata.lat,
      "lng" -> labelMetadata.lng,
      "camera_lat" -> labelMetadata.cameraLat,
      "camera_lng" -> labelMetadata.cameraLng,
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

  // Has the label metadata excluding a few admin-only fields.
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
      "label_type" -> labelMetadata.labelType,
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

  def labelMetadataWithValidationToJsonAdmin(labelMetadata: LabelMetadata, adminData: AdminValidationData): JsObject = {
    // Start with normal metadata, then add the admin-only fields.
    labelMetadataWithValidationToJson(labelMetadata) ++ Json.obj(
      "audit_task_id" -> labelMetadata.auditTaskId,
      "user_id" -> labelMetadata.userId,
      "username" -> labelMetadata.username,
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

  def labelMetadataUserDashToJson(label: LabelMetadataUserDash, imageUrl: String): JsObject = {
    Json.obj(
      "label_id" -> label.labelId,
      "gsv_panorama_id" -> label.gsvPanoramaId,
      "heading" -> label.heading,
      "pitch" -> label.pitch,
      "zoom" -> label.zoom,
      "canvas_x" -> label.canvasX,
      "canvas_y" -> label.canvasY,
      "label_type" -> label.labelType,
      "time_validated" -> label.timeValidated,
      "validator_comment" -> label.validatorComment,
      "image_url" -> imageUrl
    )
  }

  implicit val tagWrites: Writes[Tag] = (
    (__ \ "tag_id").write[Int] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "tag_name").write[String] and
      (__ \ "mutually_exclusive_with").writeNullable[String]
    )(unlift(Tag.unapply))

  def resumeLabelMetadatatoJson(label: ResumeLabelMetadata, allTags: Seq[Tag]): JsObject = {
    Json.obj(
      "labelId" -> label.labelData.labelId,
      "labelType" -> label.labelType,
      "panoId" -> label.labelData.gsvPanoramaId,
      "panoLat" -> label.panoLat,
      "panoLng" -> label.panoLng,
      "originalPov" -> Json.obj(
        "heading" -> label.pointData.heading,
        "pitch" -> label.pointData.pitch,
        "zoom" -> label.pointData.zoom
      ),
      "cameraHeading" -> label.cameraHeading,
      "cameraPitch" -> label.cameraPitch,
      "panoWidth" -> label.panoWidth,
      "panoHeight" -> label.panoHeight,
      "tagIds" -> label.labelData.tags.flatMap(t => allTags.filter(at => at.tag == t && at.labelTypeId == LabelTypeTable.labelTypeToId(label.labelType)).map(_.tagId).headOption),
      "severity" -> label.labelData.severity,
      "tutorial" -> label.labelData.tutorial,
      "temporaryLabelId" -> label.labelData.temporaryLabelId,
      "temporaryLabel" -> label.labelData.temporary,
      "description" -> label.labelData.description,
      "canvasX" -> label.pointData.canvasX,
      "canvasY" -> label.pointData.canvasY,
      "panoX" -> label.pointData.panoX,
      "panoY" -> label.pointData.panoY,
      "auditTaskId" -> label.labelData.auditTaskId,
      "missionId" -> label.labelData.missionId,
      "labelLat" -> label.pointData.lat,
      "labelLng" -> label.pointData.lng
    )
  }
}
