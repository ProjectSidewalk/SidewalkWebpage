package formats.json

import controllers.helper.ControllerUtils.labelTypeOrdering
import models.label._
import models.pano.{PanoDataSlim, PanoSource}
import models.region.Region
import models.utils.MapParams
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.MultiPolygon
import play.api.libs.functional.syntax._
import play.api.libs.json._

object ApiFormats {

  /**
   * Converts a Region object to JSON format
   */
  implicit val regionWrites: Writes[Region] = (
    (__ \ "region_id").write[Int] and
      (__ \ "data_source").write[String] and
      (__ \ "name").write[String] and
      (__ \ "geometry").write[MultiPolygon] and
      (__ \ "deleted").write[Boolean]
  )(unlift(Region.unapply))

  implicit val labelSeverityStatsWrites: Writes[LabelSevStats] = (
    (__ \ "count").write[Int] and
      (__ \ "count_with_severity").write[Option[Int]] and
      (__ \ "severity_mean").write[Option[Double]] and
      (__ \ "severity_sd").write[Option[Double]]
  )(unlift(LabelSevStats.unapply))

  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      (__ \ "accuracy").writeNullable[Double] and
      (__ \ "has_a_validation").write[Int]
  )(unlift(LabelAccuracy.unapply))

  implicit val aiConcurrenceWrites: Writes[AiConcurrence] = (
    (__ \ "ai_yes_human_concurs").write[Int] and
      (__ \ "ai_yes_human_differs").write[Int] and
      (__ \ "ai_no_human_differs").write[Int] and
      (__ \ "ai_no_human_concurs").write[Int]
  )(unlift(AiConcurrence.unapply))

  implicit val mapParamsWrites: Writes[MapParams] = (
    (__ \ "center_lat").write[Double] and
      (__ \ "center_lng").write[Double] and
      (__ \ "zoom").write[Double] and
      (__ \ "lat1").write[Double] and
      (__ \ "lng1").write[Double] and
      (__ \ "lat2").write[Double] and
      (__ \ "lng2").write[Double]
  )(unlift(MapParams.unapply))

  /** Serializes one validation-vote source (combined/human/ai): a total count plus a per-label-type accuracy block. */
  private def validationSourceToJson(src: ValidationSourceStats): JsObject = JsObject(
    Seq("total_validations" -> JsNumber(src.nValidations.toDouble)) ++
      // Turns into { "Overall" -> { "validated" -> ###, ... }, "CurbRamp" -> { "validated" -> ###, ... }, ... }.
      src.accuracyByLabelType.toSeq.sorted(labelTypeOrdering).map(s => s._1 -> Json.toJson(s._2))
  )

  def projectSidewalkStatsToJson(stats: ProjectSidewalkStats): JsObject = {
    Json.obj(
      "launch_date"                   -> stats.launchDate,
      "avg_timestamp_last_100_labels" -> stats.avgTimestampLast100Labels.map(_.toString),
      "km_explored"                   -> stats.kmExplored,
      "km_explored_no_overlap"        -> stats.kmExploreNoOverlap,
      "user_counts"                   -> Json.obj(
        "all_users"  -> stats.nUsers,
        "labelers"   -> stats.nExplorers,
        "validators" -> stats.nValidators,
        "registered" -> stats.nRegistered,
        "anonymous"  -> stats.nAnon,
        "turker"     -> stats.nTurker,
        "researcher" -> stats.nResearcher
      ),
      "labels" -> JsObject(
        Seq(
          ("label_count", JsNumber(stats.nLabels.toDouble)),
          ("label_count_with_severity", JsNumber(stats.nLabelsWithSeverity.toDouble)),
          ("avg_label_timestamp", stats.avgLabelTimestamp.map(t => JsString(t.toString)).getOrElse(JsNull)),
          (
            "avg_age_of_image_when_labeled",
            stats.avgImageAgeByLabel.map(avgImgAge => JsString(s"${avgImgAge.toDays} days")).getOrElse(JsNull)
          ),
          (
            "stddev_label_timestamp",
            stats.stddevLabelTimestamp.map(sd => JsString(s"${sd.toDays} days")).getOrElse(JsNull)
          ),
          (
            "stddev_age_of_image_when_labeled",
            stats.stddevImageAgeByLabel.map(sd => JsString(s"${sd.toDays} days")).getOrElse(JsNull)
          )
        ) ++
          // Turns into { "CurbRamp" -> { "count" -> ###, ... }, ... }.
          stats.severityByLabelType.toSeq.sorted(labelTypeOrdering).map(stats => stats._1 -> Json.toJson(stats._2))
      ),
      // Validation stats are split three ways. "combined" includes both human and AI votes (AI votes are baked into
      // the label table's agree/disagree/correct counts); "human" and "ai" isolate each source via the validator role.
      "validations" -> Json.obj(
        "combined" -> validationSourceToJson(stats.validations.combined),
        "human"    -> validationSourceToJson(stats.validations.human),
        "ai"       -> validationSourceToJson(stats.validations.ai)
      ),
      "ai_stats" -> JsObject(
        // { "Overall" -> "human_maj_vote" -> { "ai_yes_human_concurs": ###, ... }, ... }, "CurbRamp" -> { ... }, ... }.
        stats.aiPerformance.map { case (lType, statsMap) =>
          lType -> JsObject(statsMap.toSeq.sorted(labelTypeOrdering).map(stats => stats._1 -> Json.toJson(stats._2)))
        }
      )
    )
  }

  implicit val panoDataSlimWrites: Writes[PanoDataSlim] = (
    (__ \ "pano_id").write[String] and
      (__ \ "has_labels").write[Boolean] and
      (__ \ "width").writeNullable[Int] and
      (__ \ "height").writeNullable[Int] and
      (__ \ "lat").writeNullable[Double] and
      (__ \ "lng").writeNullable[Double] and
      (__ \ "camera_heading").writeNullable[Double] and
      (__ \ "camera_pitch").writeNullable[Double] and
      (__ \ "camera_roll").writeNullable[Double] and
      (__ \ "source").write[PanoSource.Value]
  )(unlift(PanoDataSlim.unapply))
}
