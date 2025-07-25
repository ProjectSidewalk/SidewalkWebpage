package service

import com.google.inject.ImplementedBy
import formats.json.PanoHistoryFormats.PanoHistorySubmission
import models.gsv.{GsvDataSlim, GsvDataTable, PanoHistory, PanoHistoryTable}
import models.label.LabelPointTable
import models.street.StreetEdge
import models.utils.MyPostgresProfile
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
}

@ImplementedBy(classOf[GsvDataServiceImpl])
trait GsvDataService {
  def panoExists(gsvPanoId: String): Future[Option[Boolean]]
  def getImageUrl(gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int): String
  def getImageUrlsForStreet(streetEdgeId: Int): Future[Seq[String]]
  def insertPanoHistories(histories: Seq[PanoHistorySubmission]): Future[Unit]
  def getAllPanosWithLabels: Future[Seq[GsvDataSlim]]
  def checkForGsvImagery(): Future[Unit]
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
      .map { response =>
        val imageStatus = (Json.parse(response.body) \ "status").as[String]
        val imageExists = imageStatus == "OK"

        // Mark the expired status, last_checked, and last_viewed columns in the db.
        val timestamp = OffsetDateTime.now
        gsvDataTable.updateExpiredStatus(gsvPanoId, !imageExists, timestamp)

        Some(imageExists)
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
  def getImageUrl(gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int): String = {
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

  def getAllPanosWithLabels: Future[Seq[GsvDataSlim]] = db.run(gsvDataTable.getAllPanosWithLabels)

  /**
   * Checks if panos are expired on a nightly basis. Called from CheckImageExpiryActor.scala.
   *
   * Get as many as 5% of the panos with labels on them, or 1000, whichever is smaller. Check if the panos are expired
   * and update the database accordingly. If there aren't enough of those remaining that haven't been checked in the
   * last 6 months, check up to 2.5% or 500 (which ever is smaller) of the panos that are already marked as expired to
   * make sure that they weren't marked so incorrectly.
   */
  def checkForGsvImagery(): Future[Unit] = {
    db.run(
      for {
        // Choose a bunch of panos that haven't been checked in the past 6 months to check.
        nPanos: Int <- gsvDataTable.countPanosWithLabels
        nUnexpiredPanosToCheck: Int = Math.max(1000, Math.min(20, 0.05 * nPanos).toInt)
        panoIdsToCheck: Seq[String] <- gsvDataTable.getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
        _ = logger.info(s"Checking ${panoIdsToCheck.length} unexpired panos.")

        // Choose a few panos that are already marked as expired to double-check.
        nExpiredPanosToCheck: Int = Math.max(500, Math.min(10, 0.025 * nPanos).toInt)
        expiredPanoIdsToCheck: Seq[String] <-
          if (panoIdsToCheck.length < nExpiredPanosToCheck) {
            val nRemainingExpiredPanosToCheck: Int = nExpiredPanosToCheck - panoIdsToCheck.length
            gsvDataTable.getPanoIdsToCheckExpiration(nRemainingExpiredPanosToCheck, expired = true)
          } else DBIO.successful(Seq())
      } yield {
        logger.info(s"Checking ${expiredPanoIdsToCheck.length} expired panos.")

        // Run the panoExists function to check for imagery, then log some stats.
        Future.traverse(panoIdsToCheck ++ expiredPanoIdsToCheck) { panoId => panoExists(panoId) }.map { responses =>
          logger.info(
            s"Not expired: ${responses.count(_ == Some(true))}. Expired: ${responses.count(_ == Some(false))}. Errors: ${responses.count(_.isEmpty)}."
          )
        }
      }
    ).flatten
  }
}
