package formats.json

import java.sql.Timestamp
import java.util.UUID

import models.daos.slick.UserStatsForAdminPage
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
      (JsPath \ "role").readNullable[String]
    )(User.apply _)

  implicit val userWrites: Writes[User] = (
    (__ \ "userId").write[UUID] and
      (__ \ "loginInfo").write[LoginInfo] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "role").writeNullable[String]
    )(unlift(User.unapply _))

  implicit val labelTypeStatWrites: Writes[LabelTypeStat] = (
    (__ \ "labels").write[Int] and
      (__ \ "validated_correct").write[Int] and
      (__ \ "validated_incorrect").write[Int] and
      (__ \ "not_validated").write[Int]
  )(unlift(LabelTypeStat.unapply _))

  implicit val userStatsWrites: Writes[UserStatsForAdminPage] = (
    (__ \ "userId").write[String] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "role").write[String] and
      (__ \ "team").writeNullable[String] and
      (__ \ "signUpTime").writeNullable[Timestamp] and
      (__ \ "lastSignInTime").writeNullable[Timestamp] and
      (__ \ "signInCount").write[Int] and
      (__ \ "labels").write[Int] and
      (__ \ "ownValidated").write[Int] and
      (__ \ "ownValidatedAgreedPct").write[Double] and
      (__ \ "othersValidated").write[Int] and
      (__ \ "othersValidatedAgreedPct").write[Double] and
      (__ \ "highQuality").write[Boolean]
  )(unlift(UserStatsForAdminPage.unapply _))

  implicit val teamWrites: Writes[Team] = (
    (JsPath \ "teamId").write[Int] and
      (JsPath \ "name").write[String] and
      (JsPath \ "description").write[String] and
      (JsPath \ "open").write[Boolean] and
      (JsPath \ "visible").write[Boolean]
    )(unlift(Team.unapply _))
}
