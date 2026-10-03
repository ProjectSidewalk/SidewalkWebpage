package formats.json

import controllers.helper.ValidateHelper.ValidateParams
import formats.json.CommentSubmissionFormats.ValidationCommentSubmission
import formats.json.PanoFormats.*
import models.label.LabelType
import models.mission.MissionType
import models.utils.CommonUtils.{UiSource, ViewerType}
import models.validation.ValidationOption
import play.api.libs.functional.syntax.*
import play.api.libs.json.*

import java.time.OffsetDateTime

object ValidateFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  case class EnvironmentSubmission(
      missionId: Option[Int],
      browser: Option[String],
      browserVersion: Option[String],
      browserWidth: Option[Int],
      browserHeight: Option[Int],
      availWidth: Option[Int],
      availHeight: Option[Int],
      screenWidth: Option[Int],
      screenHeight: Option[Int],
      operatingSystem: Option[String],
      language: String,
      cssZoom: Int
  )
  case class InteractionSubmission(
      action: String,
      missionId: Option[Int],
      panoId: Option[String],
      lat: Option[Double],
      lng: Option[Double],
      heading: Option[Double],
      pitch: Option[Double],
      zoom: Option[Double],
      note: Option[String],
      timestamp: OffsetDateTime
  )

  /**
   * A vote from the Validate tool. `newLabelType`, `severity` and `tags` are what the validator wants the label to
   * have, applied only for an Agree (#2575, #3671). `labelType` is the type the tool showed; an older client omits it
   * and the mission's type stands in.
   */
  case class LabelValidationSubmission(
      labelId: Int,
      missionId: Int,
      labelType: Option[LabelType],
      newLabelType: Option[LabelType],
      validationResult: ValidationOption,
      severity: Option[Int],
      tags: List[String],
      comment: Option[ValidationCommentSubmission],
      canvasX: Option[Int],
      canvasY: Option[Int],
      heading: Double,
      pitch: Double,
      zoom: Double,
      canvasWidth: Int,
      canvasHeight: Int,
      startTimestamp: OffsetDateTime,
      endTimestamp: OffsetDateTime,
      source: UiSource,
      undone: Boolean,
      redone: Boolean,
      viewerType: ViewerType
  )

  /**
   * A request for replacement labels from a Validate mission that ran out of them mid-mission (#4810).
   *
   * @param labelType        Label type of the mission being topped up.
   * @param labelsNeeded     How many labels the client is short.
   * @param excludedLabelIds Every label the client already holds, so it isn't handed one of them back.
   * @param validateParams   The page's filters, so replacements match the rest of the mission.
   */
  case class MoreLabelsRequest(
      labelType: LabelType,
      labelsNeeded: Int,
      excludedLabelIds: Seq[Int],
      validateParams: ValidateParams
  )
  // No `skipped`, unlike AuditMissionProgress: only Explore's onboarding can skip a mission.
  case class ValidationMissionProgress(
      missionId: Int,
      missionType: MissionType,
      labelsProgress: Int,
      labelsTotal: Int,
      labelType: LabelType,
      completed: Boolean
  )
  case class ValidationTaskSubmission(
      interactions: Seq[InteractionSubmission],
      environment: EnvironmentSubmission,
      validations: Seq[LabelValidationSubmission],
      missionProgress: Option[ValidationMissionProgress],
      validateParams: ValidateParams,
      panoHistories: Seq[PanoHistorySubmission],
      source: UiSource,
      timestamp: OffsetDateTime
  )

  /**
   * A vote from the label popup (LabelMap, Gallery, share page); `labelType` is the type the popup showed, and
   * newLabelType/severity/tags are as in LabelValidationSubmission.
   */
  case class LabelMapValidationSubmission(
      labelId: Int,
      labelType: LabelType,
      newLabelType: Option[LabelType],
      validationResult: ValidationOption,
      severity: Option[Int],
      tags: List[String],
      canvasX: Option[Int],
      canvasY: Option[Int],
      heading: Double,
      pitch: Double,
      zoom: Double,
      canvasWidth: Int,
      canvasHeight: Int,
      startTimestamp: OffsetDateTime,
      endTimestamp: OffsetDateTime,
      source: UiSource,
      undone: Boolean,
      redone: Boolean,
      viewerType: ViewerType
  )

  /**
   * An edit to a label from the label popup: the type, severity and tags the label should now have (#2575, #3671).
   * @param labelType    The type the popup showed; an edit built on a type the label no longer has is refused.
   * @param newLabelType The type the label should become, when the edit changes it.
   */
  case class LabelEditSubmission(
      labelId: Int,
      labelType: Option[LabelType],
      newLabelType: Option[LabelType],
      severity: Option[Int],
      tags: List[String],
      source: UiSource
  )

  given environmentSubmissionReads: Reads[EnvironmentSubmission] = Json.reads[EnvironmentSubmission]

  given interactionSubmissionReads: Reads[InteractionSubmission] = Json.reads[InteractionSubmission]

  given labelValidationSubmissionReads: Reads[LabelValidationSubmission] = Json.reads[LabelValidationSubmission]

  given validationMissionReads: Reads[ValidationMissionProgress] = Json.reads[ValidationMissionProgress]

  // The admin-only fields are checked before `ValidateParams` is built: its constructor rejects them without
  // `admin_version` too, but as an exception, which would answer a malformed body with a 500 instead of this 400.
  given adminValidateParamsReads: Reads[ValidateParams] = (
    (JsPath \ "admin_version").read[Boolean] and
      (JsPath \ "label_type").readNullable[LabelType] and
      (JsPath \ "user_ids").readNullable[Seq[String]] and
      (JsPath \ "region_ids").readNullable[Seq[Int]] and
      (JsPath \ "unvalidated_only").read[Boolean] and
      // An older tab can post without this field; defaulting it to false keeps that request on the crowd queue.
      (JsPath \ "triage").readWithDefault[Boolean](false) and
      (JsPath \ "team_ids").readNullable[Seq[Int]]
  ).tupled.collect(
    JsonValidationError("label_type, user_ids, triage and team_ids can only be set if admin_version is true")
  ) {
    case (adminVersion, labelType, userIds, regionIds, unvalidatedOnly, triage, teamIds)
        if adminVersion || (labelType.isEmpty && userIds.isEmpty && !triage && teamIds.isEmpty) =>
      ValidateParams(adminVersion, labelType, userIds, regionIds, unvalidatedOnly, triage, teamIds)
  }

  given validationTaskSubmissionReads: Reads[ValidationTaskSubmission] = Json.reads[ValidationTaskSubmission]

  given labelMapValidationSubmissionReads: Reads[LabelMapValidationSubmission] =
    Json.reads[LabelMapValidationSubmission]

  given labelEditSubmissionReads: Reads[LabelEditSubmission] = Json.reads[LabelEditSubmission]

  given moreLabelsRequestReads: Reads[MoreLabelsRequest] = Json.reads[MoreLabelsRequest]
}
