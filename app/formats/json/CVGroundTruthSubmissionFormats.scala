package formats.json

import play.api.libs.json.{JsPath, Json, Reads}
import play.api.libs.functional.syntax._

/**
  * The client can submit various JSON payloads relating to computer vision ground truth audits. For example,
  * a list of panoIds to be audited along with their lat/lng positions or a panoId that has been audited.
  */
object CVGroundTruthSubmissionFormats {
  case class CVGroundTruthPanoidListSubmission(panos: Seq[PanoData], numPanos: Int)
  case class CVGroundTruthPanoIdSubmission(pano: String, numRemaining: Int, missionId: Int)
  case class PanoData(panoId: String, lat: Float, lng: Float)

  implicit val panoDataSubmission: Reads[PanoData] = (
    (JsPath \ "panoId").read[String] and
      (JsPath \ "lat").read[Float] and
      (JsPath \ "lng").read[Float]
    )(PanoData.apply _)

  implicit val groundTruthPanoIdListSubmission: Reads[CVGroundTruthPanoidListSubmission] = (
    (JsPath \ "panos").read[Seq[PanoData]] and
      (JsPath \ "num_panos").read[Int]
    )(CVGroundTruthPanoidListSubmission.apply _)

  implicit val groundTruthPanoCompleteSubmission: Reads[CVGroundTruthPanoIdSubmission] = (
    (JsPath \ "pano").read[String] and
      (JsPath \ "num_remaining").read[Int] and
      (JsPath \ "mission_id").read[Int]
    )(CVGroundTruthPanoIdSubmission.apply _)
}


