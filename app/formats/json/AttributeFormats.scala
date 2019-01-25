package formats.json

import play.api.libs.json.{ JsPath, Reads }
import play.api.libs.functional.syntax._

object AttributeFormats {

  case class ClusteringThresholdSubmission(labelType: String, threshold: Float)
  case class ClusteredLabelSubmission(labelId: Int, labelType: String, clusterNum: Int)
  case class ClusterSubmission(labelType: String, clusterNum: Int, lat: Float, lng: Float, severity: Option[Int], temporary: Boolean)
  case class ClusteringSubmission(
    thresholds: List[ClusteringThresholdSubmission],
    labels: List[ClusteredLabelSubmission],
    clusters: List[ClusterSubmission])

  implicit val clusteringThresholdSubmissionReads: Reads[ClusteringThresholdSubmission] = (
    (JsPath \ "label_type").read[String] and
    (JsPath \ "threshold").read[Float])(ClusteringThresholdSubmission.apply _)

  implicit val clusteredLabelSubmissionReads: Reads[ClusteredLabelSubmission] = (
    (JsPath \ "label_id").read[Int] and
    (JsPath \ "label_type").read[String] and
    (JsPath \ "cluster").read[Int])(ClusteredLabelSubmission.apply _)

  implicit val clusterSubmissionReads: Reads[ClusterSubmission] = (
    (JsPath \ "label_type").read[String] and
    (JsPath \ "cluster").read[Int] and
    (JsPath \ "lat").read[Float] and
    (JsPath \ "lng").read[Float] and
    (JsPath \ "severity").readNullable[Int] and
    (JsPath \ "temporary").read[Boolean])(ClusterSubmission.apply _)

  implicit val clusteringSubmissionReads: Reads[ClusteringSubmission] = (
    (JsPath \ "thresholds").read[List[ClusteringThresholdSubmission]] and
    (JsPath \ "labels").read[List[ClusteredLabelSubmission]] and
    (JsPath \ "clusters").read[List[ClusterSubmission]])(ClusteringSubmission.apply _)
}
