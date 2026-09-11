/**
 * Models for the Project Sidewalk Raw Labels API.
 *
 * This file contains the data structures used for API requests, responses,
 * and error handling related to sidewalk accessibility labels.
 */
package models.api

import models.api.ApiModelUtils.createGeoJsonPointGeometry
import models.label.StreetSide
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.utils.LatLngBBox
import play.api.libs.json.{JsObject, JsValue, Json, Writes}

import java.time.OffsetDateTime

/**
 * Validation-status filter values for the Raw Labels API's `validationStatus` parameter.
 *
 * The value names are the public API tokens. `Unsure` means the label has at least one validation but no consensus
 * (`correct` still NULL); `Unvalidated` means the label has zero validations.
 */
object RawLabelValidationStatus extends Enumeration {
  val ValidatedCorrect   = Value("validated_correct")
  val ValidatedIncorrect = Value("validated_incorrect")
  val Unsure             = Value("unsure")
  val Unvalidated        = Value("unvalidated")
}

/**
 * Parsed severity-set filter from the Raw Labels API's `severity` parameter.
 *
 * @param severities          Severity ratings (1-3) to include.
 * @param includeNullSeverity Whether to include labels with no severity rating (the API's `none` token).
 */
case class SeverityFilterForApi(severities: Set[Int], includeNullSeverity: Boolean)

/**
 * A single parsed entry from the Raw Labels API's `tags` parameter.
 *
 * @param labelType Label type the tag is scoped to (e.g. "CurbRamp"), or `None` to match the tag on any label type.
 * @param tag       The tag name to match.
 */
case class TagFilterForApi(labelType: Option[String], tag: String)

object TagFilterForApi {

  /**
   * Parses and validates the Raw Labels API's repeatable `tags` parameter against a city's tag vocabulary.
   *
   * Each occurrence of the parameter is one entry. If an entry's text before the first colon names a label type, the
   * entry narrows only that type ("CurbRamp:narrow"); otherwise the whole entry is a tag narrowing every type (tag
   * names may themselves contain colons — "cycle lane: faded paint" — so an unrecognized prefix is not an error).
   *
   * An entry is valid when its tag exists in the vocabulary: for its own label type if scoped, on any label type
   * otherwise. An unknown tag is a 400 rather than a silently-empty match — the same strictness `labelType` gets —
   * except that an entry which fails whole is first re-read as an older comma-joined list (`tags=a,b` from a
   * pre-#4786 link) and accepted if every piece is itself valid. Validating before splitting is what lets a tag name
   * that contains a comma ("yellow box, accessibility features not visible") survive intact.
   *
   * @param entries         The tags query parameter occurrences, in the order they were supplied.
   * @param validLabelTypes Label type names an entry may be scoped to.
   * @param tagsByLabelType The city's tag vocabulary: label type name -> the tag names of that type.
   * @return `Right(None)` if absent, `Right(Some(filters))` if every entry validates, or `Left(ApiError)` describing
   *         the first empty, mis-scoped, or unknown entry.
   */
  def parse(
      entries: List[String],
      validLabelTypes: Set[String],
      tagsByLabelType: Map[String, Set[String]]
  ): Either[ApiError, Option[Seq[TagFilterForApi]]] = {
    lazy val allTagNames: Set[String] = tagsByLabelType.values.flatten.toSet
    val emptyValueError               = ApiError.invalidParameter("The tags parameter contains an empty value.", "tags")

    def syntacticParse(entry: String): TagFilterForApi = {
      val prefix = entry.takeWhile(_ != ':')
      if (entry.contains(':') && validLabelTypes.contains(prefix))
        TagFilterForApi(Some(prefix), entry.drop(prefix.length + 1).trim)
      else TagFilterForApi(None, entry)
    }

    def validationError(filter: TagFilterForApi): Option[ApiError] = filter match {
      case TagFilterForApi(Some(labelType), "") =>
        Some(ApiError.invalidParameter(s"Missing tag after label type '$labelType:' in the tags parameter.", "tags"))
      case TagFilterForApi(Some(labelType), tag) if !tagsByLabelType.getOrElse(labelType, Set.empty).contains(tag) =>
        Some(
          ApiError.invalidParameter(
            s"'$tag' is not a tag of label type '$labelType'; see /v3/api/labelTags for this city's tags.",
            "tags"
          )
        )
      case TagFilterForApi(None, tag) if !allTagNames.contains(tag) =>
        Some(ApiError.invalidParameter(s"Unknown tag '$tag'; see /v3/api/labelTags for this city's tags.", "tags"))
      case _ => None
    }

    def resolveEntry(entry: String): Either[ApiError, Seq[TagFilterForApi]] =
      if (entry.isEmpty) Left(emptyValueError)
      else {
        val whole = syntacticParse(entry)
        validationError(whole) match {
          case None                           => Right(Seq(whole))
          case Some(_) if entry.contains(',') =>
            val pieces = entry.split(",").map(_.trim).toSeq
            if (pieces.exists(_.isEmpty)) Left(emptyValueError)
            else {
              val parsed = pieces.map(syntacticParse)
              // A piece-level error names the actual offender; the whole-entry error would name the joined text.
              parsed.flatMap(validationError).headOption.toLeft(parsed)
            }
          case Some(wholeError) => Left(wholeError)
        }
      }

    val trimmed = entries.map(_.trim)
    if (trimmed.isEmpty) Right(None)
    else {
      trimmed
        .foldLeft[Either[ApiError, Vector[TagFilterForApi]]](Right(Vector.empty)) {
          case (Left(error), _)    => Left(error)
          case (Right(acc), entry) => resolveEntry(entry).map(acc ++ _)
        }
        .map(filters => Some(filters))
    }
  }
}

