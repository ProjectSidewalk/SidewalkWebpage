/**
 * Models for the Project Sidewalk Raw Labels API.
 *
 * This file contains the data structures used for API requests, responses,
 * and error handling related to sidewalk accessibility labels.
 */
package models.api

import models.api.ApiModelUtils.{createGeoJsonPointGeometry, escapeCsvField}
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.utils.LatLngBBox
import play.api.libs.json.{JsObject, JsValue, Json, JsonConfiguration, JsonNaming, OFormat, Writes}

import java.time.OffsetDateTime

/**
 * Represents parsed and validated filters from query parameters for the Raw Labels API.
 *
 * @param bbox Optional bounding box to filter labels by geographic location
 * @param labelTypes Optional list of label types to include (e.g., "CurbRamp", "NoCurbRamp")
 * @param tags Optional list of tags to filter by (e.g., "narrow", "cracked")
 * @param minSeverity Optional minimum severity score (1-3 scale)
 * @param maxSeverity Optional maximum severity score (1-3 scale)
 * @param validationStatus Optional validation status filter ("Agreed", "Disagreed", "Unsure")
 * @param startDate Optional start date for filtering labels by creation time
 * @param endDate Optional end date for filtering labels by creation time
 * @param regionId Optional region ID to filter labels by geographic region
 * @param regionName Optional region name to filter labels by geographic region
 */
case class RawLabelFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    labelTypes: Option[Seq[String]] = None,
    tags: Option[Seq[String]] = None,
    minSeverity: Option[Int] = None,
    maxSeverity: Option[Int] = None,
    validationStatus: Option[String] = None,
    highQualityUserOnly: Boolean = false,
    startDate: Option[OffsetDateTime] = None,
    endDate: Option[OffsetDateTime] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None
)

/**
 * Represents a validation entry for a sidewalk accessibility label. This is used in the API response to summarize user
 * validations (with a userId and validation type).
 *
 * @param userId The anonymized identifier of the user who provided the validation
 * @param validationType The type of validation ("Agree", "Disagree", or "Unsure")
 */
case class LabelValidationSummaryForApi(
    userId: String,
    validationType: String // e.g., "Agree", "Disagree", "Unsure"
)

/**
 * Companion object for LabelValidationSummaryForApi containing JSON formatters.
 */
object LabelValidationSummaryForApi {
  // snake_case JSON output per the v3 API convention (#3871).
  implicit private val config: JsonConfiguration                           = JsonConfiguration(JsonNaming.SnakeCase)
  implicit val validationDataFormat: OFormat[LabelValidationSummaryForApi] =
    Json.format[LabelValidationSummaryForApi]
}

/**
 * Primary data structure representing a sidewalk accessibility label.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 * Contains all relevant metadata about the label, its location, and validation status.
 *
 * @param labelId Unique identifier for the label
 * @param userId Anonymized identifier of the user who created the label
 * @param panoId Panorama identifier where the label was placed
 * @param panoSource Imagery provider the panorama came from (GSV, Mapillary, or infra3d); drives `panoUrl`
 * @param labelType Type of accessibility issue (e.g., "CurbRamp", "SurfaceProblem")
 * @param severity Optional severity rating (1-3 scale)
 * @param tags List of descriptive tags applied to the label
 * @param description Optional user-provided description of the issue
 * @param timeCreated Timestamp when the label was created
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier
 * @param regionId Identifier of the region (neighborhood) the label falls within
 * @param regionName Name of the region (neighborhood) where the label is located
 * @param latitude Geographic latitude coordinate
 * @param longitude Geographic longitude coordinate
 * @param correct Option indicating consensus validation status
 * @param agreeCount Number of users who agreed with this label
 * @param disagreeCount Number of users who disagreed with this label
 * @param unsureCount Number of users who were unsure about this label
 * @param validations List of individual user validations for this label
 * @param auditTaskId Optional audit task identifier
 * @param missionId Optional mission identifier
 * @param imageCaptureDate Optional date when the image was captured
 * @param heading Optional heading angle in degrees
 * @param pitch Optional pitch angle in degrees
 * @param zoom Optional zoom level
 * @param canvasX Optional x-coordinate on the canvas
 * @param canvasY Optional y-coordinate on the canvas
 * @param canvasWidth Optional width of the canvas
 * @param canvasHeight Optional height of the canvas
 * @param panoX Optional x-coordinate in the panorama
 * @param panoY Optional y-coordinate in the panorama
 * @param panoWidth Optional width of the panorama
 * @param panoHeight Optional height of the panorama
 * @param cameraHeading Optional camera heading in degrees
 * @param cameraPitch Optional camera pitch in degrees
 * @param cameraRoll Optional camera roll in degrees
 */
