package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

import java.time.OffsetDateTime

object PanoHistoryFormats {
  case class PanoDate(panoId: String, date: String)
  case class PanoHistorySubmission(currPanoId: String, history: Seq[PanoDate], panoHistorySaved: OffsetDateTime)

  implicit val PanoDateReads: Reads[PanoDate] = (
    (JsPath \ "pano_id").read[String] and
      (JsPath \ "date").read[String]
    )(PanoDate.apply _)

  implicit val PanoHistorySubmissionReads: Reads[PanoHistorySubmission] = (
    (JsPath \ "curr_pano_id").read[String] and
      (JsPath \ "history").read[Seq[PanoDate]] and
      (JsPath \ "pano_history_saved").read[OffsetDateTime]
    )(PanoHistorySubmission.apply _)
}
