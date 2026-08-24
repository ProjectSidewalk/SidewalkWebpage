/**
 * Models for the Project Sidewalk Label Edits API (#2575): the data structures for requests and responses about
 * changes made to labels' severity and tags after they were placed.
 */
package models.api

import models.api.ApiModelUtils.escapeCsvField
import models.utils.CommonUtils.UiSource.UiSource
import play.api.libs.json.{JsObject, Json}

import java.time.OffsetDateTime

/**
 * Filter criteria for the Label Edits API (v3).
 *
 * @param labelId        Only edits to this label
 * @param userId         Only edits made by this user
 * @param labelTypeId    Only edits to labels of this type
 * @param editTimestamp  Only edits made at or after this time
 * @param source         Only edits made in this interface (UiSource), e.g. Validate, LabelMap, GalleryExpandedImage
 * @param withValidation True for only edits submitted with a validation, false for only standalone edits
 */
case class LabelEditFiltersForApi(
    labelId: Option[Int] = None,
    userId: Option[String] = None,
    labelTypeId: Option[Int] = None,
    editTimestamp: Option[OffsetDateTime] = None,
    source: Option[UiSource] = None,
    withValidation: Option[Boolean] = None
)

/**
 * One edit to a label's severity and/or tags, for the API. Edits carry no geographic coordinates of their own (those
 * belong to the label), so there is no GeoJSON form.
 *
 * @param labelEditId       Unique identifier for the edit
 * @param labelId           The edited label
 * @param labelTypeId       Type ID of the edited label
 * @param labelType         Type name of the edited label
 * @param userId            Who made the edit (the labeler, a validator, or an admin)
 * @param oldSeverity       Severity before the edit
 * @param newSeverity       Severity after the edit
 * @param oldTags           Tags before the edit
 * @param newTags           Tags after the edit
 * @param source            The interface the edit was made in
 * @param editTime          When the edit was made (its last change, for an edit built up over a few minutes)
 * @param labelValidationId The validation the edit was submitted with, if it came from a validation tool
 */
case class LabelEditDataForApi(
    labelEditId: Int,
    labelId: Int,
    labelTypeId: Int,
    labelType: String,
    userId: String,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    source: UiSource,
    editTime: OffsetDateTime,
    labelValidationId: Option[Int]
) extends StreamingApiType {

  override def toJson: JsObject = {
    Json.obj(
      "label_edit_id"       -> labelEditId,
      "label_id"            -> labelId,
      "label_type_id"       -> labelTypeId,
      "label_type"          -> labelType,
      "user_id"             -> userId,
      "old_severity"        -> oldSeverity,
      "new_severity"        -> newSeverity,
      "old_tags"            -> oldTags,
      "new_tags"            -> newTags,
      "source"              -> source,
      "edit_time"           -> editTime.toString,
      "label_validation_id" -> labelValidationId
    )
  }

  /** Fields in the order of `LabelEditDataForApi.csvHeader`; tag arrays are serialized as JSON-style lists. */
  override def toCsvRow: String = {
    val fields = Seq(
      labelEditId.toString,
      labelId.toString,
      labelTypeId.toString,
      escapeCsvField(labelType),
      escapeCsvField(userId),
      oldSeverity.map(_.toString).getOrElse(""),
      newSeverity.map(_.toString).getOrElse(""),
      escapeCsvField(oldTags.mkString("[", ",", "]")),
      escapeCsvField(newTags.mkString("[", ",", "]")),
      escapeCsvField(source.toString),
      editTime.toString,
      labelValidationId.map(_.toString).getOrElse("")
    )
    fields.mkString(",")
  }
}

object LabelEditDataForApi {

  /** CSV header, in the same order as `toCsvRow`. */
  val csvHeader: String = "label_edit_id,label_id,label_type_id,label_type,user_id,old_severity,new_severity," +
    "old_tags,new_tags,source,edit_time,label_validation_id\n"
}
