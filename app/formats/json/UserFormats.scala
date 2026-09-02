package formats.json

import models.user._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import service.{CityHours, CrossCityHours}

import java.time.OffsetDateTime

object UserFormats {

  /**
   * The Settings page's save (`POST /dashboard/settings`). The privacy flags are required so a body that omits one
   * can't silently reset it; `teamId` null means no team, and the other optional fields mean "not touching it".
   */
  case class SettingsSubmission(
      username: Option[String],
      onLeaderboard: Boolean,
      publicProfile: Boolean,
      teamId: Option[Int],
      communityService: Option[Boolean],
      measurementSystem: Option[String]
  )

  implicit val settingsSubmissionReads: Reads[SettingsSubmission] = (
    (JsPath \ "username").readNullable[String].map(_.map(_.trim)) and
      (JsPath \ "onLeaderboard").read[Boolean] and
      (JsPath \ "publicProfile").read[Boolean] and
      (JsPath \ "teamId").readNullable[Int] and
      (JsPath \ "communityService").readNullable[Boolean] and
      (JsPath \ "measurementSystem").readNullable[String]
  )(SettingsSubmission.apply _)

  /** The canonical JSON format for a role. Other format objects import these rather than defining their own. */
  implicit val roleReads: Reads[Role.Value] = Reads { json =>
    json.validate[String].flatMap { role =>
      Role.fromString(role) match {
        case Some(parsed) => JsSuccess(parsed)
        case None         => JsError(s"Invalid role: $role. Valid roles are: ${Role.values.mkString(", ")}.")
      }
    }
  }
  implicit val roleWrites: Writes[Role.Value] = Writes(role => JsString(role.toString))

  implicit val sidewalkUserWithRoleReads: Reads[SidewalkUserWithRole] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String] and
      (JsPath \ "role").read[Role.Value] and
      (JsPath \ "community_service").read[Boolean] and
      (JsPath \ "infra3d_access").read[Boolean]
  )(SidewalkUserWithRole.apply _)

  implicit val sidewalkUserWithRoleWrites: Writes[SidewalkUserWithRole] = (
    (JsPath \ "user_id").write[String] and
      (JsPath \ "username").write[String] and
      (JsPath \ "email").write[String] and
      (JsPath \ "role").write[Role.Value] and
      (JsPath \ "community_service").write[Boolean] and
      (JsPath \ "infra3d_access").write[Boolean]
  )(unlift(SidewalkUserWithRole.unapply))

  implicit val userStatsWrites: Writes[UserStatsForAdminPage] = (
    (__ \ "userId").write[String] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "role").write[Role.Value] and
      (__ \ "team").writeNullable[String] and
      (__ \ "signUpTime").writeNullable[OffsetDateTime] and
      (__ \ "lastSignInTime").writeNullable[OffsetDateTime] and
      (__ \ "signInCount").write[Int] and
      (__ \ "labels").write[Int] and
      (__ \ "ownValidated").write[Int] and
      (__ \ "ownValidatedAgreedPct").write[Double] and
      (__ \ "othersValidated").write[Int] and
      (__ \ "othersValidatedAgreedPct").write[Double] and
      (__ \ "highQuality").write[Boolean] and
      (__ \ "highQualityManual").writeNullable[Boolean]
  )(unlift(UserStatsForAdminPage.unapply))

  implicit val teamWrites: Writes[Team] = (
    (JsPath \ "teamId").write[Int] and
      (JsPath \ "name").write[String] and
      (JsPath \ "description").write[String] and
      (JsPath \ "open").write[Boolean] and
      (JsPath \ "visible").write[Boolean]
  )(unlift(Team.unapply))

  implicit val cityHoursWrites: Writes[CityHours] = (
    (JsPath \ "city_id").write[String] and
      (JsPath \ "city_name").write[String] and
      (JsPath \ "hours").write[Double] and
      (JsPath \ "is_current_city").write[Boolean]
  )(unlift(CityHours.unapply))

  /**
   * The hours the Manage user page fills its KPI and breakdown from (`/adminapi/users/:userId/crossCityHours`, #4986).
   *
   * `total_hours` and `show_breakdown` are carried rather than left for the client to re-derive: `/timeCheck` reads
   * both straight off the same [[service.CrossCityHours]], and an admin verifying a service-hours claim against a
   * number assembled a second way is the failure this endpoint exists to prevent.
   */
  implicit val crossCityHoursWrites: Writes[CrossCityHours] = Writes { hours =>
    Json.obj(
      "total_hours"        -> hours.totalHours,
      "cities"             -> hours.cities,
      "show_breakdown"     -> hours.showBreakdown,
      "unreachable_cities" -> hours.unreachableCities
    )
  }
}
