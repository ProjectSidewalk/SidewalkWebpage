package formats.json

import models.audit.{ContributionTimeStat, GenericComment}
import models.label.LabelCount
import models.user.UserCount
import models.validation.ValidationCount
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads, Writes, __}

import java.time.OffsetDateTime

object AdminFormats {
  case class UserRoleSubmission(userId: String, roleId: String)
  case class TaskFlagsByDateSubmission(userId: String, date: OffsetDateTime, flag: String, state: Boolean)
  case class TaskFlagSubmission(auditTaskId: Int, flag: String, state: Boolean) {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
  }

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

  implicit val taskFlagSubmissionReads: Reads[TaskFlagSubmission] = (
    (JsPath \ "auditTaskId").read[Int] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagSubmission.apply _)

  implicit val userCountWrites: Writes[UserCount] = (
    (__ \ "count").write[Int] and
      (__ \ "tool_used").write[String] and
      (__ \ "role").write[String] and
      (__ \ "time_interval").write[String] and
      (__ \ "task_completed_only").write[Boolean] and
      (__ \ "high_quality_only").write[Boolean]
    )(unlift(UserCount.unapply))

  implicit val contributionTimeStatWrites: Writes[ContributionTimeStat] = (
    (__ \ "time").write[Option[Float]] and
      (__ \ "stat").write[String] and
      (__ \ "time_interval").write[String]
    )(unlift(ContributionTimeStat.unapply))

  implicit val labelCountWrites: Writes[LabelCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[String] and
      (__ \ "label_type").write[String]
    )(unlift(LabelCount.unapply))

  implicit val validationCountWrites: Writes[ValidationCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[String] and
      (__ \ "label_type").write[String] and
      (__ \ "result").write[String]
    )(unlift(ValidationCount.unapply))

  implicit val genericCommentWrites: Writes[GenericComment] = (
    (__ \ "comment_type").write[String] and
      (__ \ "username").write[String] and
      (__ \ "gsv_panorama_id").write[Option[String]] and
      (__ \ "timestamp").write[OffsetDateTime] and
      (__ \ "comment").write[String] and
      (__ \ "heading").write[Option[Double]] and
      (__ \ "pitch").write[Option[Double]] and
      (__ \ "zoom").write[Option[Int]] and
      (__ \ "label_id").write[Option[Int]]
    )(unlift(GenericComment.unapply))
}
