package formats.json

import java.util.UUID

import models.user._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.mohiva.play.silhouette.api.LoginInfo

// https://github.com/datalek/silhouette-rest-seed/blob/master/app/formatters/json/UserFormats.scala
object UserFormats {
  implicit val userReads: Reads[User] = (
    (JsPath \ "userId").read[UUID] and
      (JsPath \ "loginInfo").read[LoginInfo] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String] and
      (JsPath \ "roles").readNullable[Seq[String]]
    )(User.apply _)

  implicit val userWrites: Writes[User] = (
    (__ \ "userId").write[UUID] and
      (__ \ "loginInfo").write[LoginInfo] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "roles").writeNullable[Seq[String]]
    )(unlift(User.unapply _))

//  val restFormat = {
//
//    implicit val reader = (
//      (__ \ "userId").read[UUID] ~
//        (__ \ "loginInfo").read[LoginInfo] ~
//        (__ \ "username").read[String] ~
//        (__ \ "email").read[String] ~
//        (__ \ "roles").readNullable(Reads.seq[String])
//      )(User.apply _)
//
//
//    implicit val writer = (
//      (__ \ "userId").write[UUID] ~
//        (__ \ "loginInfo").write[LoginInfo] ~
//        (__ \ "username").write[String] ~
//        (__ \ "email").write[String] ~
//        (__ \ "roles").writeNullable(Writes.seq[String])
//      )(unlift(User.unapply _))
//
//    Format(reader, writer)
//  }
}
