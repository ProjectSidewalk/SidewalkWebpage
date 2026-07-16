package service

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTable
import models.pano.PanoSource
import models.street.{StreetImageryTable, StreetToPoll}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsArray, Json}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import java.io.IOException
import java.net.SocketTimeoutException
import java.time.{Instant, LocalDate, ZoneOffset}
import javax.inject._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/**
 * Keeps the app's imagery-age knowledge (street_imagery) fresh and syncs the audit_task.outdated_imagery flag against
 * it (#4384). An audit performed on since-replaced imagery keeps its user credit but stops counting toward routing
 * and completion, so labelers are re-sent down re-imaged streets and "% complete" means "audited with current
 * imagery".
 *
 * Freshness data arrives two ways: refreshFromPanoData harvests capture dates from panos users observe while labeling
 * (zero API cost, but blind to streets nobody visits), and pollImageryAges actively queries the city's imagery
 * provider for a nightly batch of streets -- the piece that detects new imagery on "done" streets nobody is sent to.
 */
@ImplementedBy(classOf[ImageryFreshnessServiceImpl])
trait ImageryFreshnessService {
  def syncImageryFreshness: Future[ImageryFreshnessService.SyncResult]
  def pollImageryAges(): Future[String]
}

object ImageryFreshnessService {

  /**
   * Outcome of one freshness sync.
   *
   * @param streetsRefreshed street_imagery rows inserted or updated from recently-labeled panos.
   * @param auditsFlagged    Completed audits newly flagged as outdated_imagery.
   * @param auditsUnflagged  Audits whose outdated_imagery flag was cleared.
   */
  case class SyncResult(streetsRefreshed: Int, auditsFlagged: Int, auditsUnflagged: Int)

  /** One pano seen at a sample point: its provider id and its capture date, when one was parseable. */
  case class PanoObservation(panoId: String, capture: Option[LocalDate])

  /**
   * Standardizes a GSV capture-date string of varying precision to a date, exactly like the evolution-326 backfill
   * and check_streets_for_imagery.py's standardize_capture_date: `YYYY` becomes January 1st, `YYYY-MM` the 1st, and
   * anything unparseable is dropped. GSV most commonly returns month precision.
   */
  def parseGsvCaptureDate(raw: String): Option[LocalDate] = {
    val trimmed = Option(raw).map(_.trim).getOrElse("")
    trimmed match {
      case s if s.matches("""\d{4}-\d{2}-\d{2}""") => Try(LocalDate.parse(s)).toOption
      case s if s.matches("""\d{4}-\d{2}""")       => Try(LocalDate.parse(s + "-01")).toOption
      case s if s.matches("""\d{4}""")             => Try(LocalDate.parse(s + "-01-01")).toOption
      case _                                       => None
    }
  }

  /**
   * Converts a Mapillary captured_at (Unix epoch milliseconds) to a date, dropping implausible values. Mapillary
   * timestamps come from contributor device clocks, so epoch-zero, pre-2004 (before street-level imagery existed),
   * and future values are treated as unknown rather than trusted.
   */
  def parseMapillaryCapturedAt(capturedAtMs: Long, now: LocalDate = LocalDate.now(ZoneOffset.UTC)): Option[LocalDate] =
    Try(Instant.ofEpochMilli(capturedAtMs).atOffset(ZoneOffset.UTC).toLocalDate).toOption
      .filter(d => capturedAtMs > 0 && d.getYear >= 2004 && !d.isAfter(now))

  /** Half-widths of a bbox approximating a circle of the given radius (meters) around a point, in degrees. */
  def bboxHalfWidths(latDegrees: Double, radiusMeters: Double): (Double, Double) = {
    val dLat = radiusMeters / 111320.0
    // Longitude degrees shrink with latitude; clamp the divisor so polar-adjacent junk can't divide by ~zero.
    val dLng = dLat / math.max(0.01, math.cos(math.toRadians(latDegrees)))
    (dLat, dLng)
  }
}

