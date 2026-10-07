package formats.json

import formats.json.LabelFormats.POVWrites
import formats.json.MissionFormats.given
import formats.json.PanoFormats.PanoDate
import models.audit.{AuditTask, AuditTaskInteraction, NewTask}
import models.label.{ComputationMethod, LabelPointTable, LabelType, POV}
import models.mission.Mission
import models.pano.PanoSource
import models.street.StreetEdgePriority
import models.utils.MyPostgresProfile.api.given
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Point}
import play.api.libs.functional.syntax.*
import play.api.libs.json.*
import service.UpdatedStreets

import java.nio.charset.StandardCharsets
import java.time.OffsetDateTime

object ExploreFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

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
      panoId: Option[String],
      lat: Option[Double],
      lng: Option[Double],
      heading: Option[Double],
      pitch: Option[Double],
      zoom: Option[Double],
      note: Option[String],
      temporaryLabelId: Option[Int],
      timestamp: OffsetDateTime
  )
  case class LabelPointSubmission(
      panoX: Int,
      panoY: Int,
      canvasX: Int,
      canvasY: Int,
      canvasWidth: Int,
      canvasHeight: Int,
      heading: Double,
      pitch: Double,
      zoom: Double,
      lat: Option[Double],
      lng: Option[Double],
      computationMethod: Option[ComputationMethod]
  )
  case class LabelSubmission(
      panoId: String,
      panoSource: PanoSource,
      labelType: LabelType,
      deleted: Boolean,
      severity: Option[Int],
      description: Option[String],
      tagIds: Seq[Int],
      point: LabelPointSubmission,
      temporaryLabelId: Int,
      timeCreated: Option[OffsetDateTime],
      tutorial: Boolean,
      pano: Option[PanoSubmission] // Added in #4587 to support the pano_data row that is integral to a label.
  )
  case class TaskSubmission(
      streetEdgeId: Int,
      taskStart: OffsetDateTime,
      auditTaskId: Option[Int],
      completed: Option[Boolean],
      currentLat: Double,
      currentLng: Double,
      startPointReversed: Boolean,
      currentMissionStart: Option[Point],
      lastPriorityUpdateTime: OffsetDateTime,
      requestUpdatedStreetPriority: Boolean,
      auditedDistanceM: Option[Double],
      // Which route_street row this task was served for, when auditing along a route. A route may traverse one
      // street twice (out-and-back), so street_edge_id alone can't say which traversal this is.
      routeStreetId: Option[Int]
  )
  case class NoStreetViewSubmission(task: TaskSubmission, missionId: Int)
  case class PanoLinkSubmission(targetPanoId: String, yawDeg: Double, description: Option[String])
  case class PanoSubmission(
      panoId: String,
      source: PanoSource,
      captureDate: String,
      width: Option[Int],
      height: Option[Int],
      tileWidth: Option[Int],
      tileHeight: Option[Int],
      lat: Option[Double],
      lng: Option[Double],
      cameraHeading: Option[Double],
      cameraPitch: Option[Double],
      cameraRoll: Option[Double],
      links: Seq[PanoLinkSubmission],
      copyright: Option[String],
      // The licence identifier the imagery provider records per picture. Panoramax only (#5202).
      license: Option[String],
      address: Option[String],
      history: Seq[PanoDate],
      // Verbatim imagery-provider metadata blob; sent by the AI labeler only, never by the Explore client (#4806).
      sourceMetadata: Option[JsObject]
  )
  case class AuditMissionProgress(
      missionId: Int,
      distanceProgress: Option[Double],
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
      panos: Seq[PanoSubmission],
      userRouteId: Option[Int],
      timestamp: OffsetDateTime
  )
  case class SurveySingleSubmission(surveyQuestionId: String, answerText: String)

  // Includes a list of labels found on a single panorama.
  case class AiLabelsSubmission(
      labelType: LabelType,
      modelId: String,
      modelTrainingDate: String,
      apiVersion: String,
      pano: PanoSubmission,
      labels: Seq[AiLabelDetection]
  )
  case class AiLabelDetection(panoX: Int, panoY: Int, confidence: Double)

  /**
   * What /explore/session hands the page (#5650): the task and mission to start on, the region and route they sit in,
   * and the pano the page should open at when the URL asked for one. `task` is None once the region is fully mapped.
   * @param routeResumed     Whether a walk already in progress was picked back up, so the page can say so.
   * @param routeUnavailable Whether a route was dropped from the session: a `?routeId=` named no live route (#5156),
   *                         or the walk's route has no walkable distance (#5167). `routeId` is then absent.
   * @param regionFinished   Whether the user had already finished the `?regionId=` they asked for, so `regionId` is
   *                         where they were moved instead (#5692).
   * @param startPov         A heading, pitch and zoom to open the pano at; only ever set alongside a pano or lat/lng.
   */
  case class ExploreSession(
      task: Option[NewTask],
      mission: Mission,
      regionId: Int,
      regionName: String,
      nextTemporaryLabelId: Int,
      hasCompletedMission: Boolean,
      routeId: Option[Int],
      userRouteId: Option[Int],
      routeName: Option[String],
      routeResumed: Boolean,
      routeUnavailable: Boolean,
      regionFinished: Boolean,
      startLat: Option[Double],
      startLng: Option[Double],
      startPanoId: Option[String],
      startPov: Option[POV],
      startPlaceName: Option[String]
  )

  given pointWrites: Writes[Point] = Writes { point =>
    Json.obj(
      "lat" -> point.getX,
      "lng" -> point.getY
    )
  }

  given auditTaskWrites: Writes[AuditTask] = Json.writes[AuditTask]

  given auditTaskInteractionWrites: Writes[AuditTaskInteraction] = Json.writes[AuditTaskInteraction]

  given newTaskWrites: Writes[NewTask] = (task: NewTask) => {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> task.geom,
      "properties" -> Json.obj(
        "street_edge_id"        -> task.edgeId,
        "current_lng"           -> task.currentLng,
        "current_lat"           -> task.currentLat,
        "way_type"              -> task.wayType.name,
        "max_speed"             -> task.maxSpeed,
        "start_point_reversed"  -> task.startPointReversed,
        "task_start"            -> task.taskStart.toString,
        "completed_by_any_user" -> task.completedByAnyUser,
        "priority"              -> task.priority,
        "completed"             -> task.completed,
        "audit_task_id"         -> task.auditTaskId,
        "current_mission_id"    -> task.currentMissionId,
        "current_mission_start" -> task.currentMissionStart, // TODO test that this looks right on the front end.
        // "current_mission_start" -> currentMissionStart.map(p => geojson.LatLng(p.getY, p.getX)),
        "route_street_id"       -> task.routeStreetId,
        "route_street_position" -> task.routeStreetPosition,
        "reported_no_imagery"   -> task.reportedNoImagery,
        "needs_reaudit"         -> task.needsReaudit,
        // Carried on the payload so the re-audit notice costs no request of its own (#4895).
        "mapped_by_this_user" -> task.mappedByThisUser,
        "last_mapped_at"      -> task.lastMappedAt,
        "new_imagery_date"    -> task.newImageryDate
      )
    )
  }

  given streetEdgePriorityWrites: Writes[StreetEdgePriority] = (streetPriority: StreetEdgePriority) => {
    Json.obj(
      "street_edge_id" -> streetPriority.streetEdgeId,
      "priority"       -> streetPriority.priority
    )
  }

  given updatedStreetsWrites: Writes[UpdatedStreets] = Json.writes[UpdatedStreets]

  given exploreSessionWrites: Writes[ExploreSession] = Json.writes[ExploreSession]

  given pointReads: Reads[Point] = (
    (JsPath \ "lat").read[Double] and
      (JsPath \ "lng").read[Double]
  )((lat, lng) => GeometryFactory().createPoint(Coordinate(lat, lng)))

  given environmentSubmissionReads: Reads[EnvironmentSubmission] = Json.reads[EnvironmentSubmission]

  given interactionSubmissionReads: Reads[InteractionSubmission] = Json.reads[InteractionSubmission]

  private val positiveFrameError = JsonValidationError("canvas_width and canvas_height must be positive")

  given labelPointSubmissionReads: Reads[LabelPointSubmission] = (
    (JsPath \ "pano_x").read[Int] and
      (JsPath \ "pano_y").read[Int] and
      (JsPath \ "canvas_x").read[Int] and
      (JsPath \ "canvas_y").read[Int] and
      // Defaulted, not required, for Explore sessions that were open across the #5085 deploy: every such client is the
      // boxed 720x480 tool, so the default is exactly right, where a 400 would drop the label. Make these required once
      // no pre-#5085 clients remain.
      (JsPath \ "canvas_width").readWithDefault[Int](LabelPointTable.canvasWidth).filter(positiveFrameError)(_ > 0) and
      (JsPath \ "canvas_height")
        .readWithDefault[Int](LabelPointTable.canvasHeight)
        .filter(positiveFrameError)(_ > 0) and
      (JsPath \ "heading").read[Double] and
      (JsPath \ "pitch").read[Double] and
      (JsPath \ "zoom").read[Double] and
      (JsPath \ "lat").readNullable[Double] and
      (JsPath \ "lng").readNullable[Double] and
      (JsPath \ "computation_method").readNullable[ComputationMethod]
  )(LabelPointSubmission.apply)

  given panoLinkSubmissionReads: Reads[PanoLinkSubmission] = Json.reads[PanoLinkSubmission]

  // Ceiling on the provider blob a single submission may persist (#4806). It is stored verbatim, the JSON body parser
  // accepts up to play.http.parser.maxMemoryBuffer (100M), and the column rides pano_data's default projection, so
  // without a bound one caller could park an arbitrarily fat row on a table other paths read whole. Real Mapillary
  // blobs run a few KB, so this leaves ample headroom while turning an absurd payload into a 400 rather than a row
  // that has to be cleaned up by hand.
  private val maxSourceMetadataBytes = 64 * 1024

  // Object-only: the blob is a provider metadata document, never a scalar or array. pano_data carries the matching
  // jsonb_typeof CHECK (evolution 348), so a malformed blob is refused at both ends.
  private val sourceMetadataReads: Reads[JsObject] = Reads.JsObjectReads.filter(
    JsonValidationError(s"source_metadata must be a JSON object of at most $maxSourceMetadataBytes bytes")
  )(blob => Json.stringify(blob).getBytes(StandardCharsets.UTF_8).length <= maxSourceMetadataBytes)

  given panoSubmissionReads: Reads[PanoSubmission] = (
    (JsPath \ "pano_id").read[String] and
      (JsPath \ "source").read[PanoSource] and
      (JsPath \ "capture_date").read[String] and
      (JsPath \ "width").readNullable[Int] and
      (JsPath \ "height").readNullable[Int] and
      (JsPath \ "tile_width").readNullable[Int] and
      (JsPath \ "tile_height").readNullable[Int] and
      (JsPath \ "lat").readNullable[Double] and
      (JsPath \ "lng").readNullable[Double] and
      (JsPath \ "camera_heading").readNullable[Double] and
      (JsPath \ "camera_pitch").readNullable[Double] and
      (JsPath \ "camera_roll").readNullable[Double] and
      (JsPath \ "links").read[Seq[PanoLinkSubmission]] and
      (JsPath \ "copyright").readNullable[String] and
      (JsPath \ "license").readNullable[String] and
      (JsPath \ "address").readNullable[String] and
      (JsPath \ "history").read[Seq[PanoDate]] and
      (JsPath \ "source_metadata").readNullable[JsObject](using sourceMetadataReads)
  )(PanoSubmission.apply)

  given labelSubmissionReads: Reads[LabelSubmission] = (
    (JsPath \ "pano_id").read[String] and
      (JsPath \ "pano_source").read[PanoSource] and
      (JsPath \ "label_type").read[LabelType] and
      (JsPath \ "deleted").read[Boolean] and
      (JsPath \ "severity").readNullable[Int] and
      (JsPath \ "description").readNullable[String] and
      (JsPath \ "tag_ids").read[Seq[Int]] and
      (JsPath \ "label_point").read[LabelPointSubmission] and
      (JsPath \ "temporary_label_id").read[Int] and
      (JsPath \ "time_created").readNullable[OffsetDateTime] and
      (JsPath \ "tutorial").read[Boolean] and
      (JsPath \ "pano").readNullable[PanoSubmission]
  )(LabelSubmission.apply)
    // A mismatched block would let a buggy client write one pano's metadata while committing a label that points at
    // another — exactly the orphan #4587 exists to prevent — so refuse it before anything touches the database.
    .filter(JsonValidationError("The label's pano block must describe the label's own pano_id."))(label =>
      label.pano.forall(_.panoId == label.panoId)
    )

  given auditTaskReads: Reads[TaskSubmission] = Json.reads[TaskSubmission]

  given noStreetViewSubmissionReads: Reads[NoStreetViewSubmission] = (
    (JsPath \ "audit_task").read[TaskSubmission] and
      (JsPath \ "mission_id").read[Int]
  )(NoStreetViewSubmission.apply)

  given auditMissionProgressReads: Reads[AuditMissionProgress] = Json.reads[AuditMissionProgress]

  given auditTaskSubmissionReads: Reads[AuditTaskSubmission] = (
    (JsPath \ "mission").read[AuditMissionProgress] and
      (JsPath \ "audit_task").read[TaskSubmission] and
      (JsPath \ "labels").read[Seq[LabelSubmission]] and
      (JsPath \ "interactions").read[Seq[InteractionSubmission]] and
      (JsPath \ "environment").read[EnvironmentSubmission] and
      (JsPath \ "panos").read[Seq[PanoSubmission]] and
      (JsPath \ "user_route_id").readNullable[Int] and
      (JsPath \ "timestamp").read[OffsetDateTime]
  )(AuditTaskSubmission.apply)

  given surveySingleSubmissionReads: Reads[SurveySingleSubmission] = (
    (JsPath \ "name").read[String] and
      (JsPath \ "value").read[String]
  )(SurveySingleSubmission.apply)

  given aiLabelDetectionReads: Reads[AiLabelDetection] = Json.reads[AiLabelDetection]

  given aiLabelSubmissionReads: Reads[AiLabelsSubmission] = Json.reads[AiLabelsSubmission]
}
