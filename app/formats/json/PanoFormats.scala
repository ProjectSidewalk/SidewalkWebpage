package formats.json

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, Reads}

import java.time.OffsetDateTime

object PanoFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  case class PanoDate(panoId: String, date: String)
  case class PanoHistorySubmission(currPanoId: String, history: Seq[PanoDate], panoHistorySaved: OffsetDateTime)

  given panoDateReads: Reads[PanoDate] = Json.reads[PanoDate]

  given panoHistorySubmissionReads: Reads[PanoHistorySubmission] = Json.reads[PanoHistorySubmission]
}
