package formats.json

import java.util.UUID

import play.api.libs.json.{Reads, JsPath}
import play.api.libs.functional.syntax._

object AdminUpdateSubmissionFormats {
  case class UserRoleSubmission(userId: String, roleId: String)
  case class UserOrgSubmission(userId: String, orgId: Int)

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "role_id").read[String]
    )(UserRoleSubmission.apply _)

  implicit val userOrgSubmissionReads: Reads[UserOrgSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "org_id").read[Int]
    )(UserOrgSubmission.apply _)
}