package models.validation

import models.label.{LabelAiAssessmentTableDef, LabelTableDef}
import models.mission.MissionTableDef
import models.user.SidewalkUserTableDef
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.CommonUtils.ViewerType.ViewerType
import models.utils.MyPostgresProfile.api._

import java.time.OffsetDateTime

/**
 * A validation voided by the #4842 off-target-markers repair (evolution 352): a full copy of a deleted
 * label_validation row whose judgment was cast on a label rendering >= 30 px off its true position.
 *
 * These rows are dead for every verdict/count purpose -- the votes were deleted so validators get re-served the
 * repaired labels -- but the work happened, so work-credit reads (badge/all-time validation counts, activity-day
 * tallies) consult this archive alongside the live table. The verdicts are also study material for
 * validation-under-distortion.
 *
 * @param oldRenderErrorPx     On-screen error (Validate-canvas px) of the label's old record: why the vote was voided.
 * @param labelAiAssessmentId  The label_ai_assessment row that referenced this vote before its FK was nulled, if any.
 */
case class VoidedLabelValidation(
    labelValidationId: Int,
    labelId: Int,
    validationResult: ValidationOption.Value,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    userId: String,
    missionId: Int,
    canvasX: Option[Int],
    canvasY: Option[Int],
    heading: Double,
    pitch: Double,
    zoom: Double,
    canvasHeight: Int,
    canvasWidth: Int,
    startTimestamp: OffsetDateTime,
    endTimestamp: OffsetDateTime,
    source: UiSource,
    viewerType: ViewerType,
    oldRenderErrorPx: Double,
    labelAiAssessmentId: Option[Int]
)

class VoidedLabelValidationTableDef(tag: slick.lifted.Tag)
    extends Table[VoidedLabelValidation](tag, "voided_label_validation") {
  def labelValidationId: Rep[Int]                   = column[Int]("label_validation_id", O.PrimaryKey)
  def labelId: Rep[Int]                             = column[Int]("label_id")
  def validationResult: Rep[ValidationOption.Value] = column[ValidationOption.Value]("validation_result")
  def oldSeverity: Rep[Option[Int]]                 = column[Option[Int]]("old_severity")
  def newSeverity: Rep[Option[Int]]                 = column[Option[Int]]("new_severity")
  def oldTags: Rep[List[String]]                    = column[List[String]]("old_tags")
  def newTags: Rep[List[String]]                    = column[List[String]]("new_tags")
  def userId: Rep[String]                           = column[String]("user_id")
  def missionId: Rep[Int]                           = column[Int]("mission_id")
  def canvasX: Rep[Option[Int]]                     = column[Option[Int]]("canvas_x")
  def canvasY: Rep[Option[Int]]                     = column[Option[Int]]("canvas_y")
  def heading: Rep[Double]                          = column[Double]("heading")
  def pitch: Rep[Double]                            = column[Double]("pitch")
  def zoom: Rep[Double]                             = column[Double]("zoom")
  def canvasHeight: Rep[Int]                        = column[Int]("canvas_height")
  def canvasWidth: Rep[Int]                         = column[Int]("canvas_width")
  def startTimestamp: Rep[OffsetDateTime]           = column[OffsetDateTime]("start_timestamp")
  def endTimestamp: Rep[OffsetDateTime]             = column[OffsetDateTime]("end_timestamp")
  def source: Rep[UiSource]                         = column[UiSource]("source")
  def viewerType: Rep[ViewerType]                   = column[ViewerType]("viewer_type")
  def oldRenderErrorPx: Rep[Double]                 = column[Double]("old_render_error_px")
  def labelAiAssessmentId: Rep[Option[Int]]         = column[Option[Int]]("label_ai_assessment_id")

  // Verbatim capture of the vote's deleted label_history row (PK, now()-stamped edit_time, cleaned tags), used only
  // by evolution 352's Downs to regenerate that row byte-identically. Deliberately outside the default projection:
  // the app never reads them, and the mapped tuple already sits at Scala's 22-element ceiling.
  def oldHistoryId: Rep[Option[Int]]                  = column[Option[Int]]("old_history_id")
  def oldHistoryEditTime: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("old_history_edit_time")
  def oldHistoryTags: Rep[Option[List[String]]]       = column[Option[List[String]]]("old_history_tags")

  def * = (labelValidationId, labelId, validationResult, oldSeverity, newSeverity, oldTags, newTags, userId, missionId,
    canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp, source, viewerType,
    oldRenderErrorPx, labelAiAssessmentId) <> ((VoidedLabelValidation.apply _).tupled, VoidedLabelValidation.unapply)

  def label   = foreignKey("voided_label_validation_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user    = foreignKey("voided_label_validation_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def mission =
    foreignKey("voided_label_validation_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
  def aiAssessment = foreignKey(
    "voided_label_validation_label_ai_assessment_id_fkey",
    labelAiAssessmentId,
    TableQuery[LabelAiAssessmentTableDef]
  )(_.labelAiAssessmentId.?)
  def userLabelUnique = index("voided_label_validation_user_id_label_id_key", (userId, labelId), unique = true)
}
