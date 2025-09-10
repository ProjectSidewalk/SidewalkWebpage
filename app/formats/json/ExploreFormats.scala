package formats.json

import formats.json.PanoHistoryFormats.PanoDate
import models.audit.{AuditTask, AuditTaskInteraction, NewTask}
import models.street.StreetEdgePriority
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Point}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import service.UpdatedStreets

import java.time.OffsetDateTime

object ExploreFormats {
  case class EnvironmentSubmission(
      browser: Option[String],
      browserVersion: Option[String],
      browserWidth: Option[Int],
      browserHeight: Option[Int],
      availWidth: Option[Int],
      availHeight: Option[Int],
      screenWidth: Option[Int],
      screenHeight: Option[Int],
      operatingSystem: Option[String],
      language: String,
      cssZoom: Int
  )
  case class InteractionSubmission(
      action: String,
      gsvPanoramaId: Option[String],
      lat: Option[Float],
      lng: Option[Float],
      heading: Option[Float],
      pitch: Option[Float],
      zoom: Option[Int],
      note: Option[String],
      temporaryLabelId: Option[Int],
      timestamp: OffsetDateTime
  )
  case class LabelPointSubmission(
      panoX: Int,
      panoY: Int,
      canvasX: Int,
      canvasY: Int,
      heading: Float,
      pitch: Float,
      zoom: Int,
      lat: Option[Float],
      lng: Option[Float],
      computationMethod: Option[String]
  )
  case class LabelSubmission(
      gsvPanoramaId: String,
      auditTaskId: Int,
      labelType: String,
      deleted: Boolean,
      severity: Option[Int],
      description: Option[String],
      tagIds: Seq[Int],
      point: LabelPointSubmission,
      temporaryLabelId: Int,
      timeCreated: Option[OffsetDateTime],
      tutorial: Boolean
  )
  case class TaskSubmission(
      streetEdgeId: Int,
      taskStart: OffsetDateTime,
      auditTaskId: Option[Int],
      completed: Option[Boolean],
      currentLat: Float,
      currentLng: Float,
      startPointReversed: Boolean,
      currentMissionStart: Option[Point],
      lastPriorityUpdateTime: OffsetDateTime,
      requestUpdatedStreetPriority: Boolean
  )
  case class IncompleteTaskSubmission(issueDescription: String, lat: Float, lng: Float)
  case class GsvLinkSubmission(targetGsvPanoramaId: String, yawDeg: Double, description: String)
  case class GsvPanoramaSubmission(
      gsvPanoramaId: String,
      captureDate: String,
      width: Option[Int],
      height: Option[Int],
      tileWidth: Option[Int],
      tileHeight: Option[Int],
      lat: Option[Float],
      lng: Option[Float],
      cameraHeading: Option[Float],
      cameraPitch: Option[Float],
      links: Seq[GsvLinkSubmission],
      copyright: String,
      history: Seq[PanoDate]
  )
  case class AuditMissionProgress(
      missionId: Int,
      distanceProgress: Option[Float],
      regionId: Int,
      completed: Boolean,
      auditTaskId: Option[Int],
      skipped: Boolean
  )
  case class AuditTaskSubmission(
      missionProgress: AuditMissionProgress,
      auditTask: TaskSubmission,
      labels: Seq[LabelSubmission],
      interactions: Seq[InteractionSubmission],
      environment: EnvironmentSubmission,
      incomplete: Option[IncompleteTaskSubmission],
      gsvPanoramas: Seq[GsvPanoramaSubmission],
      userRouteId: Option[Int],
      timestamp: OffsetDateTime
  )
  case class SurveySingleSubmission(surveyQuestionId: String, answerText: String)

  case class AiLabelSubmission(
      labelType: String,
      panoX: Int,
      panoY: Int,
      confidence: Double,
      modelId: String,
      modelTrainingDate: String,
      apiVersion: String,
      pano: GsvPanoramaSubmission
  )

  implicit val pointWrites: Writes[Point] = Writes { point =>
    Json.obj(
      "lat" -> point.getX,
      "lng" -> point.getY
    )
  }

  implicit val auditTaskWrites: Writes[AuditTask] = (
    (__ \ "audit_task_id").write[Int] and
      (__ \ "amt_assignment_id").writeNullable[Int] and
      (__ \ "user_id").write[String] and
      (__ \ "street_edge_id").write[Int] and
      (__ \ "task_start").write[OffsetDateTime] and
      (__ \ "task_end").write[OffsetDateTime] and
      (__ \ "completed").write[Boolean] and
      (__ \ "current_lat").write[Float] and
      (__ \ "current_lng").write[Float] and
      (__ \ "start_point_reversed").write[Boolean] and
      (__ \ "current_mission_id").writeNullable[Int] and
      (__ \ "current_mission_start").writeNullable[Point] and
      (__ \ "low_quality").write[Boolean] and
      (__ \ "incomplete").write[Boolean] and
      (__ \ "stale").write[Boolean]
  )(unlift(AuditTask.unapply))

