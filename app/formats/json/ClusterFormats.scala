package formats.json

import models.cluster.LabelToCluster
import models.utils.ClusteringThreshold
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads, Writes}

object ClusterFormats {
  case class ClusteredLabelSubmission(labelId: Int, labelType: String, clusterNum: Int)
  case class ClusterSubmission(labelType: String, clusterNum: Int, lat: Double, lng: Double, severity: Option[Int])
  case class ClusteringSubmission(
      thresholds: Seq[ClusteringThreshold],
      labels: Seq[ClusteredLabelSubmission],
      clusters: Seq[ClusterSubmission]
  )

  implicit val clusteredLabelSubmissionReads: Reads[ClusteredLabelSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "cluster").read[Int]
  )(ClusteredLabelSubmission.apply _)

  implicit val clusterSubmissionReads: Reads[ClusterSubmission] = (
    (JsPath \ "label_type").read[String] and
      (JsPath \ "cluster").read[Int] and
      (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double] and
      (JsPath \ "severity").readNullable[Int]
  )(ClusterSubmission.apply _)

  implicit val clusteringSubmissionReads: Reads[ClusteringSubmission] = (
    (JsPath \ "thresholds").read[Seq[ClusteringThreshold]] and
      (JsPath \ "labels").read[Seq[ClusteredLabelSubmission]] and
      (JsPath \ "clusters").read[Seq[ClusterSubmission]]
  )(ClusteringSubmission.apply _)

  implicit val labelToClusterWrites: Writes[LabelToCluster] = (
    (JsPath \ "region_id").write[Int] and
      (JsPath \ "label_id").write[Int] and
      (JsPath \ "label_type").write[String] and
      (JsPath \ "lat").write[Float] and
      (JsPath \ "lng").write[Float] and
      (JsPath \ "severity").write[Option[Int]]
  )(unlift(LabelToCluster.unapply))
}
