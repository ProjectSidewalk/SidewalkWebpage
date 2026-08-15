package service

import com.google.inject.ImplementedBy
import formats.json.PanoFormats.PanoHistorySubmission
import models.label.{LabelPointTable, LabelTypeEnum, POV}
import models.pano.PanoSource.PanoSource
import models.pano._
import models.street.StreetEdge
import models.utils.{CommonUtils, MyPostgresProfile}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.locationtech.jts.geom.Point
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.http.ContentTypes
import play.api.libs.json.{JsObject, Json}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import service.PanoDataService.{getFov, ImageryCheckConcurrency, LiveImageryTtlDays, MaxUnexpiredPanosPerSweep}
import slick.dbio.DBIO

import java.io.{File, IOException}
import java.net.{SocketTimeoutException, URL}
import java.time.OffsetDateTime
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject._
import scala.concurrent.duration.{Duration, DurationInt}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * Companion object with constants and functions that are shared throughout codebase, that shouldn't require injection.
 */
object PanoDataService {

  /**
   * How long a "the imagery is still there" answer stays good before we ask the provider again (#3004).
   *
   * The window bounds how long a pano that has since disappeared can keep being handed to users, so it trades page
   * load time against that exposure. A pano's odds of vanishing in any given week are on the order of 0.1%, small
   * enough to keep bad hand-outs rare, and a window this wide covers a whole mapathon rather than only the day a
   * label was placed.
   */
  val LiveImageryTtlDays: Long = 7

  /**
   * How many panos the nightly expiry sweep may have in flight at once (#4559).
   */
  val ImageryCheckConcurrency: Int = 10

  /** Ceiling on the unexpired panos one nightly expiry sweep will check. */
  val MaxUnexpiredPanosPerSweep: Int = 5000

  /**
   * Hacky fix to generate the FOV for an image. Determined experimentally.
   * @param zoom Zoom level of the canvas (for fov calculation).
   * @return FOV of image
   */
  def getFov(zoom: Double): Double = {
    if (zoom <= 2) {
      126.5 - zoom * 36.75
    } else {
      195.93 / scala.math.pow(1.92, zoom * 1.0)
    }
  }

  /**
   * Returns the pov of this label if it were centered based on panorama's POV using panorama XY coordinates.
   *
   * @param x The x-coordinate within the panorama image
   * @param y The y-coordinate within the panorama image
   * @param width The total width of the panorama image
   * @param height The total height of the panorama image
   * @param cameraHeading The heading of the camera in degrees
   * @return A tuple containing the calculated heading (0-360 degrees), pitch (-90 to 90 degrees), and zoom (default 1)
   */
  def calculatePovFromPanoXY(x: Int, y: Int, width: Int, height: Int, cameraHeading: Double): POV = {
    // Mikey Sep 2025 - I tested out taking into account camera_roll. Sometimes it helped, sometimes it made it worse.
    // val rawPitch = 90d - 180d * y / height
    // val horizontalOffset = (x.toDouble / width - 0.5) * 360 // -180 to +180 degrees from center
    // Apply roll correction: roll affects pitch based on horizontal position.
    // val correctedPitch = rawPitch - cameraRoll * math.sin(math.toRadians(horizontalOffset))
    POV(
      (cameraHeading - 180 + (x.toDouble / width) * 360) % 360,
      90d - 180d * y / height,
      1d // Just defaulting to a zoom level of 1 since the AI looked at the whole pano and had no zoom.
    )
  }

  /**
   * How far a submitted label record may miss its own pano_x/pano_y before the submission guard logs it, in degrees
   * of angular disagreement (0.18 deg is ~8 px on a 16384-px pano). Above integer-rounding noise (~0.02 deg) and the
   * few-hundredths-of-a-degree jitter of Google's metadata, below anything a user could notice on screen.
   */
  val RECORD_MISMATCH_TOLERANCE_DEG: Double = 0.18