@Singleton
class ImageryFreshnessServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    ws: WSClient,
    configService: ConfigService,
    panoDataService: PanoDataService,
    streetImageryTable: StreetImageryTable,
    auditTaskTable: AuditTaskTable,
    implicit val ec: ExecutionContext
) extends ImageryFreshnessService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import ImageryFreshnessService._
  import models.utils.MyPostgresProfile.api._

  private val logger = Logger(this.getClass)

  private val pollBatchSize: Int   = config.get[Int]("street-imagery-poll.batch-size")
  private val googleApiKey: String = config.get[String]("google-maps-api-key")

  // 25m matches check_streets_for_imagery.py's endpoint radius: wide enough to catch imagery on the roadway, narrow
  // enough not to routinely pick up a parallel street.
  private val SampleRadiusMeters = 25.0

  /**
   * Refreshes street_imagery from recently-labeled panos, then syncs outdated_imagery flags against it.
   *
   * Ordering contract: this must run BEFORE recalculateStreetPriority and the region_completion rebuild (see
   * RecalculateStreetPriorityActor), and only there. Flags changing exclusively in that nightly sequence keeps
   * street_edge_priority and region_completion consistent with the flags, and keeps the priority-1.0-crossing
   * increment in ExploreService.updateStreetPriority sound during the day.
   */
  def syncImageryFreshness: Future[SyncResult] = {
    db.run((for {
      streetsRefreshed     <- streetImageryTable.refreshFromPanoData
      (flagged, unflagged) <- auditTaskTable.syncOutdatedImageryFlags
    } yield SyncResult(streetsRefreshed, flagged, unflagged)).transactionally)
  }

  /**
   * Polls the city's imagery provider for the current capture dates on a nightly batch of streets (#4384).
   *
   * Streets are chosen by StreetImageryTable.streetsToPoll (audited first, least-recently-polled first) and processed
   * sequentially -- one street at a time, its three sample points in parallel -- so the load on the provider stays
   * gentle and bounded. GSV Street View metadata requests are free of charge; Mapillary Graph API requests are free
   * within rate limits. A street with any inconclusive sample point (auth failure, timeout, unexpected status) is
   * skipped entirely and left un-bumped so the next night's rotation retries it; in dev, where dummy API keys make
   * every call inconclusive, the whole poll is a harmless no-op.
   *
   * @return A human-readable summary for the actor log.
   */
  def pollImageryAges(): Future[String] = {
    configService.getPanoSource match {
      case PanoSource.Gsv       => pollStreets("GSV")(fetchGsvPointObservations)
      case PanoSource.Mapillary =>
        config.getOptional[String]("mapillary-access-token") match {
          case Some(token) => pollStreets("Mapillary")(fetchMapillaryPointObservations(token))
          case None        => Future.successful("No mapillary-access-token configured; skipping imagery-age poll.")
        }
      case other => Future.successful(s"Imagery-age polling isn't supported for provider $other; skipping.")
    }
  }

  /**
   * Runs the poll loop for one batch of streets against a provider-specific point fetcher.
   *
   * @param providerName For the summary string.
   * @param fetchPoint   Queries one (lat, lng) sample point: Some(panos seen) on a conclusive answer (possibly
   *                     empty = confirmed no imagery), None when inconclusive.
   */
  private def pollStreets(
      providerName: String
  )(fetchPoint: (Double, Double) => Future[Option[Seq[PanoObservation]]]): Future[String] = {
    db.run(streetImageryTable.streetsToPoll(pollBatchSize)).flatMap { streets =>
      streets
        .foldLeft(Future.successful((0, 0))) { case (accFuture, street) =>
          accFuture.flatMap { case (polled, skipped) =>
            pollOneStreet(street, fetchPoint).map(ok => if (ok) (polled + 1, skipped) else (polled, skipped + 1))
          }
        }
        .map { case (polled, skipped) =>
          s"$providerName imagery-age poll: $polled streets updated, $skipped skipped (of ${streets.size} selected)."
        }
    }
  }

  /**
   * Polls one street's sample points and upserts its street_imagery row.
   *
   * @return true if the street was conclusively polled and upserted, false if it was skipped as inconclusive.
   */
  private def pollOneStreet(
      street: StreetToPoll,
      fetchPoint: (Double, Double) => Future[Option[Seq[PanoObservation]]]
  ): Future[Boolean] = {
    Future.sequence(street.points.map { case (lat, lng) => fetchPoint(lat, lng) }).flatMap { results =>
      if (results.exists(_.isEmpty)) {
        Future.successful(false)
      } else {
        // Panos can be seen from more than one sample point; dedupe by provider id before counting.
        val panos = results.flatten.flatten.groupBy(_.panoId).map(_._2.head).toSeq
        val dates = panos.flatMap(_.capture)
        db.run(streetImageryTable.upsertFromPoll(street.streetEdgeId, dates.minOption, dates.maxOption, panos.size))
          .map(_ => true)
      }
    }
  }

  /**
   * Queries the free GSV Street View metadata endpoint for the pano currently served at a point. The endpoint returns
   * only the single nearest pano (typically Google's newest drive at that location), with month-precision dates.
   */
  private def fetchGsvPointObservations(lat: Double, lng: Double): Future[Option[Seq[PanoObservation]]] = {
    val url = panoDataService.signUrl(
      s"https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor" +
        s"&location=$lat,$lng&radius=${SampleRadiusMeters.toInt}&key=$googleApiKey"
    )
    ws.url(url)
      .withRequestTimeout(5.seconds)
      .get()
      .map { response =>
        val json = Json.parse(response.body)
        (json \ "status").asOpt[String] match {
          case Some("OK") =>
            val panoId = (json \ "pano_id").asOpt[String].getOrElse("")
            val date   = (json \ "date").asOpt[String].flatMap(parseGsvCaptureDate)
            Some(Seq(PanoObservation(panoId, date)))
          case Some("ZERO_RESULTS") => Some(Seq.empty)
          case other                =>
            // REQUEST_DENIED (e.g. dev dummy keys), OVER_QUERY_LIMIT, etc.: inconclusive, skip the street.
            logger.info(s"GSV imagery-age poll inconclusive (${other.getOrElse("no status")}) at $lat,$lng")
            None
        }
      }
      .recover {
        // Transient network errors are inconclusive, not "no imagery".
        case _: SocketTimeoutException => None
        case _: IOException            => None
        case e: Exception              =>
          logger.warn(s"Unexpected error polling GSV imagery age at $lat,$lng; treating as inconclusive.", e)
          None
      }
  }

  /**
   * Queries the Mapillary Graph API for panos in a small bbox around a point. Only 360° panos count (is_pano), since
   * that's what the Mapillary pano viewer serves to labelers; captured_at device-clock timestamps are sanity-clamped.
   */
  private def fetchMapillaryPointObservations(
      accessToken: String
  )(lat: Double, lng: Double): Future[Option[Seq[PanoObservation]]] = {
    val (dLat, dLng) = bboxHalfWidths(lat, SampleRadiusMeters)
    val bbox         = s"${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}"
    ws.url(s"https://graph.mapillary.com/images?bbox=$bbox&fields=id,captured_at,is_pano&limit=100")
      .addHttpHeaders("Authorization" -> s"OAuth $accessToken")
      .withRequestTimeout(5.seconds)
      .get()
      .map { response =>
        response.status match {
          case 200 =>
            val images = (Json.parse(response.body) \ "data").asOpt[JsArray].map(_.value).getOrElse(Seq.empty)
            Some(images.toSeq.collect {
              case img if (img \ "is_pano").asOpt[Boolean].contains(true) =>
                val id   = (img \ "id").asOpt[String].getOrElse("")
                val date = (img \ "captured_at").asOpt[Long].flatMap(ms => parseMapillaryCapturedAt(ms))
                PanoObservation(id, date)
            })
          case other =>
            // Auth failures, rate limits, 5xx: inconclusive, skip the street and retry another night.
            logger.info(s"Mapillary imagery-age poll inconclusive ($other) at $lat,$lng")
            None
        }
      }
      .recover {
        case _: SocketTimeoutException => None
        case _: IOException            => None
        case e: Exception              =>
          logger.warn(s"Unexpected error polling Mapillary imagery age at $lat,$lng; treating as inconclusive.", e)
          None
      }
  }
}