/**
 * Represents parsed and validated filters from query parameters for the Raw Labels API.
 *
 * @param bbox Optional bounding box to filter labels by geographic location
 * @param labelTypes Optional list of label types to include (e.g., "CurbRamp", "NoCurbRamp")
 * @param tags Optional list of tag filters, each optionally scoped to a label type
 * @param severity Optional severity-set filter; mutually exclusive with minSeverity/maxSeverity
 * @param minSeverity Optional minimum severity score (1-3 scale)
 * @param maxSeverity Optional maximum severity score (1-3 scale)
 * @param validationStatuses Optional set of validation statuses to include (OR semantics)
 * @param startDate Optional start date for filtering labels by creation time
 * @param endDate Optional end date for filtering labels by creation time
 * @param regionId Optional region ID to filter labels by geographic region
 * @param regionName Optional region name to filter labels by geographic region
 */
case class RawLabelFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    labelTypes: Option[Seq[String]] = None,
    tags: Option[Seq[TagFilterForApi]] = None,
    severity: Option[SeverityFilterForApi] = None,
    minSeverity: Option[Int] = None,
    maxSeverity: Option[Int] = None,
    validationStatuses: Option[Set[RawLabelValidationStatus.Value]] = None,
    highQualityUserOnly: Boolean = false,
    startDate: Option[OffsetDateTime] = None,
    endDate: Option[OffsetDateTime] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None
)

/**
 * One vote in a Raw Labels entry's `validations` array.
 *
 * @param userId The anonymized identifier of the user who provided the validation
 * @param validationType The type of validation ("Agree", "Disagree", or "Unsure")
 * @param validatorType "Human" or "AI"
 */
case class LabelValidationSummaryForApi(userId: String, validationType: String, validatorType: String) {

  // Used by every output format, so they all print the same keys.
  def toJson: JsObject =
    Json.obj("user_id" -> userId, "validation" -> validationType, "validator_type" -> validatorType)
}

