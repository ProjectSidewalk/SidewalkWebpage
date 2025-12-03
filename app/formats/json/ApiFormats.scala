package formats.json

import models.cluster.ClusterForApi
import models.computation.{RegionScore, StreetScore}
import models.gsv.GsvDataSlim
import models.label._
import models.region.Region
import models.user.{LabelTypeStat, UserStatApi}
import models.utils.MapParams
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.MultiPolygon
import play.api.libs.functional.syntax._
import play.api.libs.json._
import java.time.OffsetDateTime

object ApiFormats {
  private def formatOptionForCSV(x: Option[Any]): String = { x.map(_.toString).getOrElse("NA").replace("\"", "\"\"") }

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

  implicit val labelSeverityStatsWrites: Writes[LabelSeverityStats] = (
    (__ \ "count").write[Int] and
      (__ \ "count_with_severity").write[Option[Int]] and
      (__ \ "severity_mean").write[Option[Float]] and
      (__ \ "severity_sd").write[Option[Float]]
  )(unlift(LabelSeverityStats.unapply))

  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      (__ \ "accuracy").writeNullable[Float] and
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

  implicit val labelTypeStatWrites: Writes[LabelTypeStat] = (
    (__ \ "labels").write[Int] and
      (__ \ "validated_correct").write[Int] and
      (__ \ "validated_incorrect").write[Int] and
      (__ \ "not_validated").write[Int]
  )(unlift(LabelTypeStat.unapply))

  def regionScoreToJson(n: RegionScore): JsObject = {
    if (n.coverage > 0.0d) {
      val properties: JsObject = Json.obj(
        "coverage"     -> n.coverage,
        "region_id"    -> n.regionId,
        "region_name"  -> n.name,
        "score"        -> n.score,
        "significance" -> Json.obj(
          LabelTypeEnum.CurbRamp.name       -> n.significanceScores(0),
          LabelTypeEnum.NoCurbRamp.name     -> n.significanceScores(1),
          LabelTypeEnum.Obstacle.name       -> n.significanceScores(2),
          LabelTypeEnum.SurfaceProblem.name -> n.significanceScores(3)
        ),
        "avg_attribute_count" -> Json.obj(
          LabelTypeEnum.CurbRamp.name       -> n.clusterScores(0),
          LabelTypeEnum.NoCurbRamp.name     -> n.clusterScores(1),
          LabelTypeEnum.Obstacle.name       -> n.clusterScores(2),
          LabelTypeEnum.SurfaceProblem.name -> n.clusterScores(3)
        ),
        "avg_image_capture_date" -> n.avgImageCaptureDate.map(_.toString),
        "avg_label_date"         -> n.avgLabelDate.map(_.toString)
      )
      Json.obj("type" -> "Feature", "geometry" -> n.geom, "properties" -> properties)
    } else {
      val properties: JsObject = Json.obj(
        "coverage"     -> 0.0,
        "region_id"    -> n.regionId,
        "region_name"  -> n.name,
        "score"        -> None.asInstanceOf[Option[Double]],
        "significance" -> Json.obj(
          LabelTypeEnum.CurbRamp.name       -> 0.75,
          LabelTypeEnum.NoCurbRamp.name     -> -1.0,
          LabelTypeEnum.Obstacle.name       -> -1.0,
          LabelTypeEnum.SurfaceProblem.name -> -1.0
        ),
        "avg_attribute_count"    -> None.asInstanceOf[Option[Array[Double]]],
        "avg_image_capture_date" -> None.asInstanceOf[Option[OffsetDateTime]],
        "avg_label_date"         -> None.asInstanceOf[Option[OffsetDateTime]]
      )
      Json.obj("type" -> "Feature", "geometry" -> n.geom, "properties" -> properties)
    }
  }

