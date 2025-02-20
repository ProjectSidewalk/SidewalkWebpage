package formats.json

import org.locationtech.jts.geom.Coordinate
//import controllers.{AccessScoreStreet, NeighborhoodAttributeSignificance}
import models.attribute.GlobalAttributeForAPI
import models.label.{LabelAccuracy, LabelPointTable, LabelSeverityStats, LabelValidationTable, ProjectSidewalkStats}
//import models.region.RegionTable.MultiPolygonUtils
//import models.user.{LabelTypeStat, UserStatAPI}
import play.api.libs.functional.syntax._
import play.api.libs.json._
//import play.extras.geojson
//import play.extras.geojson.{LatLng => JsonLatLng, LineString => JsonLineString, MultiPolygon => JsonMultiPolygon, Point => JsonPoint}
import formats.json.UserFormats._
//import models.label.LabelTable.LabelAllMetadata

object APIFormats {
//  implicit val labelSeverityStatsWrites: Writes[LabelSeverityStats] = (
//    (__ \ "count").write[Int] and
//      (__ \ "count_with_severity").write[Int] and
//        (__ \ "severity_mean").writeNullable[Float] and
//        (__ \ "severity_sd").writeNullable[Float]
//  )(unlift(LabelSeverityStats.unapply))

//  implicit val labelAccuracyWrites: Writes[LabelAccuracy] = (
//    (__ \ "validated").write[Int] and
//      (__ \ "agreed").write[Int] and
//      (__ \ "disagreed").write[Int] and
//      (__ \ "accuracy").writeNullable[Float]
//    ) (unlift(LabelAccuracy.unapply))

//  def neighborhoodAttributeSignificanceToJson(n: NeighborhoodAttributeSignificance): JsObject = {
//    if (n.coverage > 0.0D) {
//      val properties: JsObject = Json.obj(
//        "coverage" -> n.coverage,
//        "neighborhood_id" -> n.regionID,
//        "neighborhood_name" -> n.name,
//        "score" -> n.score,
//        "significance" -> Json.obj(
//          "CurbRamp" -> n.significanceScores(0),
//          "NoCurbRamp" -> n.significanceScores(1),
//          "Obstacle" -> n.significanceScores(2),
//          "SurfaceProblem" -> n.significanceScores(3)
//        ),
//        "avg_attribute_count" -> Json.obj(
//          "CurbRamp" -> n.attributeScores(0),
//          "NoCurbRamp" -> n.attributeScores(1),
//          "Obstacle" -> n.attributeScores(2),
//          "SurfaceProblem" -> n.attributeScores(3)
//        ),
//        "avg_image_capture_date" -> n.avgImageCaptureDate.map(_.toString),
//        "avg_label_date" -> n.avgLabelDate.map(_.toString)
//      )
//      Json.obj("type" -> "Feature", "geometry" -> n.geom.toJSON, "properties" -> properties)
//    } else {
//      val properties: JsObject = Json.obj(
//        "coverage" -> 0.0,
//        "neighborhood_id" -> n.regionID,
//        "neighborhood_name" -> n.name,
//        "score" -> None.asInstanceOf[Option[Double]],
//        "significance" -> Json.obj(
//          "CurbRamp" -> 0.75,
//          "NoCurbRamp" -> -1.0,
//          "Obstacle" -> -1.0,
//          "SurfaceProblem" -> -1.0
//        ),
//        "avg_attribute_count" -> None.asInstanceOf[Option[Array[Double]]],
//        "avg_image_capture_date" -> None.asInstanceOf[Option[Timestamp]],
//        "avg_label_date" -> None.asInstanceOf[Option[Timestamp]]
//      )
//      Json.obj("type" -> "Feature", "geometry" -> n.geom.toJSON, "properties" -> properties)
//    }
//  }

//  def neighborhoodAttributeSignificanceToCSVRow(n: NeighborhoodAttributeSignificance): String = {
//    val coordinates: Array[Coordinate] = n.geom.getCoordinates
//    val coordStr: String = s""""[${coordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
//    if (n.coverage > 0.0D) {
//      s""""${n.name}",${n.regionID},${n.score},$n.coordStr,${n.coverage},${n.attributeScores(0)},""" +
//        s"${n.attributeScores(1)},${n.attributeScores(2)},${n.attributeScores(3)},${n.significanceScores(0)}," +
//        s"${n.significanceScores(1)},${n.significanceScores(2)},${n.significanceScores(3)}," +
//        s"${n.avgImageCaptureDate.map(_.toString).getOrElse("NA")},${n.avgLabelDate.map(_.toString).getOrElse("NA")}"
//    } else {
//      s""""${n.name}",${n.regionID},NA,$coordStr,0.0,NA,NA,NA,NA,${n.significanceScores(0)},""" +
//        s"${n.significanceScores(1)},${n.significanceScores(2)},${n.significanceScores(3)},NA,NA"
//    }
//  }

//  def accessScoreStreetToJSON(s: AccessScoreStreet): JsObject = {
//    val latlngs: List[JsonLatLng] = s.streetEdge.geom.getCoordinates.map(coord => JsonLatLng(coord.y, coord.x)).toList
//    val linestring: JsonLineString[JsonLatLng] = JsonLineString(latlngs)
//    val properties = Json.obj(
//      "street_edge_id" -> s.streetEdge.streetEdgeId,
//      "osm_id" -> s.osmId,
//      "neighborhood_id" -> s.regionId,
//      "score" -> s.score,
//      "audit_count" -> s.auditCount,
//      "avg_image_capture_date" -> s.avgImageCaptureDate.map(_.toString),
//      "avg_label_date" -> s.avgLabelDate.map(_.toString),
//      "significance" -> Json.obj(
//        "CurbRamp" -> s.significance(0),
//        "NoCurbRamp" -> s.significance(1),
//        "Obstacle" -> s.significance(2),
//        "SurfaceProblem" -> s.significance(3)
//      ),
//      "attribute_count" -> Json.obj(
//        "CurbRamp" -> s.attributes(0),
//        "NoCurbRamp" -> s.attributes(1),
//        "Obstacle" -> s.attributes(2),
//        "SurfaceProblem" -> s.attributes(3)
//      )
//    )
//    Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
//  }

//  def accessScoreStreetToCSVRow(s: AccessScoreStreet): String = {
//    val coordStr: String = s""""[${s.streetEdge.geom.getCoordinates.map(c => s"(${c.x},${c.y})").mkString(",")}]""""
//    s"${s.streetEdge.streetEdgeId},${s.osmId},${s.regionId},${s.score},$coordStr,${s.auditCount},${s.attributes(0)}," +
//      s"${s.attributes(1)},${s.attributes(2)},${s.attributes(3)},${s.significance(0)},${s.significance(1)}," +
//      s"${s.significance(2)},${s.significance(3)},${s.avgImageCaptureDate.map(_.toString).getOrElse("NA")}," +
//      s"${s.avgLabelDate.map(_.toString).getOrElse("NA")}"
//  }

