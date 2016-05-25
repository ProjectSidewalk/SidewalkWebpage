package formats.json

import java.util.UUID

import models.user._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.mohiva.play.silhouette.api.LoginInfo


// https://github.com/datalek/silhouette-rest-seed/blob/master/app/formatters/json/UserFormats.scala
object UserFormats {
  val restFormat = {

    implicit val reader = (
      (__ \ "userId").read[UUID] ~
        (__ \ "loginInfo").read[LoginInfo] ~
        (__ \ "username").read[String] ~
        (__ \ "email").read[String] ~
        (__ \ "roles").readNullable(Reads.seq[String])
      )(User.apply _)


    implicit val writer = (
      (__ \ "userId").write[UUID] ~
        (__ \ "loginInfo").write[LoginInfo] ~
        (__ \ "username").write[String] ~
        (__ \ "email").write[String] ~
        (__ \ "roles").writeNullable(Writes.seq[String])
      )(unlift(User.unapply _))

    Format(reader, writer)
  }

  Reads.set
  implicit val userReads: Reads[User] = (
    (JsPath \ "userId").read[UUID] and
      (JsPath \ "loginInfo").read[LoginInfo] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String] and
      (JsPath \ "roles").readNullable[Seq[String]]
    )(User.apply _)

//  // https://github.com/datalek/silhouette-rest-seed/blob/master/app/formatters/json/UserFormats.scala  implicit object RoleFormat extends Format[Role] {
//    def writes(role: Role): JsValue = {
//      val roleSeq = Seq(
//        "roleId" -> JsNumber(role.roleId),
//        "role" -> JsString(role.role)
//      )
//      JsObject(roleSeq)
//    }
//    def reads(json: JsValue): JsResult[Role] = {
//      JsSuccess(Role(0, ""))
//    }
//  }
//
//  implicit val roleReads: Reads[Role] = (
//    (JsPath \ "roleId").read[Int] and
//      (JsPath \ "role").read[String]
//    )(Role.apply _)
//
//  implicit val roleWrites = Json.format[Role]
//  implicit val rolesWrites = Json.format[Seq[Role]]
}
