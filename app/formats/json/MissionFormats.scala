package formats.json

import models.label.LabelType
import models.mission.{Mission, MissionType}
import play.api.libs.json.*

import java.time.OffsetDateTime

object MissionFormats {
  // snake_case keys for the Json.writes macro below.
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  given missionWrites: Writes[Mission] = Json.writes[Mission]
}
