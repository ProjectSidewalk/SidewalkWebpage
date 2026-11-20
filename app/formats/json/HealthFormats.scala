package formats.json

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, Reads, Writes}

import java.time.OffsetDateTime

object HealthFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  /**
   * The `GET /health` body: git fields None if git couldn't answer at build time, version fields if the DB didn't.
   * `error` names the failure class on a database error, never its message, which can carry connection details.
   */
  case class HealthStatus(
      status: String,
      gitSha: Option[String],
      gitDescribe: Option[String],
      gitDirty: Boolean,
      version: Option[String],
      versionReleasedAt: Option[OffsetDateTime],
      cityId: String,
      environment: String,
      appStartedAt: OffsetDateTime,
      error: Option[String] = None,
      dbQueued: Option[Int] = None
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

  /**
   * The `/adminapi/fleetHealth` body. `latestGitSha` is the build of the most recently started healthy instance: a
   * restart always runs the newest staged build, so during a release this is the new build whichever city is viewed.
   */
  case class FleetHealth(
      generatedAt: OffsetDateTime,
      thisCityId: String,
      latestGitSha: Option[String],
      cities: Seq[FleetCityHealth],
      notDeployed: Seq[String]
  )

  /**
   * The `GET /health/memory` body (#6022), in MB. The `/proc` fields are None off Linux. `unaccountedMb` is RAM plus
   * swap minus the heap, the non-heap pools and the direct buffers: memory Java can't name.
   */
  case class MemoryStatus(
      cityId: String,
      appStartedAt: OffsetDateTime,
      readAt: OffsetDateTime,
      rssMb: Option[Long],
      swapMb: Option[Long],
      virtualMb: Option[Long],
      anonHugePagesMb: Option[Long],
      heapUsedMb: Long,
      heapCommittedMb: Long,
      heapMaxMb: Long,
      nonHeapPoolsMb: Map[String, Long],
      directBuffersMb: Long,
      mappedBuffersMb: Long,
      threads: Int,
      unaccountedMb: Option[Long]
  )

  given memoryStatusWrites: Writes[MemoryStatus]       = Json.writes[MemoryStatus]
  given healthStatusWrites: Writes[HealthStatus]       = Json.writes[HealthStatus]
  given healthStatusReads: Reads[HealthStatus]         = Json.reads[HealthStatus]
  given fleetCityHealthWrites: Writes[FleetCityHealth] = Json.writes[FleetCityHealth]
  given fleetHealthWrites: Writes[FleetHealth]         = Json.writes[FleetHealth]
}
