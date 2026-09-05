package formats.json

import models.pano.PanoSource
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsError, JsPath, JsSuccess, Reads}

import java.time.OffsetDateTime
import scala.util.Try

object PanoFormats {
  case class PanoDate(panoId: String, date: String)
  case class PanoHistorySubmission(currPanoId: String, history: Seq[PanoDate], panoHistorySaved: OffsetDateTime)

  implicit val panoDateReads: Reads[PanoDate] = (
    (JsPath \ "pano_id").read[String] and
      (JsPath \ "date").read[String]
  )(PanoDate.apply _)

  implicit val panoHistorySubmissionReads: Reads[PanoHistorySubmission] = (
    (JsPath \ "curr_pano_id").read[String] and
      (JsPath \ "history").read[Seq[PanoDate]] and
      (JsPath \ "pano_history_saved").read[OffsetDateTime]
  )(PanoHistorySubmission.apply _)

  // Restricted to clientSubmittableSources so that a server-owned source can't be claimed by a submission.
  implicit val panoSourceReads: Reads[PanoSource.Value] = Reads { json =>
    val validTypes: String = PanoSource.clientSubmittableSources.mkString(", ")
    json.validate[String].flatMap { panoSource =>
      Try(PanoSource.withName(panoSource)).toOption.filter(PanoSource.clientSubmittableSources.contains) match {
        case Some(source) => JsSuccess(source)
        case None         => JsError(s"Invalid viewer type: $panoSource. Valid types are: $validTypes.")
      }
    }
  }
}
