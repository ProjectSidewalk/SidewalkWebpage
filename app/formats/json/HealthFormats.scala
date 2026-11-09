package formats.json

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, Reads, Writes}

import java.time.OffsetDateTime

object HealthFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  /** The `GET /health` body: git fields None if git couldn't answer at build time, version fields if the DB didn't. */
  case class HealthStatus(
      status: String,
      gitSha: Option[String],
      gitDescribe: Option[String],
      gitDirty: Boolean,
      version: Option[String],
      versionReleasedAt: Option[OffsetDateTime],
      cityId: String,
      environment: String,
      appStartedAt: OffsetDateTime
  )

  /** One city's `/health`: the body when it parsed, else why not. */
  case class FleetCityHealth(
      cityId: String,
      cityName: String,
      url: String,
      httpStatus: Option[Int],
      health: Option[HealthStatus],
      error: Option[String]
  )

  /** The `/adminapi/fleetHealth` body; `thisGitSha` is what the rows are compared against. */
  case class FleetHealth(
      generatedAt: OffsetDateTime,
      thisCityId: String,
      thisGitSha: Option[String],
      cities: Seq[FleetCityHealth],
      notDeployed: Seq[String]
  )

  given healthStatusWrites: Writes[HealthStatus]       = Json.writes[HealthStatus]
  given healthStatusReads: Reads[HealthStatus]         = Json.reads[HealthStatus]
  given fleetCityHealthWrites: Writes[FleetCityHealth] = Json.writes[FleetCityHealth]
  given fleetHealthWrites: Writes[FleetHealth]         = Json.writes[FleetHealth]
}
