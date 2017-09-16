package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

//object IssueFormats {
//  case class NoStreetView(streetEdgeId: Int, space: String)
//
//  implicit val noStreetViewReads: Reads[NoStreetView] = (
//    (JsPath \ "street_edge_id").read[Int] and
//      (JsPath \ "issue").read[String]
//    )(NoStreetView.apply _)
//}
object ClusteringFormats {

  case class ClusteredLabelSubmission(labelId: Int, labelType: String, clusterNum: Int)
  case class GTLabelSubmission(labelId: Option[Int], clusterId: Int, routeId: Int, gsvPanoId: String, labelType: Int,
                               svImageX: Int, svImageY: Int, svCanvasX: Int, svCanvasY: Int, heading: Float,
                               pitch: Float, zoom: Int, canvasHeight: Int, canvasWidth: Int, alphaX: Float,
                               alphaY: Float, lat: Option[Float], lng: Option[Float], description: Option[String],
                               severity: Option[Int], temporary: Option[Boolean])


  implicit val clusteredLabelSubmissionReads: Reads[ClusteredLabelSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "cluster").read[Int]
    )(ClusteredLabelSubmission.apply _)

  implicit val gtLabelSubmissionReads: Reads[GTLabelSubmission] = (
    (JsPath \ "label_id").readNullable[Int] and
      (JsPath \ "cluster_id").read[Int] and
      (JsPath \ "route_id").read[Int] and
      (JsPath \ "pano_id").read[String] and
      (JsPath \ "label_type").read[Int] and
      (JsPath \ "sv_image_x").read[Int] and
      (JsPath \ "sv_image_y").read[Int] and
      (JsPath \ "sv_canvas_x").read[Int] and
      (JsPath \ "sv_canvas_y").read[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Int] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "alpha_x").read[Float] and
      (JsPath \ "alpha_y").read[Float] and
      (JsPath \ "lat").read[Option[Float]] and
      (JsPath \ "lng").read[Option[Float]] and
      (JsPath \ "description").readNullable[String] and
      (JsPath \ "severity").readNullable[Int] and
      (JsPath \ "temporary").readNullable[Boolean]
    )(GTLabelSubmission.apply _)
}