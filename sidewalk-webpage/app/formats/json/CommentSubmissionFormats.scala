package formats.json

import play.api.libs.json.{JsBoolean, JsPath, Reads}
import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object CommentSubmissionFormats {
  case class CommentSubmission(edgeId: Int, comment: String, gsvPanoramaId: Option[String], heading: Option[Float], pitch: Option[Float], zoom: Option[Int])

  implicit val commentSubmissionReads: Reads[CommentSubmission] = (
    (JsPath \ "edge_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "heading").readNullable[Float] and
      (JsPath \ "pitch").readNullable[Float] and
      (JsPath \ "zoom").readNullable[Int]
    )(CommentSubmission.apply _)
}