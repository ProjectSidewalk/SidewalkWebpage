package formats.json

import java.util.UUID

import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.mohiva.play.silhouette.api.LoginInfo
import models.User

object UserFormats {
  val restFormat = {

    implicit val reader = (
      (__ \ "userId").read[UUID] ~
        (__ \ "loginInfo").read[LoginInfo] ~
        (__ \ "username").read[String] ~
        (__ \ "email").read[String])(User.apply _)

    implicit val writer = (
      (__ \ "userId").write[UUID] ~
        (__ \ "loginInfo").write[LoginInfo] ~
        (__ \ "username").write[String] ~
        (__ \ "email").write[String])(unlift(User.unapply _))

    Format(reader, writer)
  }

  implicit val userReads: Reads[User] = (
    (JsPath \ "userId").read[UUID] and
      (JsPath \ "loginInfo").read[LoginInfo] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String]
    )(User.apply _)
}
