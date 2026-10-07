package formats.json

import models.cluster.LabelToCluster
import models.utils.ClusteringThreshold
import play.api.libs.functional.syntax.*
import play.api.libs.json.*

object ClusterFormats {
  private given jsonConfig: JsonConfiguration =
    JsonConfiguration(JsonNaming.SnakeCase, optionHandlers = OptionHandlers.WritesNull)

  case class ClusteredLabelSubmission(labelId: Int, labelType: String, clusterNum: Int)
  case class ClusterSubmission(labelType: String, clusterNum: Int, lat: Double, lng: Double, severity: Option[Int])
  case class ClusteringSubmission(
      thresholds: Seq[ClusteringThreshold],
      labels: Seq[ClusteredLabelSubmission],
      clusters: Seq[ClusterSubmission]
  )

  given clusteredLabelSubmissionReads: Reads[ClusteredLabelSubmission] = (
    (JsPath \ "label_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "cluster").read[Int]
  )(ClusteredLabelSubmission.apply)

  given clusterSubmissionReads: Reads[ClusterSubmission] = (
    (JsPath \ "label_type").read[String] and
      (JsPath \ "cluster").read[Int] and
      (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double] and
      (JsPath \ "severity").readNullable[Int]
  )(ClusterSubmission.apply)

  given clusteringSubmissionReads: Reads[ClusteringSubmission] = Json.reads[ClusteringSubmission]

  given labelToClusterWrites: Writes[LabelToCluster] = Json.writes[LabelToCluster]
}
