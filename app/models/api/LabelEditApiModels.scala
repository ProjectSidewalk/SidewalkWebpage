/**
 * Models for the Project Sidewalk Label Edits API (#2575): the data structures for requests and responses about
 * changes made to labels' severity and tags after they were placed.
 */
package models.api

import models.label.LabelTypeEnum
import models.utils.CommonUtils.UiSource.UiSource
import play.api.libs.json.JsObject

import java.time.OffsetDateTime

/**
 * Filter criteria for the Label Edits API (v3).
 *
 * @param labelId        Only edits to this label
 * @param userId         Only edits made by this user
 * @param labelType      Only edits to labels of this type
 * @param editTimestamp  Only edits made at or after this time
 * @param source         Only edits made in this interface (UiSource), e.g. Validate, LabelMap, GalleryExpanded
 * @param withValidation True for only edits submitted with a validation, false for only standalone edits
 */
case class LabelEditFiltersForApi(
    labelId: Option[Int] = None,
    userId: Option[String] = None,
    labelType: Option[LabelTypeEnum.Base] = None,
    editTimestamp: Option[OffsetDateTime] = None,
    source: Option[UiSource] = None,
    withValidation: Option[Boolean] = None
)

/**
 * One edit to a label's severity and/or tags, for the API. No GeoJSON form, as edits carry no geographic coordinates.
 *
 * @param labelEditId       Unique identifier for the edit
 * @param labelId           The edited label
 * @param labelType         Type of the edited label (e.g. "CurbRamp")
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

  override def toJson: JsObject = LabelEditDataForApi.toJson(this)

  override def toCsvRow: String = LabelEditDataForApi.toCsvRow(this)
}

object LabelEditDataForApi extends ApiFields[LabelEditDataForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[LabelEditDataForApi]] = Seq(
    field("label_edit_id")(_.labelEditId),
    field("label_id")(_.labelId),
    field("label_type")(_.labelType),
    field("user_id")(_.userId),
    field("old_severity")(_.oldSeverity),
    field("new_severity")(_.newSeverity),
    field("old_tags")(_.oldTags),
    field("new_tags")(_.newTags),
    field("source")(_.source),
    field("edit_time")(_.editTime.toString),
    field("label_validation_id")(_.labelValidationId)
  )
}
