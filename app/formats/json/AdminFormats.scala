package formats.json

import models.audit.{AuditedStreetWithTimestamp, ContributionTimeStat, GenericComment}
import models.label.LabelCount
import models.user.UserCount
import models.utils.MyPostgresProfile.api.given
import models.validation.{ValidationCount, ValidationOption}
import play.api.libs.functional.syntax.*
import play.api.libs.json.*
import service.TimeInterval

import java.time.OffsetDateTime

object AdminFormats {
  private given jsonConfig: JsonConfiguration =
    JsonConfiguration(JsonNaming.SnakeCase, optionHandlers = OptionHandlers.WritesNull)

  case class UserRoleSubmission(userId: String, roleId: String)
  case class TaskFlagsByDateSubmission(userId: String, date: OffsetDateTime, flag: String, state: Boolean)
  case class TaskFlagSubmission(auditTaskId: Int, flag: String, state: Boolean) {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
  }

  /**
   * The Manage user page's save (`/adminapi/saveUserSettings`, #4964). Every setting is required so a partial body
   * can't silently reset the ones it left out; the three nullable fields each mean something when null/absent —
   * `teamId`: no team, `highQualityManual`: automatic, `infra3dAccess`: leave as is.
   */
  case class AdminUserSettingsSubmission(
      userId: String,
      username: String,
      // Left as the raw string so an unrecognized role reaches AdminController's ordered checks, which name it
      // ("Can't assign role X"), rather than failing JSON validation with a generic "Invalid settings: role".
      role: String,
      teamId: Option[Int],
      highQualityManual: Option[Boolean],
      excluded: Boolean,
      communityService: Boolean,
      onLeaderboard: Boolean,
      publicProfile: Boolean,
      infra3dAccess: Option[Boolean]
  )

  given userRoleSubmissionReads: Reads[UserRoleSubmission] = Json.reads[UserRoleSubmission]

  given taskFlagsByDateSubmissionReads: Reads[TaskFlagsByDateSubmission] = Json.reads[TaskFlagsByDateSubmission]

  given adminUserSettingsSubmissionReads: Reads[AdminUserSettingsSubmission] =
    Json.reads[AdminUserSettingsSubmission].map(s => s.copy(username = s.username.trim))

  given taskFlagSubmissionReads: Reads[TaskFlagSubmission] = Json.reads[TaskFlagSubmission]

  given userCountWrites: Writes[UserCount] = Json.writes[UserCount]

  given contributionTimeStatWrites: Writes[ContributionTimeStat] = Json.writes[ContributionTimeStat]

  given labelCountWrites: Writes[LabelCount] = Json.writes[LabelCount]

  given validationCountWrites: Writes[ValidationCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "label_type").write[String] and
      // None represents the "All" results subtotal.
      (__ \ "result").write[String].contramap[Option[ValidationOption]](_.map(_.name).getOrElse("All")) and
      (__ \ "validator").write[String]
  )((o: ValidationCount) => Tuple.fromProductTyped(o))

  given genericCommentWrites: Writes[GenericComment] = Json.writes[GenericComment]

  def auditedStreetWithTimestampToGeoJSON(street: AuditedStreetWithTimestamp): JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> street.geom,
      "properties" -> Json.obj(
        "street_edge_id"    -> street.streetEdgeId,
        "audit_task_id"     -> street.auditTaskId,
        "user_id"           -> street.userId,
        "role"              -> street.role,
        "high_quality_user" -> street.highQuality,
        "task_start"        -> street.taskStart,
        "task_end"          -> street.taskEnd
      )
    )
  }
}
