package service

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTable
import models.pano.PanoSource
import models.street.{PolledPano, StreetImageryTable, StreetReopenCandidateTable, StreetToPoll}
import models.utils.MyPostgresProfile
import org.locationtech.jts.geom.LineString
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
 * it (#4384). An audit is flagged only when at least half the street's sampled points show newer imagery than the
 * audit (street_imagery.median_newest_capture, written by the nightly imagery-age poll below). A flagged audit keeps
 * its user credit and keeps counting toward completion stats, but counts at a capped half weight in the
 * street-priority formula and stops counting for per-user routing -- so labelers are re-sent down re-imaged streets
 * (after unaudited ones) while "% complete" keeps meaning "ever quality-audited", with freshness surfaced separately
 * (km_needs_reaudit, re-audit prompts).
 *
 * Freshness data arrives two ways: refreshFromPanoData harvests capture dates from panos users observe while labeling
 * (zero API cost, but blind to streets nobody visits, and never a source of flags), and pollImageryAges actively
 * queries the city's imagery provider at fixed sample points for a nightly batch of streets -- the only feeder
 * systematic enough to write the median the flag sync compares against.
 */
@ImplementedBy(classOf[ImageryFreshnessServiceImpl])
trait ImageryFreshnessService {
  def syncImageryFreshness: Future[ImageryFreshnessService.SyncResult]
  def pollImageryAges(): Future[ImageryFreshnessService.PollResult]
}

object ImageryFreshnessService {

  /**
   * Outcome of one freshness sync.
   *
   * @param streetsRefreshed street_imagery rows inserted or updated from recently-viewed panos.
   * @param auditsFlagged    Completed audits newly flagged as outdated_imagery.
   * @param auditsUnflagged  Audits whose outdated_imagery flag was cleared.
   */
  case class SyncResult(streetsRefreshed: Int, auditsFlagged: Int, auditsUnflagged: Int)

  /**
   * Outcome of one nightly imagery-age poll.
   *
   * Counts, not just a log line, because the rotation is the only feeder that can write the median the re-audit flag
   * compares against: a poll that quietly stops looks exactly like a city whose imagery never changes, and the
   * difference is only visible in how much of the rotation each night actually covered.
   *
   * @param provider                 Provider queried, or None when the poll never reached one.
   * @param streetsSelected          Streets the rotation picked for this batch.
   * @param streetsPolled            Streets that answered conclusively and had their street_imagery row refreshed.
   * @param streetsSkipped           Streets left un-bumped after an inconclusive answer, so the next night retries
   *                                 them.
   * @param notPolledReason          Why no street was polled at all, if that's the case.
   * @param noImageryStreetsSelected no_imagery streets picked by the regained-imagery rotation (#4929).
   * @param noImageryStreetsPolled   Of those, streets that answered conclusively.
   * @param reopenCandidatesFound    Of those, streets where attributable panos were found and a reopen candidate was
   *                                 recorded for admin review.
   */
  case class PollResult(
      provider: Option[String],
      streetsSelected: Int,
      streetsPolled: Int,
      streetsSkipped: Int,
      notPolledReason: Option[String] = None,
      noImageryStreetsSelected: Int = 0,
      noImageryStreetsPolled: Int = 0,
      reopenCandidatesFound: Int = 0
  ) {

    /** One line for the actor log. */
    def summary: String = notPolledReason.getOrElse(
      s"${provider.getOrElse("Imagery")} imagery-age poll: $streetsPolled streets updated, $streetsSkipped skipped " +
        s"(of $streetsSelected selected); $noImageryStreetsPolled of $noImageryStreetsSelected no-imagery streets " +
        s"re-checked, $reopenCandidatesFound reopen candidate(s) found."
    )
  }

  object PollResult {

    /** A poll with nothing to do, because this city's imagery provider has no age query to make. */
    def notPolled(reason: String): PollResult = PollResult(None, 0, 0, 0, Some(reason))
  }

  /**
   * Thrown when the provider this city uses *does* support age polling but its credential is absent.
   *
   * Distinguished from [[PollResult.notPolled]] so the run is recorded as a failure rather than a quiet success: a
   * key that was rotated out or never set is a misconfiguration that stops `street_imagery.newest_capture` advancing
   * and takes the #4384 re-audit signal with it, and a green Health badge over that is exactly the blind spot the
   * run log exists to close.
   */
  class MissingImageryCredentialException(message: String) extends IllegalStateException(message)

  /**
   * One pano seen at a sample point: its provider id, its capture date when one was parseable, and its (lat, lng)
   * position when the provider reported one. The position is what lets the poller confirm the pano actually sits on
   * the street being polled rather than on a nearby cross street or parallel alley within the search radius.
   */
  case class PanoObservation(panoId: String, capture: Option[LocalDate], location: Option[(Double, Double)])

  /**
   * Approximate minimum distance (meters) from a point to a street's polyline.
   *
   * Equirectangular local projection centered on the point: exact enough at the sub-100 m scales involved (the
   * projection error is millimeters there), with the same polar cosine clamp as bboxHalfWidths. Pure, for unit tests.
   *
   * @param lat    Latitude of the point.
   * @param lng    Longitude of the point.
   * @param street The street geometry (JTS coordinates are x = lng, y = lat).
   */
  def metersToStreet(lat: Double, lng: Double, street: LineString): Double = {
    val metersPerDegLat = 111320.0
    val metersPerDegLng = 111320.0 * math.max(0.01, math.cos(math.toRadians(lat)))
    val points          = street.getCoordinates.map(c => ((c.x - lng) * metersPerDegLng, (c.y - lat) * metersPerDegLat))
    if (points.length < 2) points.map { case (x, y) => math.hypot(x, y) }.minOption.getOrElse(Double.PositiveInfinity)
    else points.sliding(2).map { pair => originToSegmentMeters(pair(0), pair(1)) }.min
  }

  /** Distance from the origin to the segment a-b, in the same planar units as the inputs. */
  private def originToSegmentMeters(a: (Double, Double), b: (Double, Double)): Double = {
    val (ax, ay)  = a
    val (dx, dy)  = (b._1 - ax, b._2 - ay)
    val lengthSq  = dx * dx + dy * dy
    val t: Double = if (lengthSq == 0.0) 0.0 else math.max(0.0, math.min(1.0, -(ax * dx + ay * dy) / lengthSq))
    math.hypot(ax + t * dx, ay + t * dy)
  }

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
    streetReopenCandidateTable: StreetReopenCandidateTable,
    auditTaskTable: AuditTaskTable,
    implicit val ec: ExecutionContext
) extends ImageryFreshnessService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import ImageryFreshnessService._
  import models.utils.MyPostgresProfile.api._

  private val logger = Logger(this.getClass)

  private val pollBatchSize: Int          = config.get[Int]("street-imagery-poll.batch-size")
  private val noImageryPollBatchSize: Int = config.get[Int]("street-imagery-poll.no-imagery-batch-size")

  // 25m matches check_streets_for_imagery.py's sample radius: wide enough to catch imagery on the roadway around a
  // sample point. Off-street panos inside the radius are rejected by the position filter in pollOneStreet.
  private val SampleRadiusMeters = 25.0

  /**
   * Refreshes street_imagery from recently-viewed panos, then syncs outdated_imagery flags against it.
   *
   * Ordering contract: this must run BEFORE recalculateStreetPriority and the region_completion rebuild (see
   * RecalculateStreetPriorityActor), and only there. Flags changing exclusively in that nightly sequence keeps
   * street_edge_priority and region_completion consistent with the flags, and keeps the priority-1.0-crossing
   * increment in ExploreService.updateStreetPriority sound during the day.
   *
   * The two steps run in separate transactions on purpose. Each is independently idempotent (the refresh only widens
   * capture ranges; the flag sync is a set/clear pair over the current street_imagery contents), so a crash between
   * them costs nothing beyond a day's delay, whereas one combined transaction would hold the table-wide audit_task
   * UPDATE open across the label/pano_data aggregate for no benefit.
   */
  def syncImageryFreshness: Future[SyncResult] = {
    for {
      streetsRefreshed     <- db.run(streetImageryTable.refreshFromPanoData)
      (flagged, unflagged) <- db.run(auditTaskTable.syncOutdatedImageryFlags.transactionally)
    } yield SyncResult(streetsRefreshed, flagged, unflagged)
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
   * The two ways a poll can cover no streets at all are deliberately not the same outcome. A provider that has no age
   * query to make is a settled configuration and reports success; a supported provider whose credential is missing
   * fails, because a rotated-out key silently ends the re-audit signal and a run row saying `succeeded` would hide
   * that behind a green badge forever.
   *
   * @return Counts for the run, or a failed Future when the provider's credential is missing.
   */
  def pollImageryAges(): Future[PollResult] = {
    configService.getPanoSource match {
      // The key is resolved once here, like the Mapillary token below: resolving it lazily inside the per-point
      // fetch would throw synchronously in the batch fold and abandon every remaining street.
      case PanoSource.Gsv =>
        config.getOptional[String]("google-maps-api-key") match {
          case Some(key) => pollStreets("GSV")(fetchGsvPointObservations(key))
          case None      =>
            Future.failed(new MissingImageryCredentialException("No google-maps-api-key configured for a GSV city."))
        }
      case PanoSource.Mapillary =>
        config.getOptional[String]("mapillary-access-token") match {
          case Some(token) => pollStreets("Mapillary")(fetchMapillaryPointObservations(token))
          case None        =>
            Future.failed(
              new MissingImageryCredentialException("No mapillary-access-token configured for a Mapillary city.")
            )
        }
      case other =>
        Future.successful(PollResult.notPolled(s"Imagery-age polling isn't supported for provider $other; skipping."))
    }
  }

  /**
   * Runs the poll loop for one batch of streets against a provider-specific point fetcher.
   *
   * The main (open-street) batch runs first, then the regained-imagery re-check of no_imagery streets (#4929) --
   * in that order so a provider failing mid-run degrades the side quest, not the rotation that feeds the re-audit
   * flags.
   *
   * @param providerName Names the provider in the run's summary and recorded counts.
   * @param fetchPoint   Queries one (lat, lng) sample point: Some(panos seen) on a conclusive answer (possibly
   *                     empty = confirmed no imagery), None when inconclusive.
   */
  private def pollStreets(
      providerName: String
  )(fetchPoint: (Double, Double) => Future[Option[Seq[PanoObservation]]]): Future[PollResult] = {
    for {
      streets           <- db.run(streetImageryTable.streetsToPoll(pollBatchSize))
      (polled, skipped) <- streets.foldLeft(Future.successful((0, 0))) { case (accFuture, street) =>
        accFuture.flatMap { case (polled, skipped) =>
          pollOneStreet(street, fetchPoint).map {
            case Some(_) => (polled + 1, skipped)
            case None    => (polled, skipped + 1)
          }
        }
      }
      noImageryStreets              <- db.run(streetImageryTable.noImageryStreetsToPoll(noImageryPollBatchSize))
      (noImageryPolled, candidates) <- noImageryStreets.foldLeft(Future.successful((0, 0))) {
        case (accFuture, street) =>
          accFuture.flatMap { case (noImageryPolled, candidates) =>
            recheckOneNoImageryStreet(street, fetchPoint).map {
              case Some(true)  => (noImageryPolled + 1, candidates + 1)
              case Some(false) => (noImageryPolled + 1, candidates)
              case None        => (noImageryPolled, candidates)
            }
          }
      }
    } yield PollResult(Some(providerName), streets.size, polled, skipped, None, noImageryStreets.size, noImageryPolled,
      candidates)
  }

  /**
   * Re-checks one no_imagery street for regained imagery and maintains its reopen-candidate row (#4929).
   *
   * The poll itself is pollOneStreet unchanged: street_imagery gets the same honest record, and its updated_at bump
   * is what advances this rotation. Attributable panos upsert a candidate for the review queue; a conclusive poll
   * with none deletes it -- a Reopen button must never sit next to evidence the latest poll withdrew.
   *
   * @return Some(true) when a candidate was recorded, Some(false) on a conclusive poll without attributable panos,
   *         None when the street was skipped as inconclusive.
   */
  private def recheckOneNoImageryStreet(
      street: StreetToPoll,
      fetchPoint: (Double, Double) => Future[Option[Seq[PanoObservation]]]
  ): Future[Option[Boolean]] = {
    pollOneStreet(street, fetchPoint)
      .flatMap {
        case None                                       => Future.successful(None)
        case Some(attributable) if attributable.isEmpty =>
          db.run(streetReopenCandidateTable.delete(street.streetEdgeId)).map(_ => Some(false))
        case Some(attributable) =>
          // Distinct positions stand in for distinct panos, matching upsertFromPoll's n_panos convention.
          val nPanos        = attributable.map(pano => (pano.lat, pano.lng)).distinct.size
          val newestCapture = attributable.flatMap(_.capture).maxOption
          db.run(streetReopenCandidateTable.upsertFromPoll(street.streetEdgeId, nPanos, newestCapture))
            .map(written => Some(written > 0))
      }
      // Same never-fail contract as pollOneStreet: one street's candidate bookkeeping failing must not abandon the
      // rest of the batch. The street counts as skipped; its street_imagery upsert already went through.
      .recover { case e: Throwable =>
        logger.warn(s"Reopen-candidate bookkeeping failed for street ${street.streetEdgeId}.", e)
        None
      }
  }

  /**
   * Polls one street's sample points and upserts its street_imagery row.
   *
   * Observations without a provider-reported position are dropped (unverifiable attribution is exactly the
   * contamination this guards against), and positioned ones pass a cheap distance prefilter here -- farther than
   * StreetImageryTable.PanoStreetToleranceMeters from this street means it cannot be the nearest street. The exact
   * nearest-street check happens inside upsertFromPoll, which needs the whole street network: the search radius
   * around a sample point can reach a cross street or parallel alley, and crediting such a pano would smear that
   * street's capture dates onto this one (the same rule refreshFromPanoData applies). A conclusive poll whose
   * observations all filter out still upserts (NULL dates), recording "checked, nothing attributable".
   *
   * Observations keep their sample-point index: median_newest_capture is computed per point, and a pano genuinely
   * visible from two sample points describes the imagery at both, so deduplication (by provider id) happens within a
   * point, never across points. Observations whose id came back empty are kept as-is rather than collapsed into one
   * phantom pano.
   *
   * Never fails the returned Future: the caller folds over the whole batch sequentially, so letting a single street's
   * DB or provider error escape would abandon every street after it. An error is logged and counted as a skip, which
   * leaves updated_at un-bumped so the next night's rotation retries the street.
   *
   * @return The attributable observations when the street was conclusively polled and upserted (empty = confirmed
   *         nothing attributable there), or None when it was skipped -- observations rather than a bare success
   *         flag because they are the evidence the #4929 reopen candidacy is built from.
   */
  private def pollOneStreet(
      street: StreetToPoll,
      fetchPoint: (Double, Double) => Future[Option[Seq[PanoObservation]]]
  ): Future[Option[Seq[PolledPano]]] = {
    Future
      .sequence(street.points.map { case (lat, lng) => fetchPoint(lat, lng) })
      .flatMap { results =>
        // `None` is an inconclusive point (auth failure, timeout); an empty Seq is a conclusive "no imagery here", so
        // these two cases must not be conflated.
        if (results.contains(None)) {
          Future.successful(None)
        } else {
          val polled = results.zipWithIndex.flatMap { case (pointResult, pointIndex) =>
            val nearThisStreet = pointResult.toSeq.flatten.filter(_.location.exists { case (lat, lng) =>
              metersToStreet(lat, lng, street.geom) <= StreetImageryTable.PanoStreetToleranceMeters
            })
            val (identified, anonymous) = nearThisStreet.partition(_.panoId.nonEmpty)
            (identified.groupBy(_.panoId).map(_._2.head).toSeq ++ anonymous).collect {
              case PanoObservation(_, capture, Some((lat, lng))) => PolledPano(lat, lng, capture, pointIndex)
            }
          }
          db.run(streetImageryTable.upsertFromPoll(street.streetEdgeId, street.points.size, polled))
            .map(_ => Some(polled))
        }
      }
      .recover { case e: Throwable =>
        logger.warn(s"Imagery-age poll failed for street ${street.streetEdgeId}; skipping it this run.", e)
        None
      }
  }

  /**
   * Queries the free GSV Street View metadata endpoint for the pano currently served at a point, at month precision.
   *
   * The endpoint answers with the pano *nearest* the point within the radius, which is usually -- but not promised by
   * the API to be -- Google's newest drive there. That leaves a false negative to keep in mind when reading the
   * resulting dates: older coverage can sit closer to the sample point than a newer drive, so new imagery goes
   * unnoticed until another sample point or another night catches it. The mirror-image false positive -- the radius
   * reaching a pano on a parallel service road or alley -- is handled downstream: the response carries the pano's
   * position, and pollOneStreet drops observations that don't lie on the polled street.
   */
  private def fetchGsvPointObservations(
      apiKey: String
  )(lat: Double, lng: Double): Future[Option[Seq[PanoObservation]]] = {
    val url = panoDataService.signUrl(
      s"https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor" +
        s"&location=$lat,$lng&radius=${SampleRadiusMeters.toInt}&key=$apiKey"
    )
    ws.url(url)
      .withRequestTimeout(5.seconds)
      .get()
      .map { response =>
        val json = Json.parse(response.body)
        (json \ "status").asOpt[String] match {
          case Some("OK") =>
            val panoId   = (json \ "pano_id").asOpt[String].getOrElse("")
            val date     = (json \ "date").asOpt[String].flatMap(parseGsvCaptureDate)
            val location = for {
              panoLat <- (json \ "location" \ "lat").asOpt[Double]
              panoLng <- (json \ "location" \ "lng").asOpt[Double]
            } yield (panoLat, panoLng)
            Some(Seq(PanoObservation(panoId, date, location)))
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
   *
   * Known limitation: the endpoint takes no ordering parameter, so in a densely-covered bbox the newest image can
   * fall outside the first `limit` results and this under-reports the street's newest capture. That direction is
   * safe -- it costs a missed re-audit prompt, never a spurious one -- and the next night's rotation gets another
   * chance. Paging (or a captured_at lower bound seeded from the stored newest_capture) is tracked in #4704.
   */
  private def fetchMapillaryPointObservations(
      accessToken: String
  )(lat: Double, lng: Double): Future[Option[Seq[PanoObservation]]] = {
    val (dLat, dLng) = bboxHalfWidths(lat, SampleRadiusMeters)
    val bbox         = s"${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}"
    ws.url(s"https://graph.mapillary.com/images?bbox=$bbox&fields=id,captured_at,is_pano,geometry&limit=100")
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
                // The geometry field is a GeoJSON Point, so coordinates come as [lng, lat].
                val location = (img \ "geometry" \ "coordinates").asOpt[Seq[Double]].collect {
                  case Seq(imgLng, imgLat) => (imgLat, imgLng)
                }
                PanoObservation(id, date, location)
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
