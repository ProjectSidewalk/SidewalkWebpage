package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

object PanoramaHistoryFormats {
  case class IndividualPanoHistory(pano: String, year: Int, month: Int)
  case class PanoHistorySubmission(currentId: String, history: Seq[IndividualPanoHistory], visitedTimestamp: String)

  implicit val IndividualPanoHistoryReads: Reads[IndividualPanoHistory] = (
    (JsPath \ "pano").read[String] and
      (JsPath \ "year").read[Int] and
      (JsPath \ "month").read[Int]
    )(IndividualPanoHistory.apply _)

  implicit val PanoHistorySubmissionReads: Reads[PanoHistorySubmission] = (
    (JsPath \ "currentId").read[String] and
      (JsPath \ "history").read[Seq[IndividualPanoHistory]] and
      (JsPath \ "visitedTimestamp").read[String]
    )(PanoHistorySubmission.apply _)
}