  /**
   * The POV at which a canvas click would sit at the viewport's center: the forward projection the Explore client
   * runs when a label is placed.
   *
   * Port of `util.pano.canvasCoordToCenteredPov` (public/js/common/pano-viewer/src/panoUtilities.js) — the viewport
   * is modeled as a rectilinear camera aimed at (heading, pitch) with focal length `(canvasWidth/2) / tan(fov/2)`,
   * the click's canvas offset is projected through it, and the result is the label's own direction. Together with
   * `calculatePanoXYFromPov` this recomputes a label's `pano_x`/`pano_y` from its stored viewport record, which is
   * how the submission guard detects a record that does not reproduce its own coordinate (issue #4842; the
   * off-target-markers study in sidewalk-panorama-tools reports/2026-08-10-off-target-markers-validate.md).
   *
   * @param viewport Viewport POV when the click happened (heading/pitch in degrees; zoom sets the fov).
   * @param canvasX  Click x on the logical labeling canvas (720x480, origin top-left).
   * @param canvasY  Click y on the logical labeling canvas.
   * @return         The label's own POV: heading in [0, 360), pitch in [-90, 90], zoom carried through.
   */
  def calculatePovIfCentered(viewport: POV, canvasX: Double, canvasY: Double): POV = {
    val fov = math.toRadians(getFov(viewport.zoom))
    val h0  = math.toRadians(viewport.heading)
    val p0  = math.toRadians(viewport.pitch)
    val f   = 0.5 * LabelPointTable.canvasWidth / math.tan(0.5 * fov)
    val du  = canvasX - LabelPointTable.canvasWidth / 2.0
    val dv  = LabelPointTable.canvasHeight / 2.0 - canvasY
    // The sign factor is the JS's beyond-vertical guard; it never fires for real viewer pitch but is kept verbatim.
    val sg = if (math.cos(p0) >= 0) 1.0 else -1.0

    val x = f * math.cos(p0) * math.sin(h0) + du * sg * math.cos(h0) - dv * math.sin(p0) * math.sin(h0)
    val y = f * math.cos(p0) * math.cos(h0) - du * sg * math.sin(h0) - dv * math.sin(p0) * math.cos(h0)
    val z = f * math.sin(p0) + dv * math.cos(p0)
    val r = math.sqrt(x * x + y * y + z * z)

    val heading = (math.toDegrees(math.atan2(x, y)) % 360 + 360) % 360
    POV(heading, math.toDegrees(math.asin(z / r)), viewport.zoom)
  }

  /**
   * The pano-pixel coordinate a POV points at, on a heading-centred equirectangular pano: the inverse of
   * `calculatePovFromPanoXY` and the second half of the client's `pano_x`/`pano_y` computation.
   *
   * Port of `util.pano.povToPanoCoord` (public/js/common/pano-viewer/src/panoUtilities.js) with the client's
   * round-then-wrap: column zero sits at bearing `cameraHeading - 180`, and the y mapping is linear in elevation.
   *
   * @param pov           The direction to locate (heading wrt true north, pitch positive above the horizon).
   * @param cameraHeading Bearing of the pano's center column, degrees wrt true north.
   * @param panoWidth     Width of the full pano image in pixels.
   * @param panoHeight    Height of the full pano image in pixels.
   * @return              (pano_x, pano_y) integer pixels; x wrapped into [0, panoWidth).
   */
  def calculatePanoXYFromPov(pov: POV, cameraHeading: Double, panoWidth: Int, panoHeight: Int): (Int, Int) = {
    val headingWrapped   = (pov.heading           % 360 + 360) % 360
    val headingPixelZero = ((cameraHeading + 180) % 360 + 360) % 360
    val panoX = (((panoWidth + math.round(panoWidth * (headingWrapped - headingPixelZero) / 360.0)) % panoWidth)
      + panoWidth) % panoWidth
    val panoY = panoHeight / 2 - math.round(panoHeight / 2.0 * pov.pitch / 90.0)
    (panoX.toInt, panoY.toInt)
  }

