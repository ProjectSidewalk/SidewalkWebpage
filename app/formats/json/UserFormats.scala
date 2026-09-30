package formats.json

import models.user._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import service.{CityHours, CrossCityHours, TeamMemberStats, TeamOverview, TeamTotals, UserSearchResult}

import java.time.OffsetDateTime

object UserFormats {

  /**
   * The Settings page's save (`POST /dashboard/settings`). The privacy flags are required so a body that omits one
   * can't silently reset it, and every optional field means "not touching it" — `teamId` included, since leaving a
   * team is its own action (`UserProfileController.leaveTeam`).
   */
  case class SettingsSubmission(
      username: Option[String],
      onLeaderboard: Boolean,
      publicProfile: Boolean,
      teamId: Option[Int],
      communityService: Option[Boolean],
      measurementSystem: Option[String]
  )

  given settingsSubmissionReads: Reads[SettingsSubmission] = (
    (JsPath \ "username").readNullable[String].map(_.map(_.trim)) and
      (JsPath \ "onLeaderboard").read[Boolean] and
      (JsPath \ "publicProfile").read[Boolean] and
      (JsPath \ "teamId").readNullable[Int] and
      (JsPath \ "communityService").readNullable[Boolean] and
      (JsPath \ "measurementSystem").readNullable[String]
  )(SettingsSubmission.apply _)

  given sidewalkUserWithRoleReads: Reads[SidewalkUserWithRole] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "username").read[String] and
      (JsPath \ "email").read[String] and
      (JsPath \ "role").read[Role] and
      (JsPath \ "community_service").read[Boolean] and
      (JsPath \ "infra3d_access").read[Boolean] and
      (JsPath \ "measurement_system").readNullable[MeasurementSystem]
  )(SidewalkUserWithRole.apply _)

  given sidewalkUserWithRoleWrites: Writes[SidewalkUserWithRole] = (
    (JsPath \ "user_id").write[String] and
      (JsPath \ "username").write[String] and
      (JsPath \ "email").write[String] and
      (JsPath \ "role").write[Role] and
      (JsPath \ "community_service").write[Boolean] and
      (JsPath \ "infra3d_access").write[Boolean] and
      (JsPath \ "measurement_system").writeNullable[MeasurementSystem]
  )((o: SidewalkUserWithRole) => Tuple.fromProductTyped(o))

  given userStatsWrites: Writes[UserStatsForAdminPage] = (
    (__ \ "userId").write[String] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "role").write[Role] and
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
  )((o: UserStatsForAdminPage) => Tuple.fromProductTyped(o))

  given teamWrites: Writes[Team] = (
    (JsPath \ "teamId").write[Int] and
      (JsPath \ "name").write[String] and
      (JsPath \ "description").write[String] and
      (JsPath \ "open").write[Boolean] and
      (JsPath \ "visible").write[Boolean]
  )((o: Team) => Tuple.fromProductTyped(o))

  /**
   * The admin team page's payload (`/adminapi/team/:teamId`, #5381), snake_case throughout. Accuracy travels as raw
   * (validated, agreed) counts, not a percentage, so the team's rate can pool its members' judged labels rather than
   * average rates that describe different amounts of work.
   */
  given teamMemberStatsWrites: Writes[TeamMemberStats] = (
    (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "role").write[Role] and
      (__ \ "labels").write[Int] and
      (__ \ "validations").write[Int] and
      (__ \ "distance_meters").write[Double] and
      (__ \ "labels_validated").write[Int] and
      (__ \ "labels_agreed").write[Int] and
      (__ \ "last_active").writeNullable[OffsetDateTime] and
      (__ \ "high_quality").write[Boolean] and
      (__ \ "excluded").write[Boolean]
  )((o: TeamMemberStats) => Tuple.fromProductTyped(o))

  given teamTotalsWrites: Writes[TeamTotals] = (
    (__ \ "members").write[Int] and
      (__ \ "labels").write[Int] and
      (__ \ "validations").write[Int] and
      (__ \ "distance_meters").write[Double] and
      (__ \ "labels_validated").write[Int] and
      (__ \ "labels_agreed").write[Int]
  )((o: TeamTotals) => Tuple.fromProductTyped(o))

  given teamOverviewWrites: Writes[TeamOverview] = Writes { overview =>
    Json.obj(
      "team" -> Json.obj(
        "team_id"     -> overview.team.teamId,
        "name"        -> overview.team.name,
        "description" -> overview.team.description,
        "open"        -> overview.team.open,
        "visible"     -> overview.team.visible
      ),
      "members" -> Json.toJson(overview.members),
      "totals"  -> Json.toJson(overview.totals)
    )
  }

  given userSearchResultWrites: Writes[UserSearchResult] = (
    (__ \ "user_id").write[String] and
      (__ \ "username").write[String] and
      (__ \ "email").write[String] and
      (__ \ "role").write[Role] and
      (__ \ "team").writeNullable[String]
  )((o: UserSearchResult) => Tuple.fromProductTyped(o))

  given cityHoursWrites: Writes[CityHours] = (
    (JsPath \ "city_id").write[String] and
      (JsPath \ "city_name").write[String] and
      (JsPath \ "hours").write[Double] and
      (JsPath \ "is_current_city").write[Boolean]
  )((o: CityHours) => Tuple.fromProductTyped(o))

  /**
   * The hours the Manage user page fills its KPI and breakdown from (`/adminapi/users/:userId/crossCityHours`, #4986).
   *
   * `total_hours` and `show_breakdown` are carried rather than left for the client to re-derive: `/timeCheck` reads
   * both straight off the same [[service.CrossCityHours]], and an admin verifying a service-hours claim against a
   * number assembled a second way is the failure this endpoint exists to prevent.
   */
  given crossCityHoursWrites: Writes[CrossCityHours] = Writes { hours =>
    Json.obj(
      "total_hours"        -> hours.totalHours,
      "cities"             -> hours.cities,
      "show_breakdown"     -> hours.showBreakdown,
      "unreachable_cities" -> hours.unreachableCities
    )
  }
}
