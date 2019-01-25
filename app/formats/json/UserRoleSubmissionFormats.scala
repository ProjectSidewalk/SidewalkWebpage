package formats.json

import java.util.UUID

import play.api.libs.json.{ Reads, JsPath }
import play.api.libs.functional.syntax._

object UserRoleSubmissionFormats {
  case class UserRoleSubmission(userId: String, roleId: String)

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
    (JsPath \ "role_id").read[String])(UserRoleSubmission.apply _)
}