  /**
   * Parameters of the label distance estimator ("approximation3"): a saturating-cotangent blend on a single
   * camera-to-ground height.
   *
   * A label whose click sits `d` degrees below the horizon is `CAMERA_HEIGHT_M / tan(d)` meters away on flat ground.
   * Within `BLEND_DEG` of the horizon the cotangent is ill-conditioned (a fraction of a degree of click noise moves
   * the answer by meters), so a linear tail continues it with matched value and slope, bounding the estimate at
   * 23.85 m.
   *
   * Every constant here is fitted, not chosen — each carries its own derivation below. They come from the
   * **label-latlng-estimation** repo, which holds the notebooks, the held-out splits, and the reports:
   *
   *  - Form (cotangent + matched-slope tail, and `BLEND_DEG`):
   *    [[https://github.com/ProjectSidewalk/label-latlng-estimation/blob/main/reports/2026-08-07-distance-refit.md]]
   *    (PR #12). Won a 12-rung bake-off on 316,118 training rows of GSV depth truth, scored on a held-out 79,029.
   *  - Falsification on a second imagery source (Mapillary), which located the residual scale error in the camera
   *    rigs rather than the form:
   *    [[https://github.com/ProjectSidewalk/label-latlng-estimation/blob/main/reports/2026-08-07-mapillary-falsification.md]]
   *    (PR #13).
   *  - Headroom for a learned model, checked twice with opposite-looking answers. A LightGBM given the same inputs
   *    and split beat this form by 74% on 2017-2020 truth:
   *    [[https://github.com/ProjectSidewalk/label-latlng-estimation/blob/main/reports/2026-08-07-gbm-ceiling.md]]
   *    (PR #14). Scored against truth it was never fitted on, that gap inverts — with one calibration parameter on
   *    each side this two-parameter form answers 0.410 m against 0.459-0.542 m for every recalibrated booster,
   *    including one trained on modern truth directly:
   *    [[https://github.com/ProjectSidewalk/label-latlng-estimation/blob/main/reports/2026-08-10-gbm-transfer.md]]
   *    (PR #21). The booster's apparent edge was the era truth's own resolution-conditioned scale, not scene
   *    structure. So there is no headroom for a learned model to recover here — but read the second report for that,
   *    not the first, which measures only what the 2017-2020 truth frame supports.
   *  - Absolute scale (`CAMERA_HEIGHT_M`), and the evidence for one height rather than a per-label-type table:
   *    [[https://github.com/ProjectSidewalk/label-latlng-estimation/blob/main/reports/2026-08-07-modern-truth.md]]
   *    (PR #16, §7 mechanism and §9 decision). Canonical values: `final_coefficients` in
   *    `data/modern-truth-summary.json`.
   *
   * Measured against fresh GSV depth for 2,655 post-2021 human labels across 36 cities (13 with enough rows to
   * score individually), as median absolute distance error on a held-out half (1,362 rows, split by pano): this
   * estimator lands at **0.41 m**, where the same blend carrying the earlier per-label-type heights lands at 1.28 m
   * and the linear regression this supersedes at 1.17 m. Known limits, from the modern-truth report: the reference
   * ground planes are Google's own measurements, so the scale is internally consistent but externally unanchored
   * (bearing-only triangulation, label-latlng-estimation#7, is the independent check); clicks within 2 degrees of
   * the horizon are undershot by any bounded model; and the residual signed median runs about -0.17 m.
   *
   * Issues: [[https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4765]] (resolution dependence) and
   * [[https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4766]] (near/far compression).
   */
  object LatLngEstimation {

    /**
     * Depression angle (degrees below the horizon) where the cotangent hands off to its linear tail.
     *
     * Fitted, not picked: `era_fit_coefficients.params.blend_deg` in `data/distance-refit-summary.json` (that block
     * was called `provisional_coefficients` when this comment was written), from the rung (`D_blend_type_l1`) that
     * won the distance refit's bake-off on train-half median absolute distance error. Only the angle carries over
     * from that rung — `CAMERA_HEIGHT_M` is calibrated separately.
     */
    val BLEND_DEG: Double = 11.25

    /**
     * Hard ceiling on the estimated distance in meters — `meta.dist_cap_m` in `data/distance-refit-summary.json`,
     * the clamp the fit's own reference implementation applies.
     *
     * It cannot bind at the height below: the tail is a line evaluated no further than the horizon, so its largest
     * value is `CAMERA_HEIGHT_M * 10.186`, i.e. 23.85 m (`PanoDataServiceSpec` pins that maximum). It would only
     * start clipping if a refit pushed the height past ~4.9 m, which is not a camera height any of our imagery
     * sources has. Kept so the estimator stays bounded by construction rather than by the calibration.
     */
    val MAX_DISTANCE_M: Double = 50.0

    /**
     * Drop in meters from the camera to the ground plane, and the estimator's only calibrated quantity.
     *
     * `final_coefficients.params.height_m` in `data/modern-truth-summary.json`: the median of
     * `truth_distance * tan(depression)` over the 2,488 gated human-label rows at depression >= 5 degrees, where
     * truth is fresh GSV depth for post-2021 labels. A disjoint-half split (by pano, seed 666) puts the held-out
     * median absolute error at 0.41 m.
     *
     * One height serves every label type. Giving each type its own is tempting — users do click some types above
     * their ground contact — but on current imagery the implied per-type heights span only 2.27–2.37 m and their
     * ordering does not reproduce the one an earlier fit found on 2017–2020 truth, which is the signature of a
     * spread that tracked the era's depth payloads rather than the label types. Only 31% of today's payloads carry
     * the pinned ground-plane default the era's mostly did, and today's measured plane sits near 2.35 m.
     * Modern-truth report §7 has the mechanism, §9 the decision and its tradeoffs.
     */
    val CAMERA_HEIGHT_M: Double = 2.341219672825709

    /** The constants above as JSON for the Explore front end, which runs the identical estimator (see Label.js). */
    val asJson: JsObject = Json.obj(
      "blendDeg"      -> BLEND_DEG,
      "maxDistanceM"  -> MAX_DISTANCE_M,
      "cameraHeightM" -> CAMERA_HEIGHT_M
    )
  }

