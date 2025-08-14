/**
 * Models for the Project Sidewalk Raw Labels API.
 *
 * This file contains the data structures used for API requests, responses,
 * and error handling related to sidewalk accessibility labels.
 */
package models.api

import models.api.ApiModelUtils.{createGeoJsonPointGeometry, escapeCsvField}
import models.computation.StreamingApiType
import models.utils.LatLngBBox
import play.api.libs.json.{JsObject, Json, OFormat, Writes}

import java.time.OffsetDateTime

/**
 * Represents parsed and validated filters from query parameters for the Raw Labels API.
 *
 * @param bbox Optional bounding box to filter labels by geographic location
 * @param labelTypes Optional list of label types to include (e.g., "CurbRamp", "NoCurbRamp")
 * @param tags Optional list of tags to filter by (e.g., "narrow", "cracked")
 * @param minSeverity Optional minimum severity score (1-5 scale)
 * @param maxSeverity Optional maximum severity score (1-5 scale)
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
  implicit val validationDataFormat: OFormat[LabelValidationSummaryForApi] = Json.format[LabelValidationSummaryForApi]
}

/**
 * Primary data structure representing a sidewalk accessibility label.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 * Contains all relevant metadata about the label, its location, and validation status.
 *
 * @param labelId Unique identifier for the label
 * @param userId Anonymized identifier of the user who created the label
 * @param gsvPanoramaId Google Street View panorama identifier where the label was placed
 * @param labelType Type of accessibility issue (e.g., "CurbRamp", "SurfaceProblem")
 * @param severity Optional severity rating (1-5 scale)
 * @param tags List of descriptive tags applied to the label
 * @param description Optional user-provided description of the issue
 * @param timeCreated Timestamp when the label was created
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier
 * @param neighborhood Name of the neighborhood where the label is located
 * @param latitude Geographic latitude coordinate
 * @param longitude Geographic longitude coordinate
 * @param correct Option indicating consensus validation status
 * @param agreeCount Number of users who agreed with this label
 * @param disagreeCount Number of users who disagreed with this label
 * @param unsureCount Number of users who were unsure about this label
 * @param validations List of individual user validations for this label
 * @param auditTaskId Optional audit task identifier
 * @param missionId Optional mission identifier
 * @param imageCaptureDate Optional date when the Street View image was captured
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
 */
case class LabelDataForApi(
    labelId: Int,
    userId: String,
    gsvPanoramaId: String,
    labelType: String,
    severity: Option[Int],
    tags: List[String],
    description: Option[String],
    timeCreated: OffsetDateTime,
    streetEdgeId: Int,
    osmWayId: Long,
    neighborhood: String,
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
    zoom: Option[Int],
    canvasX: Option[Int],
    canvasY: Option[Int],
    canvasWidth: Option[Int],
    canvasHeight: Option[Int],
    panoX: Option[Int],
    panoY: Option[Int],
    panoWidth: Option[Int],
    panoHeight: Option[Int],
    cameraHeading: Option[Double],
    cameraPitch: Option[Double]
) extends StreamingApiType {

  /**
   * Generates a direct Google Street View URL for this label location.
   *
   * This URL can be opened in a browser to view the Street View at the label position.
   * The URL format follows Google's standard Street View URL structure:
   * https://www.google.com/maps/@{lat},{lng},3a,75y,{heading}h,{pitch}t/data=!3m4!1e1!3m2!1s{panoId}!2e0
   *
   * URL components:
   * - @{lat},{lng}: The geographic coordinates
   * - 3a: Specifies Street View mode
   * - 75y: Default field of view (75 degrees)
   * - {heading}h: Horizontal view direction in degrees followed by 'h'
   * - {pitch}t: Vertical view angle in degrees followed by 't'
   * - !3m4!1e1!3m2!1s{panoId}!2e0: Data parameter specifying panorama ID
   *
   * @return A complete Google Street View URL pointing to this label's location
   */
  def gsvUrl: String = {
    // Base URL for Google Maps.
    val baseUrl = "https://www.google.com/maps/@"

    // Format latitude and longitude with default Street View settings.
    val latLng = s"$latitude,$longitude,3a,75y" // '75y' is FOV

    // Handle optional parameters with defaults where needed.
    val headingStr = s"${heading.getOrElse(0)}h"
    val pitchStr   = s"${90.0 + pitch.getOrElse(0.0)}t"

    // The data parameter contains the panorama ID information.
    // Format is: !3m4!1e1!3m2!1s{PANORAMA_ID}!2e0
    val panoParam = s"data=!3m4!1e1!3m2!1s$gsvPanoramaId!2e0"

    // Assemble all components into the final URL
    s"$baseUrl$latLng,$headingStr,$pitchStr/$panoParam"
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
        "label_id"        -> labelId,
        "user_id"         -> userId,
        "gsv_panorama_id" -> gsvPanoramaId,
        "label_type"      -> labelType,
        "severity"        -> severity,
        "tags"            -> tags,
        "description"     -> description,
        "time_created"    -> timeCreated,
        "street_edge_id"  -> streetEdgeId,
        "osm_way_id"      -> osmWayId,
        "neighborhood"    -> neighborhood,
        "correct"         -> correct,
        "agree_count"     -> agreeCount,
        "disagree_count"  -> disagreeCount,
        "unsure_count"    -> unsureCount,
        "validations"     -> validations.map(v =>
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
        "gsv_url"            -> gsvUrl // Include the direct GSV URL
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
      gsvPanoramaId,
      labelType,
      severity.map(_.toString).getOrElse(""),
      escapeCsvField(tags.mkString("[", ",", "]")),
      description.map(escapeCsvField).getOrElse(""),
      timeCreated.toInstant.toEpochMilli.toString,
      streetEdgeId.toString,
      osmWayId.toString,
      escapeCsvField(neighborhood),
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
      escapeCsvField(gsvUrl),
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
  val csvHeader: String = "label_id,user_id,gsv_panorama_id,label_type,severity,tags,description,time_created," +
    "street_edge_id,osm_way_id,neighborhood,correct,agree_count,disagree_count,unsure_count,validations," +
    "audit_task_id,mission_id,image_capture_date,heading,pitch,zoom,canvas_x,canvas_y,canvas_width,canvas_height," +
    "pano_x,pano_y,pano_width,pano_height,camera_heading,camera_pitch,gsv_url,latitude,longitude\n"

  /**
   * Implicit JSON writer for LabelData that uses the toJson method.
   */
  implicit val labelDataWrites: Writes[LabelDataForApi] = (label: LabelDataForApi) => label.toJson
}
