package formats.json

import models.pano.PanoSource
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsError, JsPath, JsSuccess, Reads}

import java.time.OffsetDateTime
import scala.util.{Failure, Success, Try}

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

  implicit val panoSourceReads: Reads[PanoSource.Value] = Reads { json =>
    json.validate[String].flatMap { str =>
      Try(PanoSource.withName(str)) match {
        case Success(source) => JsSuccess(source)
        case Failure(_) => JsError(s"Invalid PanoSource value: $str")
      }
    }
  }
}
