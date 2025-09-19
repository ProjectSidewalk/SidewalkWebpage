package service

import com.google.inject.ImplementedBy
import formats.json.PanoHistoryFormats.PanoHistorySubmission
import models.gsv.{GsvDataSlim, GsvDataTable, PanoHistory, PanoHistoryTable}
import models.label.{LabelPointTable, POV}
import models.street.StreetEdge
import models.utils.{CommonUtils, MyPostgresProfile}
import org.locationtech.jts.geom.Point
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.Json
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import service.GsvDataService.getFov
import slick.dbio.DBIO

import java.io.IOException
import java.net.{SocketTimeoutException, URL}
import java.time.OffsetDateTime
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

/**
 * Companion object with constants and functions that are shared throughout codebase, that shouldn't require injection.
 */
object GsvDataService {

  /**
   * Hacky fix to generate the FOV for an image. Determined experimentally.
   * @param zoom Zoom level of the canvas (for fov calculation).
   * @return FOV of image
   */
  def getFov(zoom: Int): Double = {
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
      1 // Just defaulting to a zoom level of 1 since the AI looked at the whole pano and had no zoom.
    )
  }

  /**
   * Parameters determined from a series of linear regressions. Here links to the analysis and relevant Github issues:
   * - https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
   * - https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2374
   * - https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2362
   */
  case class LatLngEstimationParams(
      headingIntercept: Double,
      headingCanvasXSlope: Double,
      distanceIntercept: Double,
      distancePanoYSlope: Double,
      distanceCanvasYSlope: Double
  )

  object LatLngEstimationParams {
    val LATLNG_ESTIMATION_PARAMS: Map[Int, LatLngEstimationParams] = Map(
      1 -> LatLngEstimationParams(
        headingIntercept = -51.2401711, headingCanvasXSlope = 0.1443374, distanceIntercept = 18.6051843,
        distancePanoYSlope = 0.0138947, distanceCanvasYSlope = 0.0011023
      ),
      2 -> LatLngEstimationParams(
        headingIntercept = -27.5267447, headingCanvasXSlope = 0.0784357, distanceIntercept = 20.8794248,
        distancePanoYSlope = 0.0184087, distanceCanvasYSlope = 0.0022135
      ),
      3 -> LatLngEstimationParams(
        headingIntercept = -13.5675945, headingCanvasXSlope = 0.0396061, distanceIntercept = 25.2472682,
        distancePanoYSlope = 0.0264216, distanceCanvasYSlope = 0.0011071
      )
    )
  }

  /**
   * Get the label's estimated latitude/longitude position.
   *
   * Estimates heading difference and distance from panorama using output from regression analysis.
   * https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
   *
   * @param panoLat The latitude of the panorama location
   * @param panoLng The longitude of the panorama location
   * @param heading The user's with respect to true north in degrees
   * @param zoom The zoom level (1, 2, or 3)
   * @param canvasX The x-coordinate on the canvas
   * @param canvasY The y-coordinate on the canvas
   * @param panoY The y-coordinate within the panorama
   * @param panoHeight The height of the panorama
   * @return A LatLng containing the estimated latitude and longitude
   */
  def toLatLng(
      panoLat: Double,
      panoLng: Double,
      heading: Double,
      zoom: Int,
      canvasX: Int,
      canvasY: Int,
      panoY: Int,
      panoHeight: Int
  ): (Double, Double) = {
    val params = LatLngEstimationParams.LATLNG_ESTIMATION_PARAMS(zoom)

    // Estimate heading difference and distance from pano using regression analysis output.
    val estHeadingDiff =
      params.headingIntercept + params.headingCanvasXSlope * canvasX

    val estDistanceFromPanoKm = math.max(
      0.0,
      params.distanceIntercept +
        params.distancePanoYSlope * (panoHeight / 2 - panoY) +
        params.distanceCanvasYSlope * canvasY
    ) / 1000.0

    val estHeading = heading + estHeadingDiff

    // Calculate destination point using haversine formula.
    CommonUtils.calculateDestination(panoLat, panoLng, estDistanceFromPanoKm, estHeading)
  }
}

