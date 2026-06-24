package formats.json

import models.label._
import models.pano.{PanoData, PanoViewerMetadata}
import play.api.libs.functional.syntax._
import play.api.libs.json._

import java.time.OffsetDateTime

object LabelFormats {
  implicit val labelTypeEnumWrites: Writes[LabelTypeEnum.Base] = Writes(lt => JsString(lt.name))

  implicit val labelWrites: Writes[Label] = (
    (__ \ "label_id").write[Int] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "mission_id").write[Int] and
      (__ \ "user_id").write[String] and
      (__ \ "pano_id").write[String] and
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
      (__ \ "description").writeNullable[String] and
      (__ \ "tags").write[List[String]]
  )(unlift(Label.unapply))

  implicit val POVWrites: Writes[POV] = (
    (__ \ "heading").write[Double] and
      (__ \ "pitch").write[Double] and
      (__ \ "zoom").write[Double]
  )(unlift(POV.unapply))

  implicit val locationXYWrites: Writes[LocationXY] = (
    (__ \ "x").write[Int] and
      (__ \ "y").write[Int]
  )(unlift(LocationXY.unapply))

  implicit val labelTypeReads: Reads[LabelTypeEnum.Base] = Reads { json =>
    val errorSubstring =
      s"Valid types are: ${LabelTypeEnum.primaryLabelTypes.mkString(", ")}. Or you can use their IDs: ${LabelTypeEnum.primaryLabelTypeIds.mkString(", ")}."

    // Try parsing as either the ID number as an int, or the name as a String.
    json match {
      case JsString(value) =>
        LabelTypeEnum.byName.get(value) match {
          case Some(labelType) => JsSuccess(labelType)
          case None            => JsError(s"Invalid LabelType name: $value. $errorSubstring")
        }
      case JsNumber(value) =>
        val intValue = value.toInt
        LabelTypeEnum.byId.get(intValue) match {
          case Some(labelType) => JsSuccess(labelType)
          case None            => JsError(s"Invalid LabelType ID: $intValue. $errorSubstring")
        }
      case _ =>
        JsError(s"Expected a string or integer. $errorSubstring")
    }
  }

  implicit val labelMetadataWrites: Writes[LabelMetadata] = Writes { m =>
    Json.obj(
      "label_id"                           -> m.labelId,
      "pano_id"                            -> m.panoId,
      "tutorial"                           -> m.tutorial,
      "image_capture_date"                 -> m.imageCaptureDate,
      "pov"                                -> m.pov,
      "canvas_location"                    -> m.canvasXY,
      "audit_task_id"                      -> m.auditTaskId,
      "street_edge_id"                     -> m.streetEdgeId,
      "region_id"                          -> m.regionId,
      "user_id"                            -> m.userId,
      "username"                           -> m.username,
      "timestamp"                          -> m.timestamp,
      "label_type"                         -> m.labelType,
      "severity"                           -> m.severity,
      "description"                        -> m.description,
      "user_validation"                    -> m.userValidation.map(_.toString),
      "ai_validation"                      -> m.aiValidation.map(_.toString),
      "validations"                        -> m.validations,
      "tags"                               -> m.tags,
      "low_quality_incomplete_stale_flags" -> m.lowQualityIncompleteStaleFlags,
      "comments"                           -> m.comments.map(_.comment),
      "camera_lat"                         -> m.cameraLocation.map(_.lat),
      "camera_lng"                         -> m.cameraLocation.map(_.lng),
      "ai_generated"                       -> m.aiGenerated,
      "expired"                            -> m.expired
    )
  }

  def validationLabelMetadataToJson(
      labelMetadata: LabelValidationMetadata,
      backupImageUrl: Option[String],
      adminData: Option[AdminValidationData] = None
  ): JsObject = {
    Json.obj(
      "label_id"            -> labelMetadata.labelId,
      "label_type"          -> labelMetadata.labelType.name,
      "pano_id"             -> labelMetadata.panoId,
      "image_capture_date"  -> labelMetadata.imageCaptureDate,
      "label_timestamp"     -> labelMetadata.timestamp,
      "lat"                 -> labelMetadata.location.lat,
      "lng"                 -> labelMetadata.location.lng,
      "camera_lat"          -> labelMetadata.cameraLocation.map(_.lat),
      "camera_lng"          -> labelMetadata.cameraLocation.map(_.lng),
      "heading"             -> labelMetadata.pov.heading,
      "pitch"               -> labelMetadata.pov.pitch,
      "zoom"                -> labelMetadata.pov.zoom,
      "canvas_x"            -> labelMetadata.canvasXY.x,
      "canvas_y"            -> labelMetadata.canvasXY.y,
      "severity"            -> labelMetadata.severity,
      "description"         -> labelMetadata.description,
      "street_edge_id"      -> labelMetadata.streetEdgeId,
      "region_id"           -> labelMetadata.regionId,
      "correct"             -> labelMetadata.validationInfo.correct,
      "agree_count"         -> labelMetadata.validationInfo.agreeCount,
      "disagree_count"      -> labelMetadata.validationInfo.disagreeCount,
      "unsure_count"        -> labelMetadata.validationInfo.unsureCount,
      "user_validation"     -> labelMetadata.validationInfo.userValidation.map(_.toString),
      "ai_validation"       -> labelMetadata.validationInfo.aiValidation.map(_.toString),
      "tags"                -> labelMetadata.tags,
      "ai_tags"             -> labelMetadata.aiTags,
      "ai_tags_not_present" -> labelMetadata.aiTagsNotPresent,
      "ai_generated"        -> labelMetadata.aiGenerated,
      "expired"             -> labelMetadata.expired,
      "comments"            -> labelMetadata.comments.map(_.comment),
      "from_current_user"   -> labelMetadata.fromCurrentUser,
      "backup_image_url"    -> backupImageUrl,
      "pano_data"           -> labelMetadata.panoMetadata.map(panoViewerMetadataToJson),
      "admin_data"          -> adminData.map(ad =>
        Json.obj(
          "username"             -> ad.username,
          "previous_validations" -> ad.previousValidations.map(prevVal =>
            Json.obj(
              "username"   -> prevVal._1,
              "validation" -> prevVal._2.toString
            )
          )
        )
      )
    )
  }

  // Has the label metadata excluding a few admin-only fields.
  def labelMetadataWithValidationToJson(labelMetadata: LabelMetadata): JsObject = {
    Json.obj(
      "label_id"           -> labelMetadata.labelId,
      "pano_id"            -> labelMetadata.panoId,
      "tutorial"           -> labelMetadata.tutorial,
      "image_capture_date" -> labelMetadata.imageCaptureDate,
      "heading"            -> labelMetadata.pov.heading,
      "pitch"              -> labelMetadata.pov.pitch,
      "zoom"               -> labelMetadata.pov.zoom,
      "canvas_x"           -> labelMetadata.canvasXY.x,
      "canvas_y"           -> labelMetadata.canvasXY.y,
      "camera_lat"         -> labelMetadata.cameraLocation.map(_.lat),
      "camera_lng"         -> labelMetadata.cameraLocation.map(_.lng),
      "street_edge_id"     -> labelMetadata.streetEdgeId,
      "region_id"          -> labelMetadata.regionId,
      "timestamp"          -> labelMetadata.timestamp,
      "label_type"         -> labelMetadata.labelType.name,
      "severity"           -> labelMetadata.severity,
      "description"        -> labelMetadata.description,
      "user_validation"    -> labelMetadata.userValidation.map(_.toString),
      "ai_validation"      -> labelMetadata.aiValidation.map(_.toString),
      "num_agree"          -> labelMetadata.validations("agree"),
      "num_disagree"       -> labelMetadata.validations("disagree"),
      "num_unsure"         -> labelMetadata.validations("unsure"),
      "comments"           -> labelMetadata.comments.map(_.comment),
      "tags"               -> labelMetadata.tags,
      "ai_generated"       -> labelMetadata.aiGenerated,
      "expired"            -> labelMetadata.expired,
      "from_current_user"  -> labelMetadata.fromCurrentUser,
      "pano_data"          -> labelMetadata.panoMetadata.map(panoViewerMetadataToJson)
    )
  }

  def labelMetadataWithValidationToJsonAdmin(
      labelMetadata: LabelMetadata,
      adminData: AdminValidationData
  ): JsObject = {
    // Start with normal metadata, then add the admin-only fields.
    labelMetadataWithValidationToJson(labelMetadata) ++ Json.obj(
      "audit_task_id" -> labelMetadata.auditTaskId,
      "user_id"       -> labelMetadata.userId,
      "username"      -> labelMetadata.username,
      "comments"      -> labelMetadata.comments.map(c => Json.obj("username" -> c.username, "comment" -> c.comment)),
      "low_quality"   -> labelMetadata.lowQualityIncompleteStaleFlags._1,
      "incomplete"    -> labelMetadata.lowQualityIncompleteStaleFlags._2,
      "stale"         -> labelMetadata.lowQualityIncompleteStaleFlags._3,
      // The part below is just lifted straight from Expert Validate without much care.
      "admin_data" -> Json.obj(
        "username"             -> adminData.username,
        "previous_validations" -> adminData.previousValidations.map(prevVal =>
          Json.obj(
            "username"   -> prevVal._1,
            "validation" -> prevVal._2.toString
          )
        )
      )
    )
  }

  def labelMetadataUserDashToJson(label: LabelMetadataUserDash, imageUrl: Option[String]): JsObject = {
    Json.obj(
      "label_id"          -> label.labelId,
      "pano_id"           -> label.panoId,
      "heading"           -> label.pov.heading,
      "pitch"             -> label.pov.pitch,
      "zoom"              -> label.pov.zoom,
      "canvas_x"          -> label.canvasX,
      "canvas_y"          -> label.canvasY,
      "label_type"        -> label.labelType.name,
      "time_validated"    -> label.timeValidated,
      "validator_comment" -> label.validatorComment,
      "image_url"         -> imageUrl
    )
  }

  implicit val tagWrites: Writes[Tag] = (
    (__ \ "tag_id").write[Int] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "tag_name").write[String] and
      (__ \ "mutually_exclusive_with").writeNullable[String]
  )(unlift(Tag.unapply))

  /** Serializes a PanoViewerMetadata to the JSON shape the frontend expects under the "pano_data" key. */
  private def panoViewerMetadataToJson(pm: PanoViewerMetadata): JsObject = Json.obj(
    "width"          -> pm.width,
    "height"         -> pm.height,
    "tile_width"     -> pm.tileWidth,
    "tile_height"    -> pm.tileHeight,
    "camera_heading" -> pm.cameraHeading,
    "camera_pitch"   -> pm.cameraPitch,
    "camera_roll"    -> pm.cameraRoll,
    "copyright"      -> pm.copyright
  )

  /**
   * Builds the JSON payload for the /backupImage/:panoId/metadata endpoint.
   * @param p The PanoData row from the database.
   * @param url The signed serving URL (e.g. /backupImage/<panoId>?exp=...&sig=...).
   */
  def localBackupImagePayload(p: PanoData, url: String): JsObject = {
    Json.obj(
      "panoId"        -> p.panoId,
      "imageUrl"      -> url,
      "width"         -> p.width,
      "height"        -> p.height,
      "tileWidth"     -> p.tileWidth,
      "tileHeight"    -> p.tileHeight,
      "lat"           -> p.lat,
      "lng"           -> p.lng,
      "cameraHeading" -> p.cameraHeading,
      "cameraPitch"   -> p.cameraPitch,
      "cameraRoll"    -> p.cameraRoll,
      "captureDate"   -> p.captureDate,
      "copyright"     -> p.copyright
    )
  }

  /**
   * Builds the JSON payload for the /cropImage/:labelType/:labelId/metadata endpoint.
   * @param labelId The label ID.
   * @param labelType The label type name.
   * @param url The signed serving URL (e.g. /cropImage/<labelType>/<labelId>?exp=...&sig=...).
   */
  def cropImagePayload(labelId: Int, labelType: String, url: String): JsObject = {
    Json.obj(
      "labelId"   -> labelId,
      "labelType" -> labelType,
      "imageUrl"  -> url
    )
  }

  def resumeLabelMetadatatoJson(label: ResumeLabelMetadata, allTags: Seq[Tag]): JsObject = {
    Json.obj(
      "labelId"     -> label.labelData.labelId,
      "labelType"   -> label.labelType,
      "panoId"      -> label.labelData.panoId,
      "panoLat"     -> label.panoLat,
      "panoLng"     -> label.panoLng,
      "originalPov" -> Json.obj(
        "heading" -> label.pointData.heading,
        "pitch"   -> label.pointData.pitch,
        "zoom"    -> label.pointData.zoom
      ),
      "cameraHeading" -> label.cameraHeading,
      "cameraPitch"   -> label.cameraPitch,
      "panoWidth"     -> label.panoWidth,
      "panoHeight"    -> label.panoHeight,
      "tagIds"        -> label.labelData.tags.flatMap { t =>
        allTags
          .filter(at => at.tag == t && at.labelTypeId == LabelTypeEnum.labelTypeToId(label.labelType))
          .map(_.tagId)
          .headOption
      },
      "severity"         -> label.labelData.severity,
      "tutorial"         -> label.labelData.tutorial,
      "temporaryLabelId" -> label.labelData.temporaryLabelId,
      "description"      -> label.labelData.description,
      "canvasX"          -> label.pointData.canvasX,
      "canvasY"          -> label.pointData.canvasY,
      "panoX"            -> label.pointData.panoX,
      "panoY"            -> label.pointData.panoY,
      "auditTaskId"      -> label.labelData.auditTaskId,
      "missionId"        -> label.labelData.missionId,
      "labelLat"         -> label.pointData.lat,
      "labelLng"         -> label.pointData.lng
    )
  }
}
