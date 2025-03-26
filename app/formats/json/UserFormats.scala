package formats.json

import models.user._
import play.api.libs.json._
import play.api.libs.functional.syntax._

// https://github.com/datalek/silhouette-rest-seed/blob/master/app/formatters/json/UserFormats.scala
object UserFormats {
  implicit val sidewalkUserWithRoleReads: Reads[SidewalkUserWithRole] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String] and
      (JsPath \ "role").read[String] and
      (JsPath \ "community_service").read[Boolean]
    )(SidewalkUserWithRole.apply _)

  implicit val sidewalkUserWithRoleWrites: Writes[SidewalkUserWithRole] = (
    (JsPath \ "user_id").write[String] and
      (JsPath \ "username").write[String] and
      (JsPath \ "email").write[String] and
      (JsPath \ "role").write[String] and
      (JsPath \ "community_service").write[Boolean]
    )(unlift(SidewalkUserWithRole.unapply))

//  implicit val userStatsWrites: Writes[UserStatsForAdminPage] = (
//    (__ \ "userId").write[String] and
//      (__ \ "username").write[String] and
//      (__ \ "email").write[String] and
//      (__ \ "role").write[String] and
//      (__ \ "team").writeNullable[String] and
//      (__ \ "signUpTime").writeNullable[Timestamp] and
//      (__ \ "lastSignInTime").writeNullable[Timestamp] and
//      (__ \ "signInCount").write[Int] and
//      (__ \ "labels").write[Int] and
//      (__ \ "ownValidated").write[Int] and
//      (__ \ "ownValidatedAgreedPct").write[Double] and
//      (__ \ "othersValidated").write[Int] and
//      (__ \ "othersValidatedAgreedPct").write[Double] and
//      (__ \ "highQuality").write[Boolean]
//  )(unlift(UserStatsForAdminPage.unapply))

  implicit val teamWrites: Writes[Team] = (
    (JsPath \ "teamId").write[Int] and
      (JsPath \ "name").write[String] and
      (JsPath \ "description").write[String] and
      (JsPath \ "open").write[Boolean] and
      (JsPath \ "visible").write[Boolean]
    )(unlift(Team.unapply _))
}