@ImplementedBy(classOf[GsvDataServiceImpl])
trait GsvDataService {
  def panoExists(gsvPanoId: String): Future[Option[Boolean]]
  def getImageUrl(gsvPanoramaId: String, heading: Double, pitch: Double, zoom: Int): String
  def getImageUrlsForStreet(streetEdgeId: Int): Future[Seq[String]]
  def insertPanoHistories(histories: Seq[PanoHistorySubmission]): Future[Unit]
  def getAllPanos: Future[Seq[GsvDataSlim]]
  def checkForGsvImagery: Future[String]
}

@Singleton
class GsvDataServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    ws: WSClient,
    implicit val ec: ExecutionContext,
    gsvDataTable: GsvDataTable,
    panoHistoryTable: PanoHistoryTable,
    streetEdgeTable: models.street.StreetEdgeTable
) extends GsvDataService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  // Grab secret from ENV variable.
  val secretKeyString: String = config.get[String]("google-maps-secret")

  // Decode secret key as Byte[].
  val secretKey: Array[Byte] = Base64.getDecoder().decode(secretKeyString.replace('-', '+').replace('_', '/'))

  // Get an HMAC-SHA1 signing key from the raw key bytes.
  val sha1Key: SecretKeySpec = new SecretKeySpec(secretKey, "HmacSHA1")

  /**
   * Checks if the panorama associated with a label exists by pinging Google Maps.
   *
   * @param gsvPanoId  Panorama ID
   * @return           True if the panorama exists, false otherwise
   */
  def panoExists(gsvPanoId: String): Future[Option[Boolean]] = {
    val url =
      s"https://maps.googleapis.com/maps/api/streetview/metadata?pano=$gsvPanoId&key=${config.get[String]("google-maps-api-key")}"
    val signedUrl = signUrl(url)

    ws.url(signedUrl)
      .withRequestTimeout(5.seconds)
      .get()
      .flatMap { response =>
        val imageStatus          = (Json.parse(response.body) \ "status").as[String]
        val imageExists: Boolean = imageStatus == "OK"

        if (imageExists || imageStatus == "ZERO_RESULTS") {
          // Mark the expired status, last_checked, and last_viewed columns in the db.
          val timestamp = OffsetDateTime.now
          db.run(gsvDataTable.updateExpiredStatus(gsvPanoId, !imageExists, timestamp)).map(_ => Some(imageExists))
        } else {
          // For any other response status, we don't want to assume that the panorama doesn't exist. Log it for now.
          logger.info(s"$imageStatus - $gsvPanoId")
          Future.successful(None)
        }

      }
      .recover { // If there was an exception, don't assume it means a lack of GSV imagery.
        case _: SocketTimeoutException => None
        case _: IOException            => None
        case _: Exception              => None
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
   * @param gsvPanoramaId Id of gsv pano.
   * @param heading Compass heading of the camera.
   * @param pitch Up or down angle of the camera relative to the Street View vehicle.
   * @param zoom Zoom level of the canvas (for fov calculation).
   * @return Image URL that represents the background of the label.
   */
  def getImageUrl(gsvPanoramaId: String, heading: Double, pitch: Double, zoom: Int): String = {
    val url = "https://maps.googleapis.com/maps/api/streetview?" +
      "pano=" + gsvPanoramaId +
      "&size=" + LabelPointTable.canvasWidth + "x" + LabelPointTable.canvasHeight +
      "&heading=" + heading +
      "&pitch=" + pitch +
      "&fov=" + getFov(zoom) +
      "&key=" + config.get[String]("google-maps-api-key")
    signUrl(url)
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
  def getImageUrlFromLatLng(lat: Double, lng: Double, heading: Double): String = {
    val url = "https://maps.googleapis.com/maps/api/streetview?" +
      "location=" + lat + "," + lng +
      "&radius=40" + // Search as far as 40 meters from the given lat/lng, same as we use on the frontend
      "&source=outdoor" +
      "&size=640x640" + // 640x640 is the max size for the static API
      "&heading=" + heading +
      "&pitch=-10" + // Default pitch of -10 degrees, facing slightly downwards towards the ground
      "&fov=90" +
      "&return_error_code=true" +
      "&key=" + config.get[String]("google-maps-api-key")
    signUrl(url)
  }

  /**
   * Gets the image URLs for a street edge, which includes the start and end points of the street.
   * @param streetEdgeId ID of the street edge to get image URLs for
   * @return A sequence of image URLs for the start and end points of the street edge
   */
  def getImageUrlsForStreet(streetEdgeId: Int): Future[Seq[String]] = {
    db.run(for {
      streetOption: Option[StreetEdge] <- streetEdgeTable.getStreet(streetEdgeId)
      startDir: Option[Float]          <- streetEdgeTable.directionFromStart(streetEdgeId)
      endDir: Option[Float]            <- streetEdgeTable.directionFromEnd(streetEdgeId)
    } yield {
      streetOption.fold(Seq.empty[String]) { street =>
        val startPoint: Point = street.geom.getStartPoint
        val endPoint: Point   = street.geom.getEndPoint
        Seq(
          startDir.map(sd => getImageUrlFromLatLng(startPoint.getY, startPoint.getX, Math.toDegrees(sd.toDouble))),
          endDir.map(ed => getImageUrlFromLatLng(endPoint.getY, endPoint.getX, Math.toDegrees(ed.toDouble)))
        ).flatten
      }
    })
  }

  def insertPanoHistories(histories: Seq[PanoHistorySubmission]): Future[Unit] = {
    db.run(DBIO.traverse(histories) { panoHist =>
      DBIO.sequence(
        Seq(
          gsvDataTable.updatePanoHistorySaved(panoHist.currPanoId, Some(panoHist.panoHistorySaved)),
          DBIO.sequence(panoHist.history.map { h =>
            panoHistoryTable.insertIfNew(PanoHistory(h.panoId, h.date, panoHist.currPanoId))
          })
        )
      )
    }).map { _ => () }
  }

  def getAllPanos: Future[Seq[GsvDataSlim]] = db.run(gsvDataTable.getAllPanos)

  /**
   * Checks if panos are expired on a nightly basis. Called from CheckImageExpiryActor.scala.
   *
   * Get as many as 5% of the panos with labels on them, or 5000, whichever is smaller. Check if the panos are expired
   * and update the database accordingly. If there aren't enough of those remaining that haven't been checked in the
   * last 3 months, check up to 2.5% or 2500 (whichever is smaller) of the panos that are already marked as expired to
   * make sure that they weren't marked so incorrectly.
   */
  def checkForGsvImagery: Future[String] = {
    db.run(
      for {
        // Choose a bunch of panos that haven't been checked in the past 6 months to check.
        nPanos: Int <- gsvDataTable.countPanosWithLabels
        nUnexpiredPanosToCheck: Int = Math.max(5000, Math.min(100, 0.05 * nPanos).toInt)
        panoIdsToCheck: Seq[String] <- gsvDataTable.getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
        _ = logger.info(s"Checking ${panoIdsToCheck.length} unexpired panos.")

        // Choose a few panos that are already marked as expired to double-check.
        nExpiredPanosToCheck: Int = Math.max(2500, Math.min(50, 0.025 * nPanos).toInt)
        expiredPanoIdsToCheck: Seq[String] <-
          if (panoIdsToCheck.length < nExpiredPanosToCheck) {
            val nRemainingExpiredPanosToCheck: Int = nExpiredPanosToCheck - panoIdsToCheck.length
            gsvDataTable.getPanoIdsToCheckExpiration(nRemainingExpiredPanosToCheck, expired = true)
          } else DBIO.successful(Seq())
      } yield {
        logger.info(s"Checking ${expiredPanoIdsToCheck.length} expired panos.")

        // Run the panoExists function to check for imagery, then log some stats.
        Future.traverse(panoIdsToCheck ++ expiredPanoIdsToCheck) { panoId => panoExists(panoId) }.map { responses =>
          s"Not expired: ${responses.count(_ == Some(true))}. Expired: ${responses.count(_ == Some(false))}. Errors: ${responses.count(_.isEmpty)}."
        }
      }
    ).flatten
  }
}