/**
 * Primary data structure representing a sidewalk accessibility label.
 * Implements StreamingApiType to support streaming output formats like GeoJSON and CSV.
 * Contains all relevant metadata about the label, its location, and validation status.
 *
 * @param labelId Unique identifier for the label
 * @param userId Anonymized identifier of the user who created the label
 * @param panoId Panorama identifier where the label was placed
 * @param panoSource Imagery provider the panorama came from (GSV, Mapillary, Panoramax, or infra3d); drives `panoUrl`
 * @param labelType Type of accessibility issue (e.g., "CurbRamp", "SurfaceProblem")
 * @param severity Optional severity rating (1-3 scale)
 * @param tags List of descriptive tags applied to the label
 * @param description Optional user-provided description of the issue
 * @param timeCreated Timestamp when the label was created
 * @param highQualityUser Whether the labeler is flagged as a high-quality contributor (`user_stat.high_quality`)
 * @param streetEdgeId Project Sidewalk's street segment identifier
 * @param osmWayId OpenStreetMap way identifier
 * @param regionId Identifier of the region (neighborhood) the label falls within
 * @param regionName Name of the region (neighborhood) where the label is located
 * @param streetSide Side of `streetEdgeId` the label sits on, relative to the edge's digitized direction (#2886);
 *                   `None` within 1 m of the centerline or without a position
 * @param centerlineOffsetM Signed geodesic distance from the street's centerline in metres, positive on the left of
 *                          the digitized direction and negative on the right; the side's confidence. Measured across
 *                          the street, not along it: a label past the end of its edge keeps only its cross-track
 *                          component, so the magnitude never inflates into an along-street distance (`None` without
 *                          a position)
 * @param latitude Geographic latitude coordinate
 * @param longitude Geographic longitude coordinate
 * @param correct Option indicating consensus validation status
 * @param agreeCount Number of users who agreed with this label
 * @param disagreeCount Number of users who disagreed with this label
 * @param unsureCount Number of users who were unsure about this label
 * @param validations List of individual validations for this label
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
    highQualityUser: Boolean,
    streetEdgeId: Int,
    osmWayId: Long,
    regionId: Int,
    regionName: String,
    streetSide: Option[StreetSide.Value],
    centerlineOffsetM: Option[Double],
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
   *  - Panoramax: the federated viewer's picture permalink, whose `xyz` fragment is heading/pitch/zoom with zoom on
   *    Panoramax's own 0–100 scale (30 is its default view). `PanoramaxViewer.publicViewerLink` builds the same URL
   *    client-side for the label popup's "View in Panoramax" link -- change one and change the other.
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
    case PanoSource.Panoramax =>
      Some(
        s"https://api.panoramax.xyz/#focus=pic&pic=$panoId" +
          f"&xyz=${heading.getOrElse(0.0)}%.2f/${pitch.getOrElse(0.0)}%.2f/30"
      )
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
      "properties" -> LabelDataForApi.toJson(this)
    )
  }

  override def toCsvRow: String = LabelDataForApi.toCsvRow(this)
}

object LabelDataForApi extends ApiFields[LabelDataForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[LabelDataForApi]] = Seq(
    field("label_id")(_.labelId),
    field("user_id")(_.userId),
    field("pano_id")(_.panoId),
    field("pano_source")(_.panoSource.toString),
    field("label_type")(_.labelType),
    field("severity")(_.severity),
    field("tags")(_.tags),
    field("description")(_.description),
    field("time_created")(_.timeCreated),
    field("high_quality_user")(_.highQualityUser),
    field("street_edge_id")(_.streetEdgeId),
    field("osm_way_id")(_.osmWayId),
    field("region_id")(_.regionId),
    field("region_name")(_.regionName),
    field("street_side")(_.streetSide.map(_.toString)),
    field("centerline_offset_m")(_.centerlineOffsetM),
    field("correct")(_.correct),
    field("agree_count")(_.agreeCount),
    field("disagree_count")(_.disagreeCount),
    field("unsure_count")(_.unsureCount),
    field("validations")(_.validations.map(_.toJson)),
    field("audit_task_id")(_.auditTaskId),
    field("mission_id")(_.missionId),
    field("image_capture_date")(_.imageCaptureDate),
    field("heading")(_.heading),
    field("pitch")(_.pitch),
    field("zoom")(_.zoom),
    field("canvas_x")(_.canvasX),
    field("canvas_y")(_.canvasY),
    field("canvas_width")(_.canvasWidth),
    field("canvas_height")(_.canvasHeight),
    field("pano_x")(_.panoX),
    field("pano_y")(_.panoY),
    field("pano_width")(_.panoWidth),
    field("pano_height")(_.panoHeight),
    field("camera_heading")(_.cameraHeading),
    field("camera_pitch")(_.cameraPitch),
    field("camera_roll")(_.cameraRoll),
    // Provider-specific viewer link; null for providers without one (infra3d).
    field("pano_url")(_.panoUrl)
  )

  override val csvOnlyFields: Seq[ApiField[LabelDataForApi]] = Seq(
    field("latitude")(_.latitude),
    field("longitude")(_.longitude)
  )

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
 * @param labelType Label type name (e.g. "CurbRamp")
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
    labelType: String,
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

  override def toJson: JsValue = LabelCVMetadata.toJson(this)

  override def toCsvRow: String = LabelCVMetadata.toCsvRow(this)
}

object LabelCVMetadata extends ApiFields[LabelCVMetadata] {
  import ApiFields.field

  override val fields: Seq[ApiField[LabelCVMetadata]] = Seq(
    field("label_id")(_.labelId),
    field("pano_id")(_.panoId),
    field("label_type")(_.labelType),
    field("agree_count")(_.agreeCount),
    field("disagree_count")(_.disagreeCount),
    field("unsure_count")(_.unsureCount),
    field("pano_width")(_.panoWidth),
    field("pano_height")(_.panoHeight),
    field("pano_x")(_.panoX),
    field("pano_y")(_.panoY),
    field("canvas_width")(_.canvasWidth),
    field("canvas_height")(_.canvasHeight),
    field("canvas_x")(_.canvasX),
    field("canvas_y")(_.canvasY),
    field("zoom")(_.zoom),
    field("heading")(_.heading),
    field("pitch")(_.pitch),
    field("camera_heading")(_.cameraHeading),
    field("camera_pitch")(_.cameraPitch),
    field("camera_roll")(_.cameraRoll)
  )

  implicit val writes: Writes[LabelCVMetadata] = (metadata: LabelCVMetadata) => toJson(metadata)
}
