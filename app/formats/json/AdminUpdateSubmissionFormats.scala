package formats.json

import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads}

import java.time.Instant

object AdminUpdateSubmissionFormats {
  case class UserRoleSubmission(userId: String, roleId: String)
  case class UserOrgSubmission(userId: String, orgId: Int)
  case class TaskFlagsByDateSubmission(username: String, date: Instant, flag: String, state: Boolean)
  case class TaskFlagSubmission(auditTaskId: Int, flag: String, state: Boolean) {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
  }

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "role_id").read[String]
    )(UserRoleSubmission.apply _)

  implicit val userOrgSubmissionReads: Reads[UserOrgSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "org_id").read[Int]
    )(UserOrgSubmission.apply _)

  implicit val taskFlagsByDateSubmissionReads: Reads[TaskFlagsByDateSubmission] = (
    (JsPath \ "username").read[String] and
      (JsPath \ "date").read[Instant] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagsByDateSubmission.apply _)

  implicit val taskFlagSubmissionReads: Reads[TaskFlagSubmission] = (
    (JsPath \ "auditTaskId").read[Int] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagSubmission.apply _)
}