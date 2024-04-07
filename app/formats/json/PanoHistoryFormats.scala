package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

object PanoHistoryFormats {
  case class PanoDate(panoId: String, date: String)
  case class PanoHistorySubmission(currentPanoId: String, history: Seq[PanoDate], visitedTimestamp: Long)

  implicit val PanoDateReads: Reads[PanoDate] = (
    (JsPath \ "pano_id").read[String] and
      (JsPath \ "date").read[String]
    )(PanoDate.apply _)

  implicit val PanoHistorySubmissionReads: Reads[PanoHistorySubmission] = (
    (JsPath \ "current_pano_id").read[String] and
      (JsPath \ "history").read[Seq[PanoDate]] and
      (JsPath \ "visited_timestamp").read[Long]
    )(PanoHistorySubmission.apply _)
}
