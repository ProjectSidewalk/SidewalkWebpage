package formats.json

import models.label.{LabelAccuracy, LabelSeverityStats, ProjectSidewalkStats}
import play.api.libs.functional.syntax._
import play.api.libs.json._

object APIFormats {
  implicit val labelSeverityStatsWrites: Writes[LabelSeverityStats] = (
    (__ \ "count").write[Int] and
      (__ \ "count_with_severity").write[Int] and
        (__ \ "severity_mean").writeNullable[Float] and
        (__ \ "severity_sd").writeNullable[Float]
  )(unlift(LabelSeverityStats.unapply))

  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      (__ \ "accuracy").writeNullable[Float]
    ) (unlift(LabelAccuracy.unapply))

  def projectSidewalkStatsToJson(stats: ProjectSidewalkStats): JsObject = {
    Json.obj(
      "launch_date" -> stats.launchDate,
      "km_explored" -> stats.kmExplored,
      "km_explored_no_overlap" -> stats.kmExploreNoOverlap,
      "user_counts" -> Json.obj(
        "all_users" -> stats.nUsers,
        "labelers" -> stats.nExplorers,
        "validators" -> stats.nValidators,
        "registered" -> stats.nRegistered,
        "anonymous" -> stats.nAnon,
        "turker" -> stats.nTurker,
        "researcher" -> stats.nResearcher
      ),
      "labels" -> JsObject(
        Seq(("label_count", JsNumber(stats.nLabels.toDouble))) ++
          // Turns into { "CurbRamp" -> { "count" -> ###, ... }, ... }.
          stats.severityByLabelType.map { case (labType, sevStats) => labType -> Json.toJson(sevStats) }
      ),
      "validations" -> JsObject(
        Seq("total_validations" -> JsNumber(stats.nValidations.toDouble)) ++
          // Turns into { "Overall" -> { "validated" -> ###, ... }, "CurbRamp" -> { "validated" -> ###, ... }, ... }.
        stats.accuracyByLabelType.map { case (labType, accStats) => labType -> Json.toJson(accStats) }
      )
    )
  }
}