case class LabelDataForApi(
    labelId: Int,
    userId: String,
    panoId: String,
    panoSource: PanoSource,
    labelType: String,
    severity: Option[Int],
    tags: List[String],
    description: Option[String],
    timeCreated: OffsetDateTime,
    streetEdgeId: Int,
    osmWayId: Long,
    regionId: Int,
    regionName: String,
    latitude: Double,
    longitude: Double,
    correct: Option[Boolean],
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    validations: Seq[LabelValidationSummaryForApi],
    auditTaskId: Option[Int],
    missionId: Option[Int],
    imageCaptureDate: Option[String],
    heading: Option[Double],
    pitch: Option[Double],
    zoom: Option[Double],
    canvasX: Option[Int],
    canvasY: Option[Int],
    canvasWidth: Option[Int],
    canvasHeight: Option[Int],
    panoX: Option[Int],
    panoY: Option[Int],
    panoWidth: Option[Int],
    panoHeight: Option[Int],
    cameraHeading: Option[Double],
    cameraPitch: Option[Double],
    cameraRoll: Option[Double]
) extends StreamingApiType {

  /**
   * Builds a browser-openable link to view this label's panorama in the provider's own viewer, positioned at the
   * label's heading/pitch. The format is provider-specific, mirroring the in-app "view in pano" links in
   * `PanoInfoPopover.js` so the API and frontend stay on one canonical URL shape per provider:
   *
   *  - GSV: Google's officially documented Maps URLs API for Street View (`map_action=pano`), which needs no API key.
   *    See https://developers.google.com/maps/documentation/urls/get-started#street-view-action. `heading` (-180..360)
   *    and `pitch` (-90..90) match Project Sidewalk's own conventions, so they pass through unchanged.
   *  - Mapillary: the web app's image-permalink form (`pKey`).
   *  - infra3d: no public, shareable viewer URL exists, so this is `None`.
   *
   * @return The provider's viewer URL for this label, or `None` when the provider has no shareable external viewer.
   */
  def panoUrl: Option[String] = panoSource match {
    case PanoSource.Gsv =>
      Some(
        s"https://www.google.com/maps/@?api=1&map_action=pano&pano=$panoId" +
          s"&heading=${heading.getOrElse(0.0)}&pitch=${pitch.getOrElse(0.0)}"
      )
    case PanoSource.Mapillary =>
      Some(s"https://www.mapillary.com/app/?pKey=$panoId&focus=photo")
    case _ =>
      None
  }

  /**
   * Converts this LabelData object to a GeoJSON Feature object.
   *
   * The GeoJSON structure follows RFC 7946 and includes:
   * - A Point geometry with [longitude, latitude] coordinates
   * - Properties containing all label metadata
   *
   * @return A JsObject containing the GeoJSON Feature representation
   */
  override def toJson: JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> createGeoJsonPointGeometry(longitude, latitude),
      "properties" -> Json.obj(
        "label_id"       -> labelId,
        "user_id"        -> userId,
        "pano_id"        -> panoId,
        "label_type"     -> labelType,
        "severity"       -> severity,
        "tags"           -> tags,
        "description"    -> description,
        "time_created"   -> timeCreated,
        "street_edge_id" -> streetEdgeId,
        "osm_way_id"     -> osmWayId,
        "region_id"      -> regionId,
        "region_name"    -> regionName,
        "correct"        -> correct,
        "agree_count"    -> agreeCount,
        "disagree_count" -> disagreeCount,
        "unsure_count"   -> unsureCount,
        "validations"    -> validations.map(v =>
          Json.obj(
            "user_id"    -> v.userId,
            "validation" -> v.validationType
          )
        ),
        "audit_task_id"      -> auditTaskId,
        "mission_id"         -> missionId,
        "image_capture_date" -> imageCaptureDate,
        "heading"            -> heading,
        "pitch"              -> pitch,
        "zoom"               -> zoom,
        "canvas_x"           -> canvasX,
        "canvas_y"           -> canvasY,
        "canvas_width"       -> canvasWidth,
        "canvas_height"      -> canvasHeight,
        "pano_x"             -> panoX,
        "pano_y"             -> panoY,
        "pano_width"         -> panoWidth,
        "pano_height"        -> panoHeight,
        "camera_heading"     -> cameraHeading,
        "camera_pitch"       -> cameraPitch,
        "camera_roll"        -> cameraRoll,
        "pano_url"           -> panoUrl // Provider-specific viewer link; null for providers without one (infra3d)
      )
    )
  }

  /**
   * Converts this LabelDataForApi object to a CSV row string.
   * The fields are ordered to match the header defined in the companion object.
   * Complex fields like arrays and objects are serialized as JSON strings.
   *
   * @return A comma-separated string representing this label's data
   */
  override def toCsvRow: String = {
    val fields = Seq(
      labelId.toString,
      userId,
      panoId,
      labelType,
      severity.map(_.toString).getOrElse(""),
      escapeCsvField(tags.mkString("[", ",", "]")),
      description.map(escapeCsvField).getOrElse(""),
      timeCreated.toInstant.toEpochMilli.toString,
      streetEdgeId.toString,
      osmWayId.toString,
      regionId.toString,
      escapeCsvField(regionName),
      correct.map(_.toString).getOrElse(""),
      agreeCount.toString,
      disagreeCount.toString,
      unsureCount.toString,
      escapeCsvField(
        validations
          .map(v => s"""{"user_id":"${v.userId}","validation":"${v.validationType}"}""")
          .mkString("[", ",", "]")
      ),
      auditTaskId.map(_.toString).getOrElse(""),
      missionId.map(_.toString).getOrElse(""),
      imageCaptureDate.getOrElse(""),
      heading.map(_.toString).getOrElse(""),
      pitch.map(_.toString).getOrElse(""),
      zoom.map(_.toString).getOrElse(""),
      canvasX.map(_.toString).getOrElse(""),
      canvasY.map(_.toString).getOrElse(""),
      canvasWidth.map(_.toString).getOrElse(""),
      canvasHeight.map(_.toString).getOrElse(""),
      panoX.map(_.toString).getOrElse(""),
      panoY.map(_.toString).getOrElse(""),
      panoWidth.map(_.toString).getOrElse(""),
      panoHeight.map(_.toString).getOrElse(""),
      cameraHeading.map(_.toString).getOrElse(""),
      cameraPitch.map(_.toString).getOrElse(""),
      cameraRoll.map(_.toString).getOrElse(""),
      escapeCsvField(panoUrl.getOrElse("")),
      latitude.toString,
      longitude.toString
    )
    fields.mkString(",")
  }
}