  def regionScoreToCSVRow(n: RegionScore): String = {
    val coordStr: String = s""""[${n.geom.getCoordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
    if (n.coverage > 0.0d) {
      s""""${n.name}",${n.regionId},${n.score},$coordStr,${n.coverage},${n.clusterScores(0)},""" +
        s"${n.clusterScores(1)},${n.clusterScores(2)},${n.clusterScores(3)},${n.significanceScores(0)}," +
        s"${n.significanceScores(1)},${n.significanceScores(2)},${n.significanceScores(3)}," +
        s"${n.avgImageCaptureDate.map(_.toString).getOrElse("NA")},${n.avgLabelDate.map(_.toString).getOrElse("NA")}"
    } else {
      s""""${n.name}",${n.regionId},NA,$coordStr,0.0,NA,NA,NA,NA,${n.significanceScores(0)},""" +
        s"${n.significanceScores(1)},${n.significanceScores(2)},${n.significanceScores(3)},NA,NA"
    }
  }

  def streetScoreToJSON(s: StreetScore): JsObject = {
    val properties = Json.obj(
      "street_edge_id"         -> s.streetEdge.streetEdgeId,
      "osm_id"                 -> s.osmId,
      "region_id"              -> s.regionId,
      "score"                  -> s.score,
      "audit_count"            -> s.auditCount,
      "avg_image_capture_date" -> s.avgImageCaptureDate.map(_.toString),
      "avg_label_date"         -> s.avgLabelDate.map(_.toString),
      "significance"           -> Json.obj(
        LabelTypeEnum.CurbRamp.name       -> s.significance(0),
        LabelTypeEnum.NoCurbRamp.name     -> s.significance(1),
        LabelTypeEnum.Obstacle.name       -> s.significance(2),
        LabelTypeEnum.SurfaceProblem.name -> s.significance(3)
      ),
      "attribute_count" -> Json.obj(
        LabelTypeEnum.CurbRamp.name       -> s.clusters(0),
        LabelTypeEnum.NoCurbRamp.name     -> s.clusters(1),
        LabelTypeEnum.Obstacle.name       -> s.clusters(2),
        LabelTypeEnum.SurfaceProblem.name -> s.clusters(3)
      )
    )
    Json.obj("type" -> "Feature", "geometry" -> s.streetEdge.geom, "properties" -> properties)
  }

  def streetScoreToCSVRow(s: StreetScore): String = {
    val coordStr: String = s""""[${s.streetEdge.geom.getCoordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
    s"${s.streetEdge.streetEdgeId},${s.osmId},${s.regionId},${s.score},$coordStr,${s.auditCount},${s.clusters(0)}," +
      s"${s.clusters(1)},${s.clusters(2)},${s.clusters(3)},${s.significance(0)},${s.significance(1)}," +
      s"${s.significance(2)},${s.significance(3)},${s.avgImageCaptureDate.map(_.toString).getOrElse("NA")}," +
      s"${s.avgLabelDate.map(_.toString).getOrElse("NA")}"
  }

