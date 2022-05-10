package formats.json

import play.api.libs.json.{JsPath, Reads}
import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object GalleryFormats {
  case class GalleryEnvironmentSubmission(browser: Option[String], browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int], screenWidth: Option[Int], screenHeight: Option[Int], availWidth: Option[Int], availHeight: Option[Int], operatingSystem: Option[String], language: String)
  case class GalleryInteractionSubmission(action: String, panoId: Option[String], note: Option[String], timestamp: Long)
  case class GalleryTaskSubmission(environment: GalleryEnvironmentSubmission, interactions: Seq[GalleryInteractionSubmission])
  case class GalleryLabelsRequest(labelTypeId: Int, n: Int, severities: Option[Seq[Int]], tags: Option[Seq[String]], loadedLabels: Seq[Int])

  implicit val galleryEnvironmentSubmissionReads: Reads[GalleryEnvironmentSubmission] = (
    (JsPath \ "browser").readNullable[String] and
      (JsPath \ "browser_version").readNullable[String] and
      (JsPath \ "browser_width").readNullable[Int] and
      (JsPath \ "browser_height").readNullable[Int] and
      (JsPath \ "screen_width").readNullable[Int] and
      (JsPath \ "screen_height").readNullable[Int] and
      (JsPath \ "avail_width").readNullable[Int] and
      (JsPath \ "avail_height").readNullable[Int] and
      (JsPath \ "operating_system").readNullable[String] and
      (JsPath \ "language").read[String]
    )(GalleryEnvironmentSubmission.apply _)

  implicit val galleryInteractionSubmissionReads: Reads[GalleryInteractionSubmission] = (
    (JsPath \ "action").read[String] and
      (JsPath \ "pano_id").readNullable[String] and
      (JsPath \ "note").readNullable[String] and
      (JsPath \ "timestamp").read[Long]
    )(GalleryInteractionSubmission.apply _)

  implicit val galleryTaskSubmissionReads: Reads[GalleryTaskSubmission] = (
    (JsPath \ "environment").read[GalleryEnvironmentSubmission] and
      (JsPath \ "interactions").read[Seq[GalleryInteractionSubmission]]
    )(GalleryTaskSubmission.apply _)

  implicit val galleryLabelsRequestReads: Reads[GalleryLabelsRequest] = (
    (JsPath \ "labelTypeId").read[Int] and
      (JsPath \ "n").read[Int] and
      (JsPath \ "severities").readNullable[Seq[Int]] and
      (JsPath \ "tags").readNullable[Seq[String]] and
      (JsPath \ "loadedLabels").read[Seq[Int]]
  )(GalleryLabelsRequest.apply _)
}
