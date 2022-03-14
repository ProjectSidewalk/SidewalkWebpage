package formats.json

import play.api.libs.json.{JsBoolean, JsPath, Reads}

import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object TaskSubmissionFormats {
  case class EnvironmentSubmission(browser: Option[String], browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int], availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int], screenHeight: Option[Int], operatingSystem: Option[String], language: String)
  case class InteractionSubmission(action: String, gsvPanoramaId: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Int], note: Option[String], temporaryLabelId: Option[Int], timestamp: Long)
  case class LabelPointSubmission(svImageX: Int, svImageY: Int, canvasX: Int, canvasY: Int, heading: Float, pitch: Float, zoom: Int, canvasHeight: Int, canvasWidth: Int, alphaX: Float, alphaY: Float, lat: Option[Float], lng: Option[Float], computationMethod: Option[String])
  case class LabelSubmission(gsvPanoramaId: String, auditTaskId: Int, labelType: String, photographerHeading: Float, photographerPitch: Float, panoramaLat: Float, panoramaLng: Float, deleted: JsBoolean, severity: Option[Int], temporaryLabel: Option[JsBoolean], description: Option[String], tagIds: Seq[Int], points: Seq[LabelPointSubmission], temporaryLabelId: Option[Int], timeCreated: Option[Long], tutorial: Boolean)
  case class TaskSubmission(streetEdgeId: Int, taskStart: String, auditTaskId: Option[Int], completed: Option[Boolean], currentLat: Float, currentLng: Float, startPointReversed: Boolean, lastPriorityUpdateTime: Long, requestUpdatedStreetPriority: Boolean)
  case class IncompleteTaskSubmission(issueDescription: String, lat: Float, lng: Float)
  case class GSVLinkSubmission(targetGsvPanoramaId: String, yawDeg: Double, description: String)
  case class GSVPanoramaSubmission(gsvPanoramaId: String, imageDate: String, imageWidth: Int, imageHeight: Int, tileWidth: Int, tileHeight: Int, centerHeading: Option[Float], originHeading: Option[Float], originPitch: Option[Float], links: Seq[GSVLinkSubmission], copyright: String)
  case class AuditMissionProgress(missionId: Int, distanceProgress: Option[Float], completed: Boolean, auditTaskId: Option[Int], skipped: Boolean)
  case class AuditTaskSubmission(missionProgress: AuditMissionProgress, auditTask: TaskSubmission, labels: Seq[LabelSubmission], interactions: Seq[InteractionSubmission], environment: EnvironmentSubmission, incomplete: Option[IncompleteTaskSubmission], gsvPanoramas: Seq[GSVPanoramaSubmission], amtAssignmentId: Option[Int])
  case class AMTAssignmentCompletionSubmission(assignmentId: Int, completed: Option[Boolean])

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
      (JsPath \ "language").read[String]
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
      (JsPath \ "timestamp").read[Long]
    )(InteractionSubmission.apply _)

  implicit val labelPointSubmissionReads: Reads[LabelPointSubmission] = (
    (JsPath \ "sv_image_x").read[Int] and
      (JsPath \ "sv_image_y").read[Int] and
      (JsPath \ "canvas_x").read[Int] and
      (JsPath \ "canvas_y").read[Int] and
      (JsPath \ "heading").read[Float] and
      (JsPath \ "pitch").read[Float] and
      (JsPath \ "zoom").read[Int] and
      (JsPath \ "canvas_height").read[Int] and
      (JsPath \ "canvas_width").read[Int] and
      (JsPath \ "alpha_x").read[Float] and
      (JsPath \ "alpha_y").read[Float] and
      (JsPath \ "lat").readNullable[Float] and
      (JsPath \ "lng").readNullable[Float] and
      (JsPath \ "computation_method").readNullable[String]
    )(LabelPointSubmission.apply _)

  implicit val labelSubmissionReads: Reads[LabelSubmission] = (
    (JsPath \ "gsv_panorama_id").read[String] and
      (JsPath \ "audit_task_id").read[Int] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "photographer_heading").read[Float] and
      (JsPath \ "photographer_pitch").read[Float] and
      (JsPath \ "panorama_lat").read[Float] and
      (JsPath \ "panorama_lng").read[Float] and
      (JsPath \ "deleted").read[JsBoolean] and
      (JsPath \ "severity").readNullable[Int] and
      (JsPath \ "temporary_label").readNullable[JsBoolean] and
      (JsPath \ "description").readNullable[String] and
      (JsPath \ "tag_ids").read[Seq[Int]] and
      (JsPath \ "label_points").read[Seq[LabelPointSubmission]] and
      (JsPath \ "temporary_label_id").readNullable[Int] and
      (JsPath \ "time_created").readNullable[Long] and
      (JsPath \ "tutorial").read[Boolean]
    )(LabelSubmission.apply _)

  implicit val auditTaskReads: Reads[TaskSubmission] = (
    (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "task_start").read[String] and
      (JsPath \ "audit_task_id").readNullable[Int] and
      (JsPath \ "completed").readNullable[Boolean] and
      (JsPath \ "current_lat").read[Float] and
      (JsPath \ "current_lng").read[Float] and
      (JsPath \ "start_point_reversed").read[Boolean] and
      (JsPath \ "last_priority_update_time").read[Long] and
      (JsPath \ "request_updated_street_priority").read[Boolean]
    )(TaskSubmission.apply _)

  implicit val gsvLinkSubmissionReads: Reads[GSVLinkSubmission] = (
    (JsPath \ "target_gsv_panorama_id").read[String] and
      (JsPath \ "yaw_deg").read[Double] and
      (JsPath \ "description").read[String]
    )(GSVLinkSubmission.apply _)

  implicit val gsvPanoramaSubmissionReads: Reads[GSVPanoramaSubmission] = (
    (JsPath \ "panorama_id").read[String] and
      (JsPath \ "image_date").read[String] and
      (JsPath \ "image_width").read[Int] and
      (JsPath \ "image_height").read[Int] and
      (JsPath \ "tile_width").read[Int] and
      (JsPath \ "tile_height").read[Int] and
      (JsPath \ "center_heading").readNullable[Float] and
      (JsPath \ "origin_heading").readNullable[Float] and
      (JsPath \ "origin_pitch").readNullable[Float] and
      (JsPath \ "links").read[Seq[GSVLinkSubmission]] and
      (JsPath \ "copyright").read[String]
    )(GSVPanoramaSubmission.apply _)

  implicit val auditMissionProgressReads: Reads[AuditMissionProgress] = (
    (JsPath \ "mission_id").read[Int] and
      (JsPath \ "distance_progress").readNullable[Float] and
      (JsPath \ "completed").read[Boolean] and
      (JsPath \ "audit_task_id").read[Option[Int]] and
      (JsPath \ "skipped").read[Boolean]
  )(AuditMissionProgress.apply _)

  implicit val auditTaskSubmissionReads: Reads[AuditTaskSubmission] = (
    (JsPath \ "mission").read[AuditMissionProgress] and
      (JsPath \ "audit_task").read[TaskSubmission] and
      (JsPath \ "labels").read[Seq[LabelSubmission]] and
      (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "incomplete").readNullable[IncompleteTaskSubmission] and
      (JsPath \ "gsv_panoramas").read[Seq[GSVPanoramaSubmission]] and
      (JsPath \ "amt_assignment_id").readNullable[Int]
    )(AuditTaskSubmission.apply _)

  implicit val amtAssignmentCompletionReads: Reads[AMTAssignmentCompletionSubmission] = (
    (JsPath \ "amt_assignment_id").read[Int] and
      (JsPath \ "completed").readNullable[Boolean]
    )(AMTAssignmentCompletionSubmission.apply _)
}