  implicit val auditTaskInteractionWrites: Writes[AuditTaskInteraction] = (
    (__ \ "audit_task_interaction_id").write[Long] and
      (__ \ "audit_task_id").write[Int] and
      (__ \ "mission_id").write[Int] and
      (__ \ "action").write[String] and
      (__ \ "gsv_panorama_id").writeNullable[String] and
      (__ \ "lat").writeNullable[Float] and
      (__ \ "lng").writeNullable[Float] and
      (__ \ "heading").writeNullable[Float] and
      (__ \ "pitch").writeNullable[Float] and
      (__ \ "zoom").writeNullable[Int] and
      (__ \ "note").writeNullable[String] and
      (__ \ "temporary_label_id").writeNullable[Int] and
      (__ \ "timestamp").write[OffsetDateTime]
  )(unlift(AuditTaskInteraction.unapply))

  implicit val newTaskWrites: Writes[NewTask] = (task: NewTask) => {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> task.geom,
      "properties" -> Json.obj(
        "street_edge_id"        -> task.edgeId,
        "current_lng"           -> task.currentLng,
        "current_lat"           -> task.currentLat,
        "way_type"              -> task.wayType,
        "start_point_reversed"  -> task.startPointReversed,
        "task_start"            -> task.taskStart.toString,
        "completed_by_any_user" -> task.completedByAnyUser,
        "priority"              -> task.priority,
        "completed"             -> task.completed,
        "audit_task_id"         -> task.auditTaskId,
        "current_mission_id"    -> task.currentMissionId,
        "current_mission_start" -> task.currentMissionStart, // TODO test that this looks right on the front end.
        // "current_mission_start" -> currentMissionStart.map(p => geojson.LatLng(p.getY, p.getX)),
        "route_street_id" -> task.routeStreetId
      )
    )
  }

  implicit val streetEdgePriorityWrites: Writes[StreetEdgePriority] = (streetPriority: StreetEdgePriority) => {
    Json.obj(
      "street_edge_id" -> streetPriority.streetEdgeId,
      "priority"       -> streetPriority.priority
    )
  }

  implicit val updatedStreetsWrites: Writes[UpdatedStreets] = (
    (__ \ "last_priority_update_time").write[OffsetDateTime] and
      (__ \ "updated_street_priorities").write[Seq[StreetEdgePriority]]
  )(unlift(UpdatedStreets.unapply))

  implicit val pointReads: Reads[Point] = (
    (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double]
  )((lat, lng) => new GeometryFactory().createPoint(new Coordinate(lat, lng)))

  implicit val incompleteTaskSubmissionReads: Reads[IncompleteTaskSubmission] = (
    (JsPath \ "issue_description").read[String] and
      (JsPath \ "lat").read[Float] and
      (JsPath \ "lng").read[Float]
  )(IncompleteTaskSubmission.apply _)

  implicit val environmentSubmissionReads: Reads[EnvironmentSubmission] = (
    (JsPath \ "browser").readNullable[String] and
      (JsPath \ "browser_version").readNullable[String] and
      (JsPath \ "browser_width").readNullable[Int] and
      (JsPath \ "browser_height").readNullable[Int] and
      (JsPath \ "avail_width").readNullable[Int] and
      (JsPath \ "avail_height").readNullable[Int] and
      (JsPath \ "screen_width").readNullable[Int] and
      (JsPath \ "screen_height").readNullable[Int] and
      (JsPath \ "operating_system").readNullable[String] and
      (JsPath \ "language").read[String] and
      (JsPath \ "css_zoom").read[Int]
  )(EnvironmentSubmission.apply _)

  implicit val interactionSubmissionReads: Reads[InteractionSubmission] = (
    (JsPath \ "action").read[String] and
      (JsPath \ "gsv_panorama_id").readNullable[String] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "heading").readNullable[Float] and
      (JsPath \ "pitch").readNullable[Float] and
      (JsPath \ "zoom").readNullable[Int] and
      (JsPath \ "note").readNullable[String] and
      (JsPath \ "temporary_label_id").readNullable[Int] and
      (JsPath \ "timestamp").read[OffsetDateTime]
  )(InteractionSubmission.apply _)

  implicit val labelPointSubmissionReads: Reads[LabelPointSubmission] = (
    (JsPath \ "pano_x").read[Int] and
      (JsPath \ "pano_y").read[Int] and
      (JsPath \ "canvas_x").read[Int] and
      (JsPath \ "canvas_y").read[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Int] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "computation_method").readNullable[String]
  )(LabelPointSubmission.apply _)

  implicit val labelSubmissionReads: Reads[LabelSubmission] = (
    (JsPath \ "gsv_panorama_id").read[String] and
      (JsPath \ "audit_task_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "deleted").read[Boolean] and
      (JsPath \ "severity").readNullable[Int] and
      (JsPath \ "description").readNullable[String] and
      (JsPath \ "tag_ids").read[Seq[Int]] and
      (JsPath \ "label_point").read[LabelPointSubmission] and
      (JsPath \ "temporary_label_id").read[Int] and
      (JsPath \ "time_created").readNullable[OffsetDateTime] and
      (JsPath \ "tutorial").read[Boolean]
  )(LabelSubmission.apply _)

  implicit val auditTaskReads: Reads[TaskSubmission] = (
    (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "task_start").read[OffsetDateTime] and
      (JsPath \ "audit_task_id").readNullable[Int] and
      (JsPath \ "completed").readNullable[Boolean] and
      (JsPath \ "current_lat").read[Float] and
      (JsPath \ "current_lng").read[Float] and
      (JsPath \ "start_point_reversed").read[Boolean] and
      (JsPath \ "current_mission_start").readNullable[Point] and
      (JsPath \ "last_priority_update_time").read[OffsetDateTime] and
      (JsPath \ "request_updated_street_priority").read[Boolean]
  )(TaskSubmission.apply _)

  implicit val gsvLinkSubmissionReads: Reads[GsvLinkSubmission] = (
    (JsPath \ "target_gsv_panorama_id").read[String] and
      (JsPath \ "yaw_deg").read[Double] and
      (JsPath \ "description").read[String]
  )(GsvLinkSubmission.apply _)

  implicit val gsvPanoramaSubmissionReads: Reads[GsvPanoramaSubmission] = (
    (JsPath \ "panorama_id").read[String] and
      (JsPath \ "capture_date").read[String] and
      (JsPath \ "width").readNullable[Int] and
      (JsPath \ "height").readNullable[Int] and
      (JsPath \ "tile_width").readNullable[Int] and
      (JsPath \ "tile_height").readNullable[Int] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "camera_heading").readNullable[Float] and
      (JsPath \ "camera_pitch").readNullable[Float] and
      (JsPath \ "links").read[Seq[GsvLinkSubmission]] and
      (JsPath \ "copyright").read[String] and
      (JsPath \ "history").read[Seq[PanoDate]]
  )(GsvPanoramaSubmission.apply _)

  implicit val auditMissionProgressReads: Reads[AuditMissionProgress] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "distance_progress").readNullable[Float] and
      (JsPath \ "region_id").read[Int] and
      (JsPath \ "completed").read[Boolean] and
      (JsPath \ "audit_task_id").readNullable[Int] and
      (JsPath \ "skipped").read[Boolean]
  )(AuditMissionProgress.apply _)

  implicit val auditTaskSubmissionReads: Reads[AuditTaskSubmission] = (
    (JsPath \ "mission").read[AuditMissionProgress] and
      (JsPath \ "audit_task").read[TaskSubmission] and
      (JsPath \ "labels").read[Seq[LabelSubmission]] and
      (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "incomplete").readNullable[IncompleteTaskSubmission] and
      (JsPath \ "gsv_panoramas").read[Seq[GsvPanoramaSubmission]] and
      (JsPath \ "user_route_id").readNullable[Int] and
      (JsPath \ "timestamp").read[OffsetDateTime]
  )(AuditTaskSubmission.apply _)

  implicit val surveySingleSubmissionReads: Reads[SurveySingleSubmission] = (
    (JsPath \ "name").read[String] and
      (JsPath \ "value").read[String]
  )(SurveySingleSubmission.apply _)

  implicit val aiLabelSubmissionReads: Reads[AiLabelSubmission] = (
    (JsPath \ "label_type").read[String] and
      (JsPath \ "pano_x").read[Int] and
      (JsPath \ "pano_y").read[Int] and
      (JsPath \ "confidence").read[Double] and
      (JsPath \ "model_id").read[String] and
      (JsPath \ "model_training_date").read[String] and
      (JsPath \ "api_version").read[String] and
      (JsPath \ "pano").read[GsvPanoramaSubmission]
  )(AiLabelSubmission.apply _)
}