  def globalAttributeToJSON(a: GlobalAttributeForAPI): JsObject = {
    Json.obj(
      "type" -> "Feature",
//      "geometry" -> geojson.Point(geojson.LatLng(a.lat.toDouble, a.lng.toDouble)),
      "geometry" -> Json.obj(
        "type" -> "Point",
        "coordinates" -> Json.arr(a.lng.toDouble, a.lat.toDouble)
      ),
      "properties" -> Json.obj(
        "attribute_id" -> a.globalAttributeId,
        "label_type" -> a.labelType,
        "street_edge_id" -> a.streetEdgeId,
        "osm_street_id" -> a.osmStreetId,
        "neighborhood" -> a.neighborhoodName,
        "avg_image_capture_date" -> a.avgImageCaptureDate.toString(),
        "avg_label_date" -> a.avgLabelDate.toString(),
        "severity" -> a.severity,
        "is_temporary" -> a.temporary,
        "agree_count" -> a.agreeCount,
        "disagree_count" -> a.disagreeCount,
        "unsure_count" -> a.unsureCount,
        "cluster_size" -> a.labelCount,
        "users" -> a.usersList
      )
    )
  }

  def globalAttributeToCSVRow(a: GlobalAttributeForAPI): String = {
    s"""${a.globalAttributeId},${a.labelType},${a.streetEdgeId},${a.osmStreetId},"${a.neighborhoodName}",""" +
      s"${a.lat},${a.lng},${a.avgImageCaptureDate},${a.avgLabelDate},${a.severity.getOrElse("NA")},${a.temporary}," +
      s"""${a.agreeCount},${a.disagreeCount},${a.unsureCount},${a.labelCount},"[${a.usersList.mkString(",")}]""""
  }

//  def globalAttributeWithLabelToJSON(l: GlobalAttributeWithLabelForAPI): JsObject = {
//    Json.obj(
//      "type" -> "Feature",
//      "geometry" -> geojson.Point(geojson.LatLng(l.attributeLatLng._1.toDouble, l.attributeLatLng._2.toDouble)),
//      "label_geometry" -> geojson.Point(geojson.LatLng(l.labelLatLng._1.toDouble, l.labelLatLng._2.toDouble)),
//      "properties" -> Json.obj(
//        "attribute_id" -> l.globalAttributeId,
//        "label_type" -> l.labelType,
//        "street_edge_id" -> l.streetEdgeId,
//        "osm_street_id" -> l.osmStreetId,
//        "neighborhood" -> l.neighborhoodName,
//        "severity" -> l.attributeSeverity,
//        "is_temporary" -> l.attributeTemporary,
//        "label_id" -> l.labelId,
//        "gsv_panorama_id" -> l.gsvPanoramaId,
//        "heading" -> l.pov.heading,
//        "pitch" -> l.pov.pitch,
//        "zoom" -> l.pov.zoom,
//        "canvas_x" -> l.canvasXY.x,
//        "canvas_y" -> l.canvasXY.y,
//        "canvas_width" -> LabelPointTable.canvasWidth,
//        "canvas_height" -> LabelPointTable.canvasHeight,
//        "gsv_url" -> l.gsvUrl,
//        "image_capture_date" -> l.imageLabelDates._1,
//        "label_date" -> l.imageLabelDates._2.toString(),
//        "label_severity" -> l.labelSeverity,
//        "label_is_temporary" -> l.labelTemporary,
//        "agree_count" -> l.agreeDisagreeUnsureCount._1,
//        "disagree_count" -> l.agreeDisagreeUnsureCount._2,
//        "unsure_count" -> l.agreeDisagreeUnsureCount._3,
//        "label_tags" -> l.labelTags,
//        "label_description" -> l.labelDescription,
//        "user_id" -> l.userId
//      )
//    )
//  }

//  def globalAttributeWithLabelToCSVRow(l: GlobalAttributeWithLabelForAPI): String = {
//    s"${l.globalAttributeId},${l.labelType},${l.attributeSeverity.getOrElse("NA")},${l.attributeTemporary}," +
//      s"""${l.streetEdgeId},${l.osmStreetId},"${l.neighborhoodName}",${l.labelId},${l.gsvPanoramaId},""" +
//      s"${l.attributeLatLng._1},${l.attributeLatLng._2},${l.labelLatLng._1},${l.labelLatLng._2}," +
//      s"${l.pov.heading},${l.pov.pitch},${l.pov.zoom},${l.canvasXY.x},${l.canvasXY.y}," +
//      s"""${LabelPointTable.canvasWidth},${LabelPointTable.canvasHeight},"${l.gsvUrl}",${l.imageLabelDates._1},""" +
//      s"${l.imageLabelDates._2},${l.labelSeverity.getOrElse("NA")},${l.labelTemporary}," +
//      s"${l.agreeDisagreeUnsureCount._1},${l.agreeDisagreeUnsureCount._2},${l.agreeDisagreeUnsureCount._3}," +
//      s""""[${l.labelTags.mkString(",")}]","${l.labelDescription.getOrElse("NA").replace("\"", "\"\"")}",${l.userId}"""
//  }

//  def rawLabelMetadataToJSON(l: LabelAllMetadata): JsObject = {
//    Json.obj(
//      "type" -> "Feature",
//      "geometry" -> geojson.Point(l.geom),
//      "properties" -> Json.obj(
//        "label_id" -> l.labelId,
//        "user_id" -> l.userId,
//        "gsv_panorama_id" -> l.panoId,
//        "label_type" -> l.labelType,
//        "severity" -> l.severity,
//        "tags" -> l.tags,
//        "temporary" -> l.temporary,
//        "description" -> l.description,
//        "time_created" -> l.timeCreated,
//        "street_edge_id" -> l.streetEdgeId,
//        "osm_street_id" -> l.osmStreetId,
//        "neighborhood" -> l.neighborhoodName,
//        "correct" -> l.validationInfo.correct,
//        "agree_count" -> l.validationInfo.agreeCount,
//        "disagree_count" -> l.validationInfo.disagreeCount,
//        "unsure_count" -> l.validationInfo.unsureCount,
//        "validations" -> l.validations.map(v => Json.obj(
//          "user_id" -> v._1,
//          "validation" -> LabelValidationTable.validationOptions.get(v._2)
//        )),
//        "audit_task_id" -> l.auditTaskId,
//        "mission_id" -> l.missionId,
//        "image_capture_date" -> l.imageCaptureDate,
//        "heading" -> l.pov.heading,
//        "pitch" -> l.pov.pitch,
//        "zoom" -> l.pov.zoom,
//        "canvas_x" -> l.canvasXY.x,
//        "canvas_y" -> l.canvasXY.y,
//        "canvas_width" -> LabelPointTable.canvasWidth,
//        "canvas_height" -> LabelPointTable.canvasHeight,
//        "gsv_url" -> l.gsvUrl,
//        "pano_x" -> l.panoLocation._1.x,
//        "pano_y" -> l.panoLocation._1.y,
//        "pano_width" -> l.panoLocation._2.map(_.width),
//        "pano_height" -> l.panoLocation._2.map(_.height),
//        "camera_heading" -> l.cameraHeadingPitch._1,
//        "camera_pitch" -> l.cameraHeadingPitch._2
//      ))
//  }

//  def rawLabelMetadataToCSVRow(l: LabelAllMetadata): String = {
//    s"${l.labelId},${l.geom.lat},${l.geom.lng},${l.userId},${l.panoId},${l.labelType},${l.severity.getOrElse("NA")}," +
//      s""""[${l.tags.mkString(",")}]",${l.temporary},"${l.description.getOrElse("NA").replace("\"", "\"\"")}",""" +
//      s"${l.timeCreated},${l.streetEdgeId},${l.osmStreetId},${l.neighborhoodName},${l.validationInfo.correct.getOrElse("NA")}," +
//      s"${l.validationInfo.agreeCount},${l.validationInfo.disagreeCount},${l.validationInfo.unsureCount}," +
//      s""""[${l.validations.map(v => s"{user_id: ${v._1}, validation: ${LabelValidationTable.validationOptions(v._2)}")}]",""" +
//      s"${l.auditTaskId},${l.missionId},${l.imageCaptureDate},${l.pov.heading},${l.pov.pitch},${l.pov.zoom}," +
//      s"${l.canvasXY.x},${l.canvasXY.y},${LabelPointTable.canvasWidth},${LabelPointTable.canvasHeight}," +
//      s""""${l.gsvUrl}",${l.panoLocation._1.x},${l.panoLocation._1.y},""" +
//      s"${l.panoLocation._2.map(_.width).getOrElse("NA")},${l.panoLocation._2.map(_.height).getOrElse("NA")}," +
//      s"${l.cameraHeadingPitch._1},${l.cameraHeadingPitch._2}"
//  }

//  def projectSidewalkStatsToJson(stats: ProjectSidewalkStats): JsObject = {
//    Json.obj(
//      "launch_date" -> stats.launchDate,
//      "avg_timestamp_last_100_labels" -> stats.avgTimestampLast100Labels,
//      "km_explored" -> stats.kmExplored,
//      "km_explored_no_overlap" -> stats.kmExploreNoOverlap,
//      "user_counts" -> Json.obj(
//        "all_users" -> stats.nUsers,
//        "labelers" -> stats.nExplorers,
//        "validators" -> stats.nValidators,
//        "registered" -> stats.nRegistered,
//        "anonymous" -> stats.nAnon,
//        "turker" -> stats.nTurker,
//        "researcher" -> stats.nResearcher
//      ),
//      "labels" -> JsObject(
//        Seq(("label_count", JsNumber(stats.nLabels.toDouble))) ++
//          // Turns into { "CurbRamp" -> { "count" -> ###, ... }, ... }.
//          stats.severityByLabelType.map { case (labType, sevStats) => labType -> Json.toJson(sevStats) }
//      ),
//      "validations" -> JsObject(
//        Seq("total_validations" -> JsNumber(stats.nValidations.toDouble)) ++
//          // Turns into { "Overall" -> { "validated" -> ###, ... }, "CurbRamp" -> { "validated" -> ###, ... }, ... }.
//        stats.accuracyByLabelType.map { case (labType, accStats) => labType -> Json.toJson(accStats) }
//      )
//    )
//  }

//  def userStatToJson(u: UserStatAPI): JsObject = {
//    Json.obj(
//      "user_id" -> u.userId,
//      "labels" -> u.labels,
//      "meters_explored" -> u.metersExplored,
//      "labels_per_meter" -> u.labelsPerMeter,
//      "high_quality" -> u.highQuality,
//      "high_quality_manual" -> u.highQualityManual,
//      "label_accuracy" -> u.labelAccuracy,
//      "validated_labels" -> u.validatedLabels,
//      "validations_received" -> u.validationsReceived,
//      "labels_validated_correct" -> u.labelsValidatedCorrect,
//      "labels_validated_incorrect" -> u.labelsValidatedIncorrect,
//      "labels_not_validated" -> u.labelsNotValidated,
//      "validations_given" -> u.validationsGiven,
//      "dissenting_validations_given" -> u.dissentingValidationsGiven,
//      "agree_validations_given" -> u.agreeValidationsGiven,
//      "disagree_validations_given" -> u.disagreeValidationsGiven,
//      "unsure_validations_given" -> u.unsureValidationsGiven,
//      "stats_by_label_type" -> Json.obj(
//        "curb_ramp" -> Json.toJson(u.statsByLabelType("CurbRamp")),
//        "no_curb_ramp" -> Json.toJson(u.statsByLabelType("NoCurbRamp")),
//        "obstacle" -> Json.toJson(u.statsByLabelType("Obstacle")),
//        "surface_problem" -> Json.toJson(u.statsByLabelType("SurfaceProblem")),
//        "no_sidewalk" -> Json.toJson(u.statsByLabelType("NoSidewalk")),
//        "crosswalk" -> Json.toJson(u.statsByLabelType("Crosswalk")),
//        "pedestrian_signal" -> Json.toJson(u.statsByLabelType("Signal")),
//        "cant_see_sidewalk" -> Json.toJson(u.statsByLabelType("Occlusion")),
//        "other" -> Json.toJson(u.statsByLabelType("Other"))
//      )
//    )
//  }

//  def userStatToCSVRow(s: UserStatAPI): String = {
//    s"${s.userId},${s.labels},${s.metersExplored},${s.labelsPerMeter.getOrElse("NA")},${s.highQuality}," +
//      s"${s.highQualityManual.getOrElse("NA")},${s.labelAccuracy.getOrElse("NA")},${s.validatedLabels}," +
//      s"${s.validationsReceived},${s.labelsValidatedCorrect},${s.labelsValidatedIncorrect},${s.labelsNotValidated}," +
//      s"${s.validationsGiven},${s.dissentingValidationsGiven},${s.agreeValidationsGiven},${s.disagreeValidationsGiven}," +
//      s"${s.unsureValidationsGiven},${labelTypeStatToCSVRow(s.statsByLabelType("CurbRamp"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("NoCurbRamp"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("Obstacle"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("SurfaceProblem"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("NoSidewalk"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("Crosswalk"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("Signal"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("Occlusion"))}," +
//      s"${labelTypeStatToCSVRow(s.statsByLabelType("Other"))}"
//  }

//  def labelTypeStatToCSVRow(l: LabelTypeStat): String = {
//    s"${l.labels},${l.validatedCorrect},${l.validatedIncorrect},${l.notValidated}"
//  }
}
