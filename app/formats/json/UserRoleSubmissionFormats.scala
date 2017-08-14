package formats.json

import java.util.UUID

import play.api.libs.json.{Reads, JsPath}
import play.api.libs.functional.syntax._

object UserRoleSubmissionFormats {
  case class UserRoleSubmission(userId: String, roleId: Int)

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "userId").read[String] and
	  (JsPath \ "roleId").read[Int]
	)(UserRoleSubmission.apply _)
}