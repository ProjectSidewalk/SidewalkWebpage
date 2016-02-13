package formats.json

import play.api.libs.json.{JsBoolean, JsPath, Reads}
import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object CommentSubmissionFormats {
  case class CommentSubmission(streetEdgeId: Int, comment: String, gsvPanoramaId: Option[String], heading: Option[Double], pitch: Option[Double], zoom: Option[Int])

  implicit val commentSubmissionReads: Reads[CommentSubmission] = (
    (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "comment").read[String] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "heading").readNullable[Double] and
      (JsPath \ "pitch").readNullable[Double] and
      (JsPath \ "zoom").readNullable[Int]
    )(CommentSubmission.apply _)
}