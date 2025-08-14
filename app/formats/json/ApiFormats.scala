package formats.json

import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
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
  def formatOptionForCSV(x: Option[Any]): String = { x.map(_.toString).getOrElse("NA").replace("\"", "\"\"") }

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
      (__ \ "count_with_severity").write[Int] and
      (__ \ "severity_mean").writeNullable[Float] and
      (__ \ "severity_sd").writeNullable[Float]
  )(unlift(LabelSeverityStats.unapply))

  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
    (__ \ "validated").write[Int] and
      (__ \ "agreed").write[Int] and
      (__ \ "disagreed").write[Int] and
      (__ \ "accuracy").writeNullable[Float]
  )(unlift(LabelAccuracy.unapply))

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
          LabelTypeEnum.CurbRamp.name       -> n.attributeScores(0),
          LabelTypeEnum.NoCurbRamp.name     -> n.attributeScores(1),
          LabelTypeEnum.Obstacle.name       -> n.attributeScores(2),
          LabelTypeEnum.SurfaceProblem.name -> n.attributeScores(3)
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
      s""""${n.name}",${n.regionId},${n.score},$coordStr,${n.coverage},${n.attributeScores(0)},""" +
        s"${n.attributeScores(1)},${n.attributeScores(2)},${n.attributeScores(3)},${n.significanceScores(0)}," +
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
        LabelTypeEnum.CurbRamp.name       -> s.attributes(0),
        LabelTypeEnum.NoCurbRamp.name     -> s.attributes(1),
        LabelTypeEnum.Obstacle.name       -> s.attributes(2),
        LabelTypeEnum.SurfaceProblem.name -> s.attributes(3)
      )
    )
    Json.obj("type" -> "Feature", "geometry" -> s.streetEdge.geom, "properties" -> properties)
  }

  def streetScoreToCSVRow(s: StreetScore): String = {
    val coordStr: String = s""""[${s.streetEdge.geom.getCoordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
    s"${s.streetEdge.streetEdgeId},${s.osmId},${s.regionId},${s.score},$coordStr,${s.auditCount},${s.attributes(0)}," +
      s"${s.attributes(1)},${s.attributes(2)},${s.attributes(3)},${s.significance(0)},${s.significance(1)}," +
      s"${s.significance(2)},${s.significance(3)},${s.avgImageCaptureDate.map(_.toString).getOrElse("NA")}," +
      s"${s.avgLabelDate.map(_.toString).getOrElse("NA")}"
  }

  def globalAttributeToJSON(a: GlobalAttributeForApi): JsObject = {
    Json.obj(
      "type"     -> "Feature",
      "geometry" -> Json.obj(
        "type"        -> "Point",
        "coordinates" -> Json.arr(a.lng.toDouble, a.lat.toDouble)
      ),
      "properties" -> Json.obj(
        "attribute_id"           -> a.globalAttributeId,
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

  def globalAttributeToCSVRow(a: GlobalAttributeForApi): String = {
    s"""${a.globalAttributeId},${a.labelType},${a.streetEdgeId},${a.osmStreetId},"${a.neighborhoodName}",""" +
      s"${a.lat},${a.lng},${a.avgImageCaptureDate},${a.avgLabelDate},${a.severity.getOrElse("NA")}," +
      s"""${a.agreeCount},${a.disagreeCount},${a.unsureCount},${a.labelCount},"[${a.usersList.mkString(",")}]""""
  }

  def globalAttributeWithLabelToJSON(l: GlobalAttributeWithLabelForApi): JsObject = {
    Json.obj(
      "type"     -> "Feature",
      "geometry" -> Json.obj(
        "type"        -> "Point",
        "coordinates" -> Json.arr(l.attributeLatLng._2, l.attributeLatLng._1.toDouble)
      ),
      "label_geometry" -> Json.obj(
        "type"        -> "Point",
        "coordinates" -> Json.arr(l.labelLatLng._2.toDouble, l.labelLatLng._1.toDouble)
      ),
      "properties" -> Json.obj(
        "attribute_id"       -> l.globalAttributeId,
        "label_type"         -> l.labelType,
        "street_edge_id"     -> l.streetEdgeId,
        "osm_street_id"      -> l.osmStreetId,
        "neighborhood"       -> l.neighborhoodName,
        "severity"           -> l.attributeSeverity,
        "label_id"           -> l.labelId,
        "gsv_panorama_id"    -> l.gsvPanoramaId,
        "heading"            -> l.pov.heading,
        "pitch"              -> l.pov.pitch,
        "zoom"               -> l.pov.zoom,
        "canvas_x"           -> l.canvasXY.x,
        "canvas_y"           -> l.canvasXY.y,
        "canvas_width"       -> LabelPointTable.canvasWidth,
        "canvas_height"      -> LabelPointTable.canvasHeight,
        "gsv_url"            -> l.gsvUrl,
        "image_capture_date" -> l.imageLabelDates._1,
        "label_date"         -> l.imageLabelDates._2.toString(),
        "label_severity"     -> l.labelSeverity,
        "agree_count"        -> l.agreeDisagreeUnsureCount._1,
        "disagree_count"     -> l.agreeDisagreeUnsureCount._2,
        "unsure_count"       -> l.agreeDisagreeUnsureCount._3,
        "label_tags"         -> l.labelTags,
        "label_description"  -> l.labelDescription,
        "user_id"            -> l.userId
      )
    )
  }

  def globalAttributeWithLabelToCSVRow(l: GlobalAttributeWithLabelForApi): String = {
    s"${l.globalAttributeId},${l.labelType},${l.attributeSeverity.getOrElse("NA")},${l.streetEdgeId}," +
      s"""${l.osmStreetId},"${l.neighborhoodName}",${l.labelId},${l.gsvPanoramaId},${l.attributeLatLng._1},""" +
      s"${l.attributeLatLng._2},${l.labelLatLng._1},${l.labelLatLng._2},${l.pov.heading},${l.pov.pitch}," +
      s"${l.pov.zoom},${l.canvasXY.x},${l.canvasXY.y},${LabelPointTable.canvasWidth},${LabelPointTable.canvasHeight}," +
      s""""${l.gsvUrl}",${l.imageLabelDates._1},${l.imageLabelDates._2},${l.labelSeverity.getOrElse("NA")},""" +
      s"${l.agreeDisagreeUnsureCount._1},${l.agreeDisagreeUnsureCount._2},${l.agreeDisagreeUnsureCount._3}," +
      s""""[${l.labelTags.mkString(",")}]","${l.labelDescription.getOrElse("NA").replace("\"", "\"\"")}",${l.userId}"""
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

  def labelTypeStatToCSVRow(l: LabelTypeStat): String = {
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