  /**
   * Estimates a label's distance from the panorama in meters, given its depression angle below the horizon.
   *
   * Flat-ground cotangent geometry down to `LatLngEstimation.BLEND_DEG`, then a linear tail whose slope is the
   * cotangent's derivative at the blend angle, so value and slope match at the handoff. Above the horizon the answer
   * is the horizon's, keeping the estimate bounded for any input.
   *
   * @param depressionDeg Degrees below the horizon (negative when above the horizon).
   * @return              Estimated distance in meters.
   */
  def estimateDistanceFromPanoM(depressionDeg: Double): Double = {
    val heightM  = LatLngEstimation.CAMERA_HEIGHT_M
    val blendRad = math.toRadians(LatLngEstimation.BLEND_DEG)
    if (depressionDeg >= LatLngEstimation.BLEND_DEG) {
      heightM / math.tan(math.toRadians(depressionDeg))
    } else {
      val tailM = heightM / math.tan(blendRad) +
        heightM * (math.Pi / 180.0) / math.pow(math.sin(blendRad), 2) *
        (LatLngEstimation.BLEND_DEG - math.max(depressionDeg, 0.0))
      math.min(tailM, LatLngEstimation.MAX_DISTANCE_M)
    }
  }

  /**
   * Get the label's estimated latitude/longitude position from its pixel position within the panorama.
   *
   * The bearing to the label is exact projection geometry (`calculatePovFromPanoXY`), and the distance comes from
   * `estimateDistanceFromPanoM` — both depend only on the label's angular position, so the estimate is independent of
   * the panorama's resolution. The Explore front end runs the identical computation client-side (Label.js), fed the
   * same constants through the explore view; this server-side path serves AI label submissions.
   *
   * @param panoLat       The latitude of the panorama location
   * @param panoLng       The longitude of the panorama location
   * @param panoX         The x-coordinate of the label within the panorama image
   * @param panoY         The y-coordinate of the label within the panorama image
   * @param panoWidth     The width of the panorama image
   * @param panoHeight    The height of the panorama image
   * @param cameraHeading The heading of the camera with respect to true north in degrees
   * @return              A LatLng containing the estimated latitude and longitude
   */
  def toLatLng(
      panoLat: Double,
      panoLng: Double,
      panoX: Int,
      panoY: Int,
      panoWidth: Int,
      panoHeight: Int,
      cameraHeading: Double
  ): (Double, Double) = {
    val pov          = calculatePovFromPanoXY(panoX, panoY, panoWidth, panoHeight, cameraHeading)
    val estDistanceM = estimateDistanceFromPanoM(-pov.pitch)

    // Calculate destination point using haversine formula.
    CommonUtils.calculateDestination(panoLat, panoLng, estDistanceM / 1000.0, pov.heading)
  }
}

@ImplementedBy(classOf[PanoDataServiceImpl])
trait PanoDataService {

  /**
   * Requests the infra3D token using the client ID and secret stored in environment variables.
   * @param cityId One of "zurich-infra3d" or "winterthur-infra3d", as they have separate authentication tokens.
   * @return
   */
  def getInfra3dToken(cityId: String): Future[String]
  def panoExists(panoId: String, panoSource: PanoSource): Future[Option[Boolean]]
  def signUrl(urlString: String): String
  def getReusableImageryStatus(panoIds: Set[String]): Future[Map[String, Boolean]]
  def getImageUrl(panoId: String, panoSrc: PanoSource, heading: Double, pitch: Double, zoom: Double): Option[String]
  def getGsvImageUrlsForStreet(streetEdgeId: Int): Future[Seq[String]]
  def insertPanoHistories(histories: Seq[PanoHistorySubmission]): Future[Unit]
  def getAllPanos: Future[Seq[PanoDataSlim]]
  def checkForImagery: Future[String]
  def backupExists(panoId: String): Boolean
  def backupImageUrl(panoId: String): Option[String]
  def markHasBackup(panoId: String): Future[Int]
  def getCropDirectory: String
  def cropFile(labelId: Int, labelType: String): File
  def cropExists(labelId: Int, labelType: LabelTypeEnum.Base): Boolean
  def cropUrl(labelId: Int, labelType: LabelTypeEnum.Base): Option[String]
  def localBackupImageFile(panoId: String): Option[File]
  def getLocalBackupImage(panoId: String): Future[Option[PanoData]]
}

