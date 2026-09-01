package formats.json

import models.audit.{AuditedStreetWithTimestamp, ContributionTimeStat, GenericComment}
import models.label.LabelCount
import formats.json.UserFormats.roleReads
import models.user.{Role, UserCount}
import models.utils.MyPostgresProfile.api._
import models.validation.{ValidationCount, ValidationOption}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import service.TimeInterval.TimeInterval

import java.time.OffsetDateTime

object AdminFormats {
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
      role: Role.Value,
      teamId: Option[Int],
      highQualityManual: Option[Boolean],
      communityService: Boolean,
      onLeaderboard: Boolean,
      publicProfile: Boolean,
      infra3dAccess: Option[Boolean]
  )

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "role_id").read[String]
  )(UserRoleSubmission.apply _)

  implicit val taskFlagsByDateSubmissionReads: Reads[TaskFlagsByDateSubmission] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "date").read[OffsetDateTime] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
  )(TaskFlagsByDateSubmission.apply _)

  implicit val adminUserSettingsSubmissionReads: Reads[AdminUserSettingsSubmission] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "username").read[String].map(_.trim) and
      (JsPath \ "role").read[Role.Value] and
      (JsPath \ "teamId").readNullable[Int] and
      (JsPath \ "highQualityManual").readNullable[Boolean] and
      (JsPath \ "communityService").read[Boolean] and
      (JsPath \ "onLeaderboard").read[Boolean] and
      (JsPath \ "publicProfile").read[Boolean] and
      (JsPath \ "infra3dAccess").readNullable[Boolean]
  )(AdminUserSettingsSubmission.apply _)

  implicit val taskFlagSubmissionReads: Reads[TaskFlagSubmission] = (
    (JsPath \ "auditTaskId").read[Int] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
  )(TaskFlagSubmission.apply _)

  // Fixes the default writes now working when the keys are an Enumeration.
  implicit def timeIntervalMapWrites[A](implicit writesA: Writes[A]): Writes[Map[TimeInterval, A]] =
    (map: Map[TimeInterval, A]) => {
      val stringMap = map.map { case (interval, value) => (interval.toString, value) }
      Json.toJson(stringMap)(Writes.map[A](writesA))
    }

  implicit val userCountWrites: Writes[UserCount] = (
    (__ \ "count").write[Int] and
      (__ \ "tool_used").write[String] and
      (__ \ "role").write[String] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "task_completed_only").write[Boolean] and
      (__ \ "high_quality_only").write[Boolean]
  )(unlift(UserCount.unapply))

  implicit val contributionTimeStatWrites: Writes[ContributionTimeStat] = (
    (__ \ "time").write[Option[Double]] and
      (__ \ "stat").write[String] and
      (__ \ "time_interval").write[TimeInterval]
  )(unlift(ContributionTimeStat.unapply))

  implicit val labelCountWrites: Writes[LabelCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "label_type").write[String]
  )(unlift(LabelCount.unapply))

  implicit val validationCountWrites: Writes[ValidationCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "label_type").write[String] and
      // None represents the "All" results subtotal.
      (__ \ "result").write[String].contramap[Option[ValidationOption.Value]](_.map(_.toString).getOrElse("All")) and
      (__ \ "validator").write[String]
  )(unlift(ValidationCount.unapply))

  implicit val genericCommentWrites: Writes[GenericComment] = (
    (__ \ "comment_type").write[String] and
      (__ \ "username").write[String] and
      (__ \ "pano_id").write[String] and
      (__ \ "timestamp").write[OffsetDateTime] and
      (__ \ "comment").write[String] and
      (__ \ "heading").write[Double] and
      (__ \ "pitch").write[Double] and
      (__ \ "zoom").write[Double] and
      (__ \ "label_id").write[Option[Int]]
  )(unlift(GenericComment.unapply))

  def auditedStreetWithTimestampToGeoJSON(street: AuditedStreetWithTimestamp): JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> street.geom,
      "properties" -> Json.obj(
        "street_edge_id"    -> street.streetEdgeId,
        "audit_task_id"     -> street.auditTaskId,
        "user_id"           -> street.userId,
        "role"              -> street.role.toString,
        "high_quality_user" -> street.highQuality,
        "task_start"        -> street.taskStart,
        "task_end"          -> street.taskEnd
      )
    )
  }
}
