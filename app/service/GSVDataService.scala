package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import formats.json.PanoHistoryFormats.PanoHistorySubmission
import models.gsv.{GSVDataTable, PanoHistory, PanoHistoryTable}
import models.label.LabelPointTable
import models.utils.MyPostgresProfile
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.Json
import play.api.libs.ws.WSClient
import service.utils.ConfigService

import java.io.IOException
import java.net.{SocketTimeoutException, URL}
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import scala.concurrent.duration.DurationInt

@ImplementedBy(classOf[GSVDataServiceImpl])
trait GSVDataService {
  def panoExists(gsvPanoId: String): Future[Option[Boolean]]
  def getImageUrl(gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int): String
  def insertPanoHistories(histories: Seq[PanoHistorySubmission])
}

@Singleton
class GSVDataServiceImpl @Inject()(
                                    protected val dbConfigProvider: DatabaseConfigProvider,
                                    config: Configuration,
                                    ws: WSClient,
                                    implicit val ec: ExecutionContext,
                                    configService: ConfigService,
                                    gsvDataTable: GSVDataTable,
                                    panoHistoryTable: PanoHistoryTable
                                 ) extends GSVDataService with HasDatabaseConfigProvider[MyPostgresProfile] {
  //  import profile.api._

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
    val url = s"https://maps.googleapis.com/maps/api/streetview/metadata?pano=$gsvPanoId&key=${config.get[String]("google-maps-api-key")}"
    val signedUrl = signUrl(url)

    ws.url(signedUrl)
      .withRequestTimeout(5.seconds)
      .get()
      .map { response =>
        val imageStatus = (Json.parse(response.body) \ "status").as[String]
        val imageExists = imageStatus == "OK"

        // Mark the expired status, last_checked, and last_viewed columns in the db.
        val timestamp = new Timestamp(Instant.now.toEpochMilli)
        gsvDataTable.updateExpiredStatus(gsvPanoId, !imageExists, timestamp)

        Some(imageExists)
      }
      .recover { // If there was an exception, don't assume it means a lack of GSV imagery.
        case _: SocketTimeoutException => None
        case _: IOException => None
        case _: Exception => None
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
   * Retrieves the static image of the label panorama from the Google Street View Static API.
   * Note that this returns the image of the panorama, but doesn't actually include the label.
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
   * Hacky fix to generate the FOV for an image.
   * Determined experimentally.
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

  def insertPanoHistories(histories: Seq[PanoHistorySubmission]) = {
    histories.foreach { panoHist =>
      // First, update the panorama that shows up for the current location in the GSVDataTable.
      gsvDataTable.updatePanoHistorySaved(panoHist.currPanoId, Some(new Timestamp(panoHist.panoHistorySaved)))

      // Add all historic panoramas at the current location.
      panoHist.history.foreach { h => panoHistoryTable.insert(PanoHistory(h.panoId, h.date, panoHist.currPanoId)) }
    }
  }
}