  def clusterToJson(a: ClusterForApi): JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> a.geom,
      "properties" -> Json.obj(
        "cluster_id"             -> a.clusterId,
        "label_type"             -> a.labelType,
        "street_edge_id"         -> a.streetEdgeId,
        "osm_street_id"          -> a.osmStreetId,
        "neighborhood"           -> a.neighborhoodName,
        "avg_image_capture_date" -> a.avgImageCaptureDate.toString,
        "avg_label_date"         -> a.avgLabelDate.toString,
        "severity"               -> a.severity,
        "agree_count"            -> a.agreeCount,
        "disagree_count"         -> a.disagreeCount,
        "unsure_count"           -> a.unsureCount,
        "cluster_size"           -> a.labelCount,
        "users"                  -> a.usersList
      )
    )
  }

  def clusterToCsvRow(a: ClusterForApi): String = {
    s"""${a.clusterId},${a.labelType},${a.streetEdgeId},${a.osmStreetId},"${a.neighborhoodName}",""" +
      s"${a.geom.getY},${a.geom.getX},${a.avgImageCaptureDate},${a.avgLabelDate},${a.severity.getOrElse("NA")}," +
      s"""${a.agreeCount},${a.disagreeCount},${a.unsureCount},${a.labelCount},"[${a.usersList.mkString(",")}]""""
  }

  def projectSidewalkStatsToJson(stats: ProjectSidewalkStats): JsObject = {
    Json.obj(
      "launch_date"                   -> stats.launchDate,
      "avg_timestamp_last_100_labels" -> stats.avgTimestampLast100Labels,
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
        Seq(("label_count", JsNumber(stats.nLabels.toDouble))) ++
          // Turns into { "CurbRamp" -> { "count" -> ###, ... }, ... }.
          stats.severityByLabelType.map { case (labType, sevStats) => labType -> Json.toJson(sevStats) }
      ),
      "validations" -> JsObject(
        Seq("total_validations" -> JsNumber(stats.nValidations.toDouble)) ++
          // Turns into { "Overall" -> { "validated" -> ###, ... }, "CurbRamp" -> { "validated" -> ###, ... }, ... }.
          stats.accuracyByLabelType.map { case (labType, accStats) => labType -> Json.toJson(accStats) }
      ),
      "ai_stats" -> JsObject(
        // { "Overall" -> "human_maj_vote" -> { "ai_yes_human_concurs": ###, ... }, ... }, "CurbRamp" -> { ... }, ... }.
        stats.aiPerformance.map { case (labelType, perfStatsMap) =>
          labelType -> JsObject(
            perfStatsMap.map { case (comparisonGroup, perfStats) => comparisonGroup -> Json.toJson(perfStats) }
          )
        }
      )
    )
  }

  def userStatToJson(u: UserStatApi): JsObject = {
    Json.obj(
      "user_id"                      -> u.userId,
      "labels"                       -> u.labels,
      "meters_explored"              -> u.metersExplored,
      "labels_per_meter"             -> u.labelsPerMeter,
      "high_quality"                 -> u.highQuality,
      "high_quality_manual"          -> u.highQualityManual,
      "label_accuracy"               -> u.labelAccuracy,
      "validated_labels"             -> u.validatedLabels,
      "validations_received"         -> u.validationsReceived,
      "labels_validated_correct"     -> u.labelsValidatedCorrect,
      "labels_validated_incorrect"   -> u.labelsValidatedIncorrect,
      "labels_not_validated"         -> u.labelsNotValidated,
      "validations_given"            -> u.validationsGiven,
      "dissenting_validations_given" -> u.dissentingValidationsGiven,
      "agree_validations_given"      -> u.agreeValidationsGiven,
      "disagree_validations_given"   -> u.disagreeValidationsGiven,
      "unsure_validations_given"     -> u.unsureValidationsGiven,
      "stats_by_label_type"          -> Json.obj(
        "curb_ramp"         -> Json.toJson(u.statsByLabelType(LabelTypeEnum.CurbRamp.name)),
        "no_curb_ramp"      -> Json.toJson(u.statsByLabelType(LabelTypeEnum.NoCurbRamp.name)),
        "obstacle"          -> Json.toJson(u.statsByLabelType(LabelTypeEnum.Obstacle.name)),
        "surface_problem"   -> Json.toJson(u.statsByLabelType(LabelTypeEnum.SurfaceProblem.name)),
        "no_sidewalk"       -> Json.toJson(u.statsByLabelType(LabelTypeEnum.NoSidewalk.name)),
        "marked_crosswalk"  -> Json.toJson(u.statsByLabelType(LabelTypeEnum.Crosswalk.name)),
        "pedestrian_signal" -> Json.toJson(u.statsByLabelType(LabelTypeEnum.Signal.name)),
        "cant_see_sidewalk" -> Json.toJson(u.statsByLabelType(LabelTypeEnum.Occlusion.name)),
        "other"             -> Json.toJson(u.statsByLabelType(LabelTypeEnum.Other.name))
      )
    )
  }

  def userStatToCSVRow(s: UserStatApi): String = {
    s"${s.userId},${s.labels},${s.metersExplored},${formatOptionForCSV(s.labelsPerMeter)},${s.highQuality}," +
      s"${formatOptionForCSV(s.highQualityManual)},${formatOptionForCSV(s.labelAccuracy)},${s.validatedLabels}," +
      s"${s.validationsReceived},${s.labelsValidatedCorrect},${s.labelsValidatedIncorrect},${s.labelsNotValidated}," +
      s"${s.validationsGiven},${s.dissentingValidationsGiven},${s.agreeValidationsGiven}," +
      s"${s.disagreeValidationsGiven},${s.unsureValidationsGiven}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.CurbRamp.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.NoCurbRamp.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.Obstacle.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.SurfaceProblem.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.NoSidewalk.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.Crosswalk.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.Signal.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.Occlusion.name))}," +
      s"${labelTypeStatToCSVRow(s.statsByLabelType(LabelTypeEnum.Other.name))}"
  }

  def labelCVMetadataToCSVRow(l: LabelCVMetadata): String = {
    s"${l.labelId},${l.panoId},${l.labelTypeId},${l.agreeCount},${l.disagreeCount},${l.unsureCount}," +
      s"${formatOptionForCSV(l.panoWidth)},${formatOptionForCSV(l.panoHeight)},${l.panoX},${l.panoY}," +
      s"${l.canvasWidth},${l.canvasHeight},${l.canvasX},${l.canvasY},${l.zoom},${l.heading},${l.pitch}," +
      s"${l.cameraHeading},${l.cameraPitch}"
  }

  // Just uses implicit convert defined below.
  def labelCVMetadataToJSON(l: LabelCVMetadata): JsValue = { Json.toJson(l) }

  implicit val labelCVMetadataWrites: Writes[LabelCVMetadata] = (
    (__ \ "label_id").write[Int] and
      (__ \ "gsv_panorama_id").write[String] and
      (__ \ "label_type_id").write[Int] and
      (__ \ "agree_count").write[Int] and
      (__ \ "disagree_count").write[Int] and
      (__ \ "unsure_count").write[Int] and
      (__ \ "pano_width").writeNullable[Int] and
      (__ \ "pano_height").writeNullable[Int] and
      (__ \ "pano_x").write[Int] and
      (__ \ "pano_y").write[Int] and
      (__ \ "canvas_width").write[Int] and
      (__ \ "canvas_height").write[Int] and
      (__ \ "canvas_x").write[Int] and
      (__ \ "canvas_y").write[Int] and
      (__ \ "zoom").write[Int] and
      (__ \ "heading").write[Float] and
      (__ \ "pitch").write[Float] and
      (__ \ "camera_heading").write[Float] and
      (__ \ "camera_pitch").write[Float]
  )(unlift(LabelCVMetadata.unapply))

  private def labelTypeStatToCSVRow(l: LabelTypeStat): String = {
    s"${l.labels},${l.validatedCorrect},${l.validatedIncorrect},${l.notValidated}"
  }

  implicit val gsvDataSlimWrites: Writes[GsvDataSlim] = (
    (__ \ "gsv_panorama_id").write[String] and
      (__ \ "has_labels").write[Boolean] and
      (__ \ "width").writeNullable[Int] and
      (__ \ "height").writeNullable[Int] and
      (__ \ "lat").writeNullable[Float] and
      (__ \ "lng").writeNullable[Float] and
      (__ \ "camera_heading").writeNullable[Float] and
      (__ \ "camera_pitch").writeNullable[Float]
  )(unlift(GsvDataSlim.unapply))
}
