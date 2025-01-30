package formats.json

import play.api.libs.json.{Reads, JsPath}
import play.api.libs.functional.syntax._

object AdminUpdateSubmissionFormats {
  case class UserRoleSubmission(userId: String, roleId: String)
  case class UserTeamSubmission(userId: String, teamId: Int)
  case class TaskFlagsByDateSubmission(username: String, date: Long, flag: String, state: Boolean)
  case class TaskFlagSubmission(auditTaskId: Int, flag: String, state: Boolean) {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
  }

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "role_id").read[String]
    )(UserRoleSubmission.apply _)

  implicit val userTeamSubmissionReads: Reads[UserTeamSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "team_id").read[Int]
    )(UserTeamSubmission.apply _)

  implicit val taskFlagsByDateSubmissionReads: Reads[TaskFlagsByDateSubmission] = (
    (JsPath \ "username").read[String] and
      (JsPath \ "date").read[Long] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagsByDateSubmission.apply _)

  implicit val taskFlagSubmissionReads: Reads[TaskFlagSubmission] = (
    (JsPath \ "auditTaskId").read[Int] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagSubmission.apply _)
}