/**
 * Companion object for LabelDataForApi containing CSV header definition and JSON writers.
 */
object LabelDataForApi {

  /**
   * CSV header string with field names in the same order as the toCsvRow output.
   * This should be included as the first line when generating CSV output.
   */
  val csvHeader: String = "label_id,user_id,pano_id,label_type,severity,tags,description,time_created,street_edge_id," +
    "osm_way_id,region_id,region_name,correct,agree_count,disagree_count,unsure_count,validations,audit_task_id,mission_id," +
    "image_capture_date,heading,pitch,zoom,canvas_x,canvas_y,canvas_width,canvas_height,pano_x,pano_y,pano_width," +
    "pano_height,camera_heading,camera_pitch,camera_roll,pano_url,latitude,longitude\n"

  /**
   * Implicit JSON writer for LabelData that uses the toJson method.
   */
  implicit val labelDataWrites: Writes[LabelDataForApi] = (label: LabelDataForApi) => label.toJson
}

/**
 * Computer-vision metadata for a single label, used by the CV/ML export (`/adminapi/labels/cvMetadata`).
 *
 * Implements StreamingApiType to support streaming output formats like JSON and CSV. Holds the panorama
 * and canvas geometry needed to locate the label within its Street View image.
 *
 * @param labelId Unique identifier for the label
 * @param panoId Identifier of the panorama the label was placed on
 * @param labelTypeId Numeric label type identifier
 * @param agreeCount Number of "agree" validations the label received
 * @param disagreeCount Number of "disagree" validations the label received
 * @param unsureCount Number of "unsure" validations the label received
 * @param panoWidth Panorama width in pixels, if known
 * @param panoHeight Panorama height in pixels, if known
 * @param panoX X coordinate of the label within the panorama
 * @param panoY Y coordinate of the label within the panorama
 * @param canvasWidth Width of the canvas the label was placed on
 * @param canvasHeight Height of the canvas the label was placed on
 * @param canvasX X coordinate of the label on the canvas
 * @param canvasY Y coordinate of the label on the canvas
 * @param zoom Zoom level when the label was placed
 * @param heading Viewport heading when the label was placed
 * @param pitch Viewport pitch when the label was placed
 * @param cameraHeading Camera heading of the panorama
 * @param cameraPitch Camera pitch of the panorama
 * @param cameraRoll Camera roll of the panorama, if known
 */
