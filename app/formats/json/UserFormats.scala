package formats.json

import models.user.*
import play.api.libs.json.*
import service.{CityHours, CrossCityHours, TeamMemberStats, TeamOverview, TeamTotals}

object UserFormats {
  // snake_case keys for the Json.writes macros below.
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

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

  given settingsSubmissionReads: Reads[SettingsSubmission] =
    Json.reads[SettingsSubmission].map(s => s.copy(username = s.username.map(_.trim)))

  given sidewalkUserWithRoleWrites: Writes[SidewalkUserWithRole] = Json.writes[SidewalkUserWithRole]

  given userStatsWrites: Writes[UserStatsForAdminPage] = Json.writes[UserStatsForAdminPage]

  given teamWrites: Writes[Team] = Json.writes[Team]

  /**
   * The admin team page's payload (`/adminapi/team/:teamId`, #5381), snake_case throughout. Accuracy travels as raw
   * (validated, agreed) counts, not a percentage, so the team's rate can pool its members' judged labels rather than
   * average rates that describe different amounts of work.
   */
  given teamMemberStatsWrites: Writes[TeamMemberStats] = Json.writes[TeamMemberStats]

  given teamTotalsWrites: Writes[TeamTotals] = Json.writes[TeamTotals]

  given teamOverviewWrites: Writes[TeamOverview] = Json.writes[TeamOverview]

  given userSearchResultWrites: Writes[UserSearchResult] = Json.writes[UserSearchResult]

  given cityHoursWrites: Writes[CityHours] = Json.writes[CityHours]

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