@Singleton
class PanoDataServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    cacheApi: AsyncCacheApi,
    ws: WSClient,
    implicit val ec: ExecutionContext,
    panoDataTable: PanoDataTable,
    panoHistoryTable: PanoHistoryTable,
    streetEdgeTable: models.street.StreetEdgeTable,
    signingService: ImageSigningService
)(implicit mat: Materializer)
    extends PanoDataService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  // Grab API key and secret from ENV variable.
  val googleApiKey: String    = config.get[String]("google-maps-api-key")
  val secretKeyString: String = config.get[String]("google-maps-secret")

  // Decode secret key as Byte[].
  val secretKey: Array[Byte] = Base64.getDecoder().decode(secretKeyString.replace('-', '+').replace('_', '/'))

  // Get an HMAC-SHA1 signing key from the raw key bytes.
  val sha1Key: SecretKeySpec = new SecretKeySpec(secretKey, "HmacSHA1")

  private val cropsDirName: String = getCropDirectory
  private val panosBaseDir: String =
    config.get[String]("pano.images.directory") + File.separator + config.get[String]("city-id")

  def getInfra3dToken(cityId: String): Future[String] = {
    // Token expires after 60 minutes, so we don't need to get a new token every time.
    cacheApi.getOrElseUpdate[String]("getInfra3dToken", Duration(30, "minutes")) {
      val cityName: String     = if (cityId == "winterthur-infra3d") "winterthur" else "zurich"
      val clientId: String     = config.get[String](s"infra3d-client-id-$cityName")
      val clientSecret: String = config.get[String](s"infra3d-client-secret-$cityName")
      val body                 = Map(
        "client_id"     -> clientId,
        "client_secret" -> clientSecret,
        "grant_type"    -> "client_credentials"
      )
      ws.url("https://uzh.auth.eu-west-1.amazoncognito.com/oauth2/token")
        .addHttpHeaders(
          "Content-Type" -> ContentTypes.FORM,
          "Accept"       -> "application/json"
        )
        .post(body)
        .map { response =>
          if (response.status == 200) {
            (response.json \ "access_token").as[String]
          } else {
            throw new RuntimeException(s"Token request failed with status ${response.status}: ${response.body}")
          }
        }
    }
  }

  /**
   * Checks whether the imagery for a label's panorama is still available, dispatching per imagery source.
   *
   * GSV and Mapillary are verified against their respective provider APIs. Infra3d (and any other source) is assumed
   * to always be available. A miss is only ever reported when the provider explicitly says the image is gone — network
   * errors, timeouts, auth failures, and other inconclusive responses return `None`.
   *
   * @param panoId     Panorama ID.
   * @param panoSource Imagery source the label was placed on.
   * @return           `Some(true)` if the imagery exists, `Some(false)` if not, `None` if inconclusive.
   */
  def panoExists(panoId: String, panoSource: PanoSource): Future[Option[Boolean]] = {
    panoSource match {
      case PanoSource.Gsv       => gsvPanoExists(panoId)
      case PanoSource.Mapillary => mapillaryPanoExists(panoId)
      case _                    => Future.successful(Some(true))
    }
  }

  /**
   * Looks up which of the given panos we already know the imagery-existence answer for, skipping a provider call.
   *
   * See `PanoDataTable.getReusableImageryStatus` for which rows qualify and why.
   *
   * @param panoIds Panos to look up.
   * @return        Pano ID -> whether its imagery exists, holding only the panos an answer is reusable for.
   */
  def getReusableImageryStatus(panoIds: Set[String]): Future[Map[String, Boolean]] = {
    if (panoIds.isEmpty) Future.successful(Map.empty)
    else db.run(panoDataTable.getReusableImageryStatus(panoIds, OffsetDateTime.now.minusDays(LiveImageryTtlDays)))
  }

  /**
   * Checks whether a GSV panorama still exists via the Street View metadata API.
   *
   * @param panoId Panorama ID.
   * @return       `Some(true)` if the imagery exists, `Some(false)` if not, `None` if inconclusive.
   */
  private def gsvPanoExists(panoId: String): Future[Option[Boolean]] = {
    val url = signUrl(s"https://maps.googleapis.com/maps/api/streetview/metadata?pano=$panoId&key=$googleApiKey")
    ws.url(url)
      .withRequestTimeout(5.seconds)
      .get()
      .flatMap { response =>
        val imageStatus          = (Json.parse(response.body) \ "status").as[String]
        val imageExists: Boolean = imageStatus == "OK"

        if (imageExists || imageStatus == "ZERO_RESULTS") {
          // Mark the expired status, has_backup, last_checked, and last_viewed columns in the db.
          val timestamp = OffsetDateTime.now
          val hasBackup = Some(backupExists(panoId))
          db.run(panoDataTable.updateExpiredStatus(panoId, !imageExists, hasBackup, timestamp))
            .map(_ => Some(imageExists))
        } else {
          // For any other response status, we don't want to assume that the panorama doesn't exist. Log it for now.
          logger.info(s"$imageStatus - $panoId")
          Future.successful(None)
        }
      }
      .recover {
        // Transient network errors don't mean the imagery is gone; treat as inconclusive.
        case _: SocketTimeoutException => None
        case _: IOException            => None
        // Anything else is unexpected: still inconclusive, but log it so the swallow is visible.
        case e: Exception =>
          logger.warn(s"Unexpected error checking GSV imagery for $panoId; treating as inconclusive.", e)
          None
      }
  }

  /**
   * Checks whether a Mapillary image still exists via the Graph API (`GET /:imageId`).
   *
   * @param panoId Mapillary image ID.
   * @return       `Some(true)` if the imagery exists, `Some(false)` if not, `None` if inconclusive.
   */
  private def mapillaryPanoExists(panoId: String): Future[Option[Boolean]] = {
    config.getOptional[String]("mapillary-access-token") match {
      case None =>
        logger.warn(s"No mapillary-access-token configured; cannot verify Mapillary imagery for $panoId.")
        Future.successful(None)
      case Some(accessToken) =>
        ws.url(s"https://graph.mapillary.com/$panoId?fields=id")
          .addHttpHeaders("Authorization" -> s"OAuth $accessToken")
          .withRequestTimeout(5.seconds)
          .get()
          .flatMap { response =>
            val timestamp = OffsetDateTime.now
            response.status match {
              case 200 if (Json.parse(response.body) \ "id").toOption.isDefined =>
                db.run(
                  panoDataTable.updateExpiredStatus(panoId, expired = false, Some(backupExists(panoId)), timestamp)
                ).map(_ => Some(true))
              case 404 =>
                db.run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(backupExists(panoId)), timestamp))
                  .map(_ => Some(false))
              case other =>
                // Inconclusive (auth, rate limit, 5xx, unexpected body). Don't assume the image is gone; log so we can
                // confirm how Mapillary actually signals a missing image and tighten this if needed.
                logger.info(s"Mapillary existence check inconclusive ($other) for $panoId: ${response.body}")
                Future.successful(None)
            }
          }
          .recover {
            // A transient network error doesn't mean the image is gone; treat as inconclusive.
            case _: SocketTimeoutException => None
            case _: IOException            => None
            // Anything else is unexpected: still inconclusive, but log it so the swallow is visible.
            case e: Exception =>
              logger.warn(s"Unexpected error checking Mapillary imagery for $panoId; treating as inconclusive.", e)
              None
          }
    }
  }

  /**
   * Signs a Google Maps request using a signing secret.
   * https://developers.google.com/maps/documentation/maps-static/get-api-key#dig-sig-manual
   */
  def signUrl(urlString: String): String = {
    // Convert to Java URL for easy parsing of URL parts.
    val url: URL = new URL(urlString)

    // Gets everything but URL protocol and host that we want to sign.
    val resource: String = url.getPath() + '?' + url.getQuery()

    // Get an HMAC-SHA1 Mac instance and initialize it with the HMAC-SHA1 key.
    val mac: Mac = Mac.getInstance("HmacSHA1")
    mac.init(sha1Key)

    // Compute the binary signature for the request.
    val sigBytes: Array[Byte] = mac.doFinal(resource.getBytes())

    // Base 64 encode the binary signature and convert the signature to 'web safe' base 64.
    val signature: String = Base64.getEncoder().encodeToString(sigBytes).replace('+', '-').replace('/', '_')

    // Return signed url.
    urlString + "&signature=" + signature
  }

  /**
   * Creates a URL that will retrieve a static image of the label's panorama from the Google Street View Static API.
   * Note that this URL returns the cropped image, but doesn't actually include the label.
   * More information here: https://developers.google.com/maps/documentation/streetview/intro
   *
   * @param panoId Id of gsv pano.
   * @param panoSrc The type of pano viewer the labels must have been added on (GSV, Mapillary, etc).
   * @param heading Compass heading of the camera.
   * @param pitch Up or down angle of the camera relative to the vehicle.
   * @param zoom Zoom level of the canvas (for fov calculation).
   * @return Image URL that represents the background of the label.
   */
  def getImageUrl(panoId: String, panoSrc: PanoSource, heading: Double, pitch: Double, zoom: Double): Option[String] = {
    if (panoSrc != PanoSource.Gsv) return None

    val url = "https://maps.googleapis.com/maps/api/streetview?" +
      "pano=" + panoId +
      "&size=" + LabelPointTable.canvasWidth + "x" + LabelPointTable.canvasHeight +
      "&heading=" + heading +
      "&pitch=" + pitch +
      "&fov=" + getFov(zoom) +
      "&key=" + googleApiKey
    Some(signUrl(url))
  }

  /**
   * Creates a URL that will retrieve a static image at the given lat/lng and heading from the GSV Static API.
   * Note that this URL returns the cropped image, but doesn't actually include the label.
   * More information here: https://developers.google.com/maps/documentation/streetview/intro
   *
   * @param lat Latitude of the location
   * @param lng Longitude of the location
   * @param heading Compass heading of the camera
   * @return GSV Static API URL for the given location and heading
   */
  def getGsvImageUrlFromLatLng(lat: Double, lng: Double, heading: Double): String = {
    val url = "https://maps.googleapis.com/maps/api/streetview?" +
      "location=" + lat + "," + lng +
      "&radius=40" + // Search as far as 40 meters from the given lat/lng, same as we use on the frontend
      "&source=outdoor" +
      "&size=640x640" + // 640x640 is the max size for the static API
      "&heading=" + heading +
      "&pitch=-10" + // Default pitch of -10 degrees, facing slightly downwards towards the ground
      "&fov=90" +
      "&return_error_code=true" +
      "&key=" + googleApiKey
    signUrl(url)
  }

  /**
   * Gets the image URLs for a street edge, which includes the start and end points of the street.
   * @param streetEdgeId ID of the street edge to get image URLs for
   * @return A sequence of image URLs for the start and end points of the street edge
   */
  def getGsvImageUrlsForStreet(streetEdgeId: Int): Future[Seq[String]] = {
    db.run(for {
      streetOption: Option[StreetEdge] <- streetEdgeTable.getStreet(streetEdgeId)
      startDir: Option[Double]         <- streetEdgeTable.directionFromStart(streetEdgeId)
      endDir: Option[Double]           <- streetEdgeTable.directionFromEnd(streetEdgeId)
    } yield {
      streetOption.fold(Seq.empty[String]) { street =>
        val startPoint: Point = street.geom.getStartPoint
        val endPoint: Point   = street.geom.getEndPoint
        Seq(
          startDir.map(sd => getGsvImageUrlFromLatLng(startPoint.getY, startPoint.getX, Math.toDegrees(sd))),
          endDir.map(ed => getGsvImageUrlFromLatLng(endPoint.getY, endPoint.getX, Math.toDegrees(ed)))
        ).flatten
      }
    })
  }

  def insertPanoHistories(histories: Seq[PanoHistorySubmission]): Future[Unit] = {
    db.run(DBIO.traverse(histories) { panoHist =>
      DBIO.sequence(
        Seq(
          panoDataTable.updatePanoHistorySaved(panoHist.currPanoId, Some(panoHist.panoHistorySaved)),
          DBIO.sequence(panoHist.history.map { h =>
            panoHistoryTable.insertIfNew(PanoHistory(h.panoId, h.date, panoHist.currPanoId))
          })
        )
      )
    }).map { _ => () }
  }

  def getAllPanos: Future[Seq[PanoDataSlim]] = db.run(panoDataTable.getAllPanos)

  /**
   * Checks if panos are expired on a nightly basis. Called from CheckImageExpiryActor.scala.
   *
   * Get as many as 5% of the panos with labels on them, or 5000, whichever is smaller (but at least
   * `minPanosToCheck`). Check if the panos are expired and update the database accordingly. Also re-check panos that
   * are already marked as expired to make sure that they weren't marked so incorrectly: a budget of 2.5% or 2500
   * (whichever is smaller) minus the number of unexpired panos checked, but at least `minPanosToCheck`.
   */
  def checkForImagery: Future[String] = {
    // Nightly floor for both sample sizes, so that checking always makes some progress: the percentage-based sizes
    // round to 0 on small corpora, and the expired budget zeroes out on nights when the unexpired queue is full.
    // getPanoIdsToCheckExpiration's take(n) caps at the stale pool, so the floor never overshoots (#4638).
    val minPanosToCheck: Int = 100
    db.run(
      for {
        // Choose a bunch of panos that haven't been checked in the past 3 months to check.
        nPanos: Int <- panoDataTable.countCheckablePanosWithLabels
        nUnexpiredPanosToCheck: Int =
          Math.max(minPanosToCheck, Math.min(MaxUnexpiredPanosPerSweep, (0.05 * nPanos).toInt))
        panosToCheck: Seq[(String, PanoSource)] <- panoDataTable
          .getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
        _ = logger.info(s"Checking ${panosToCheck.length} unexpired panos.")

        // Choose some panos that are already marked as expired to double-check.
        nExpiredPanosToCheck: Int =
          Math.max(minPanosToCheck, Math.min(2500, (0.025 * nPanos).toInt) - panosToCheck.length)
        expiredPanosToCheck: Seq[(String, PanoSource)] <-
          panoDataTable.getPanoIdsToCheckExpiration(nExpiredPanosToCheck, expired = true)
      } yield {
        logger.info(s"Checking ${expiredPanosToCheck.length} expired panos.")

        // Check each pano against whichever provider it came from, then log some stats.
        checkImageryBounded(panosToCheck ++ expiredPanosToCheck).map { responses =>
          s"Not expired: ${responses.count(_ == Some(true))}. Expired: ${responses.count(_ == Some(false))}. Errors: ${responses.count(_.isEmpty)}."
        }
      }
    ).flatten
  }

  /**
   * Runs `panoExists` over a batch of panos with at most `ImageryCheckConcurrency` checks in flight at once.
   *
   * @param panos Pano IDs paired with the imagery source to check each one against.
   * @return      One result per pano, in completion order: `Some(true)` exists, `Some(false)` gone, `None` unknown.
   */
  private def checkImageryBounded(panos: Seq[(String, PanoSource)]): Future[Seq[Option[Boolean]]] = {
    Source(panos.toVector)
      .mapAsyncUnordered(ImageryCheckConcurrency) { case (panoId, source) =>
        // One bad pano must not abort the sweep: the stream's default supervision would drop every pano not yet
        // pulled. The providers recover their own exceptions, so this only catches a throw before their Future exists.
        Future(panoExists(panoId, source)).flatten.recover { case NonFatal(e) =>
          logger.warn(s"Imagery check for $panoId threw; treating as inconclusive.", e)
          None
        }
      }
      .runWith(Sink.seq)
  }

  def getCropDirectory: String =
    config.get[String]("cropped.image.directory") + File.separator + config.get[String]("city-id")

  /** Checks whether a locally-hosted equirectangular backup image exists for the given pano. */
  def backupExists(panoId: String): Boolean = localBackupImageFile(panoId).isDefined

  /** Returns a signed URL for a pano's backup image if it exists, or None otherwise. */
  def backupImageUrl(panoId: String): Option[String] =
    if (backupExists(panoId)) Some(signingService.signedUrl(s"/backupImage/$panoId")) else None

  /** Sets has_backup = true for the given pano (no-op when it's already true). */
  def markHasBackup(panoId: String): Future[Int] = db.run(panoDataTable.markHasBackup(panoId))

  /** Returns the on-disk file where a label's crop image is (or would be) stored. */
  def cropFile(labelId: Int, labelType: String): File =
    new File(cropsDirName + File.separator + labelType + File.separator + "crop_" + labelId + ".png")

  /** Checks whether a crop image file exists for the given label. */
  def cropExists(labelId: Int, labelType: LabelTypeEnum.Base): Boolean =
    cropFile(labelId, labelType.name).exists()

  /** Returns a signed crop image URL if a crop file exists for the given label, or None otherwise. */
  def cropUrl(labelId: Int, labelType: LabelTypeEnum.Base): Option[String] =
    if (cropExists(labelId, labelType)) Some(signingService.signedUrl(s"/cropImage/${labelType.name}/$labelId"))
    else None

  /**
   * Returns the on-disk file for a self-hosted pano image if one exists on the filesystem. Images are stored at
   * `<pano.images.directory>/<city-id>/<panoId[0:2]>/<panoId>.<ext>`. Tries jpg/jpeg/png in order.
   */
  def localBackupImageFile(panoId: String): Option[File] = {
    val dir = new File(panosBaseDir, panoId.take(2))
    Seq("jpg", "jpeg", "png").iterator
      .map(ext => new File(dir, s"$panoId.$ext"))
      .find(_.exists())
  }

  /**
   * Returns the pano_data row for a pano if a self-hosted image exists AND all required fields are populated.
   *
   * "Required" means what PannellumViewer needs to render the backup; the columns mirror `PanoData`'s
   * `requiredParams` (public/js/common/pano-viewer/src/PanoData.js) — see the note there before changing them.
   */
  def getLocalBackupImage(panoId: String): Future[Option[PanoData]] = {
    if (localBackupImageFile(panoId).isEmpty) {
      Future.successful(None)
    } else {
      db.run(panoDataTable.getPano(panoId))
        .map(
          _.filter(p =>
            p.width.isDefined && p.height.isDefined && p.lat.isDefined && p.lng.isDefined && p.cameraHeading.isDefined && p.cameraPitch.isDefined
          )
        )
    }
  }
}