case class LabelCVMetadata(
    labelId: Int,
    panoId: String,
    labelTypeId: Int,
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    panoWidth: Option[Int],
    panoHeight: Option[Int],
    panoX: Int,
    panoY: Int,
    canvasWidth: Int,
    canvasHeight: Int,
    canvasX: Int,
    canvasY: Int,
    zoom: Double,
    heading: Double,
    pitch: Double,
    cameraHeading: Double,
    cameraPitch: Double,
    cameraRoll: Option[Double]
) extends StreamingApiType {

  /** Serializes to a JSON object with snake_case keys (#3871), via the companion's implicit Writes. */
  override def toJson: JsValue = Json.toJson(this)

  /**
   * Serializes to a CSV row matching the companion object's `csvHeader`.
   *
   * @return A comma-separated row; `None` options render as "NA".
   */
  override def toCsvRow: String = {
    s"${labelId},${panoId},${labelTypeId},${agreeCount},${disagreeCount},${unsureCount}," +
      s"${formatOptionForCsv(panoWidth)},${formatOptionForCsv(panoHeight)},${panoX},${panoY}," +
      s"${canvasWidth},${canvasHeight},${canvasX},${canvasY},${zoom},${heading},${pitch}," +
      s"${cameraHeading},${cameraPitch},${cameraRoll.map(_.toString).getOrElse("NA")}"
  }

  /** Renders an option for CSV, using "NA" for `None` (matches the historical CV-metadata CSV format). */
  private def formatOptionForCsv(x: Option[Any]): String = x.map(_.toString).getOrElse("NA").replace("\"", "\"\"")
}

/**
 * Companion object for LabelCVMetadata containing the CSV header and JSON writer.
 */
object LabelCVMetadata {
  val csvHeader: String = "Label ID,Panorama ID,Label Type ID,Agree Count,Disagree Count,Unsure Count,Panorama Width," +
    "Panorama Height,Panorama X,Panorama Y,Canvas Width,Canvas Height,Canvas X,Canvas Y,Zoom,Heading,Pitch," +
    "Camera Heading,Camera Pitch,Camera Roll\n"

  // snake_case JSON output per the v3 API convention (#3871).
  implicit private val config: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)
  implicit val writes: Writes[LabelCVMetadata]   = Json.writes[LabelCVMetadata]
}
