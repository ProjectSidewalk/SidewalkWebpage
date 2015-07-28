package formats.json

import play.api.libs.json.{JsBoolean, JsPath, Reads}
import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._

object TaskSubmissionFormats {
  case class EnvironmentSubmission(browser: Option[String], browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                  availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int], screenHeight: Option[Int], operatingSystem: Option[String])

  case class InteractionSubmission(action: String, gsv_panorama_id: Option[String], lat: Option[Float], lng: Option[Float], heading: Option[Float], pitch: Option[Float], zoom: Option[Int], note: Option[String], timestamp: String)
  case class LabelPointSubmission(svImageX: Int, svImageY: Int, canvasX: Int, canvasY: Int, heading: Float, pitch: Float, zoom: Int, canvasHeight: Int, canvasWidth: Int, alphaX: Float, alphaY: Float, lat: Option[Float], lng: Option[Float])
  case class LabelSubmission(gsvPanoramaId: String, labelType: String, photographerHeading: Float, photographerPitch: Float, deleted: JsBoolean, points: Seq[LabelPointSubmission])
  case class TaskSubmission(streetEdgeId: Int, taskStart: String)
  case class AMTAssignmentSubmission(hitId: String, assignmentId: String, assignmentStart: String)
  case class AuditTaskSubmission(assignment: Option[AMTAssignmentSubmission], auditTask: TaskSubmission, labels: Seq[LabelSubmission], interactions: Seq[InteractionSubmission], environment: EnvironmentSubmission)

  implicit val environmentSubmissionReads: Reads[EnvironmentSubmission] = (
    (JsPath \ "browser").readNullable[String] and
      (JsPath \ "browser_version").readNullable[String] and
      (JsPath \ "browser_width").readNullable[Int] and
      (JsPath \ "browser_height").readNullable[Int] and
      (JsPath \ "avail_width").readNullable[Int] and
      (JsPath \ "avail_height").readNullable[Int] and
      (JsPath \ "screen_width").readNullable[Int] and
      (JsPath \ "screen_height").readNullable[Int] and
      (JsPath \ "operating_system").readNullable[String]
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
      (JsPath \ "timestamp").read[String]
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
      (JsPath \ "lng").readNullable[Float]
    )(LabelPointSubmission.apply _)

  implicit val labelSubmissionreads: Reads[LabelSubmission] = (
    (JsPath \ "gsv_panorama_id").read[String] and
      (JsPath \ "label_type").read[String] and
      (JsPath \ "photographer_heading").read[Float] and
      (JsPath \ "photographer_pitch").read[Float] and
      (JsPath \ "deleted").read[JsBoolean] and
      (JsPath \ "label_points").read[Seq[LabelPointSubmission]]
    )(LabelSubmission.apply _)

  implicit val auditTaskReads: Reads[TaskSubmission] = (
    (JsPath \ "street_edge_id").read[Int] and
      (JsPath \ "task_start").read[String]
    )(TaskSubmission.apply _)

  implicit val amtAssignmentReads: Reads[AMTAssignmentSubmission] = (
      (JsPath \ "amazon_hit_id").read[String] and
      (JsPath \ "amazon_assignment_id").read[String] and
      (JsPath \ "assignment_start").read[String]
    )(AMTAssignmentSubmission.apply _)

  implicit val auditTaskSubmissionReads: Reads[AuditTaskSubmission] = (
    (JsPath \ "assignment").readNullable[AMTAssignmentSubmission] and
      (JsPath \ "audit_task").read[TaskSubmission] and
      (JsPath \ "labels").read[Seq[LabelSubmission]] and
      (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission]
    )(AuditTaskSubmission.apply _)
}