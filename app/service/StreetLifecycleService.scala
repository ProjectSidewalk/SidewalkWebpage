package service

import com.google.inject.ImplementedBy
import models.pano.{PanoDataTable, PanoImageryChangeTable, PanoImageryWeek}
import models.region.RegionCompletionTable
import models.street.{
  CorroboratedNoImageryStreet,
  NoImageryReportRegion,
  NoImageryReportWeek,
  ReopenCandidateForReview,
  StatusChangeWeek,
  StreetEdgeIssueTable,
  StreetEdgeStatus,
  StreetEdgeStatusChangeTable,
  StreetReopenCandidateTable
}
import models.utils.MyPostgresProfile
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._

import java.time.{LocalDate, OffsetDateTime, ZoneId}
import javax.inject._
import scala.concurrent.duration.Duration
import scala.concurrent.{ExecutionContext, Future}

/**
 * Everything the admin Street Status page charts about *change* rather than current state.
 *
 * @param weeks                Size of the window the series cover.
 * @param since                Start of that window.
 * @param statusChanges        Streets entering each status, by week.
 * @param noImageryReports     Labeler reports of missing imagery, by week.
 * @param panoImageryChanges   Panos whose imagery went away, and whose imagery came back, by week.
 * @param topReportRegions     Regions with the most missing-imagery reports over the window.
 * @param corroboratedStreets  Still-open streets several labelers independently reported as having no imagery.
 * @param minReporters         Distinct labelers a street needs to appear in `corroboratedStreets`.
 * @param panosExpiredUndated  Expired panos with no recorded expiry date, i.e. what these series can't account for.
 * @param panosHealed          Panos the reconciliation pass healed inside the window: crossings that did happen, but
 *                             carry the date they were noticed, so `panoImageryChanges` can't place them in a week.
 * @param reopenCandidates     no_imagery streets whose latest poll found imagery, awaiting an admin's Reopen (#4929).
 */
case class StreetStatusTrend(
    weeks: Int,
    since: OffsetDateTime,
    statusChanges: Seq[StatusChangeWeek],
    noImageryReports: Seq[NoImageryReportWeek],
    panoImageryChanges: Seq[PanoImageryWeek],
    topReportRegions: Seq[NoImageryReportRegion],
    corroboratedStreets: Seq[CorroboratedNoImageryStreet],
    minReporters: Int,
    panosExpiredUndated: Int,
    panosHealed: Int,
    reopenCandidates: Seq[ReopenCandidateForReview]
)

object StreetStatusTrend {

  /** snake_case per the admin dashboard convention. Weeks with nothing to report are absent; the client zero-fills. */
  implicit private val jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  // Dates go out as ISO strings, which is what the charts bucket and label by. Pinned here rather than left to
  // play-json's defaults so the wire format can't shift under the client with a library upgrade.
  implicit private val localDateWrites: Writes[LocalDate]           = Writes(date => JsString(date.toString))
  implicit private val offsetDateTimeWrites: Writes[OffsetDateTime] = Writes(time => JsString(time.toString))

  implicit private val statusWrites: Writes[StreetEdgeStatus.Value] = Writes(status => JsString(status.toString))

  implicit private val statusChangeWeekWrites: Writes[StatusChangeWeek]        = Json.writes[StatusChangeWeek]
  implicit private val reportWeekWrites: Writes[NoImageryReportWeek]           = Json.writes[NoImageryReportWeek]
  implicit private val imageryWeekWrites: Writes[PanoImageryWeek]              = Json.writes[PanoImageryWeek]
  implicit private val reportRegionWrites: Writes[NoImageryReportRegion]       = Json.writes[NoImageryReportRegion]
  implicit private val corroboratedWrites: Writes[CorroboratedNoImageryStreet] =
    Json.writes[CorroboratedNoImageryStreet]
  implicit private val reopenCandidateWrites: Writes[ReopenCandidateForReview] = Json.writes[ReopenCandidateForReview]

  implicit val writes: Writes[StreetStatusTrend] = Json.writes[StreetStatusTrend]
}

@ImplementedBy(classOf[StreetLifecycleServiceImpl])
trait StreetLifecycleService {
  def getStreetStatusTrend(weeks: Int): Future[StreetStatusTrend]
  def reopenStreet(streetEdgeId: Int): Future[StreetLifecycleService.ReopenOutcome]
  def dismissReopenCandidate(streetEdgeId: Int): Future[Int]
}

object StreetLifecycleService {

  /** Outcome of an admin's attempt to reopen a no_imagery street (#4929). */
  sealed trait ReopenOutcome

  /** The street was flipped back to open, with its priority row and status-change record written. */
  case object Reopened extends ReopenOutcome

  /** The street exists but isn't no_imagery (already open, or closed/disabled), so nothing was changed. */
  case class NotNoImagery(currentStatus: String) extends ReopenOutcome

  /** No street with the given id exists. */
  case object StreetNotFound extends ReopenOutcome

  /** Window the Street Status trend defaults to, in weeks. Half a year reads as a season-scale trend at chart width. */
  val DefaultTrendWeeks: Int = 26

  /** Bounds on the requested window: one week is the smallest meaningful bucket, three years the longest we chart. */
  val MinTrendWeeks: Int = 1
  val MaxTrendWeeks: Int = 156

  /**
   * The windows the page's selector offers, in weeks: a quarter, half a year, a year.
   *
   * Lives here rather than in the template so the offered set and [[DefaultTrendWeeks]] can't drift apart — the
   * selector can only show the default if the default is one of these.
   */
  val TrendWeekOptions: Seq[Int] = Seq(13, DefaultTrendWeeks, 52)

  /** How many regions the "where are reports coming from" list names. */
  val TopReportRegions: Int = 10

  /**
   * Distinct labeler accounts a street needs before it appears in the corroborated no-imagery queue.
   *
   * Two independent people finding the same street empty is the point at which the report stops being explicable as
   * one bad session or a transient provider outage (#4922). It is a *review* threshold, not an automatic retirement:
   * only the offline imagery checker flips a street to `no_imagery`, which is what keeps the threshold's known
   * looseness harmless — every anonymous sign-up mints its own `sidewalk_user`, so one person returning to a street
   * across two anonymous sessions counts as two accounts. Tightening that (distinct registered users, or an
   * `ip_address` fallback for anonymous rows) is worth doing if this ever drives an automatic status change.
   */
  val MinCorroboratingReporters: Int = 2

  /** How many corroborated streets the queue lists. Long enough to be a work list, short enough to read. */
  val MaxCorroboratedStreets: Int = 50

  /** How many regained-imagery reopen candidates the queue lists, sized like [[MaxCorroboratedStreets]]. */
  val MaxReopenCandidates: Int = 50

  /**
   * How long an assembled trend is served from cache.
   *
   * Six aggregate scans back one payload — the four over `street_edge_issue` and `pano_data` unindexed, the two
   * over the change logs served by an index on the timestamp they filter — and the page re-fires all of them on
   * load and on every window change. Nothing here moves faster than the nightly jobs that feed it, so ten minutes
   * costs the reader no freshness they could act on.
   */
  val TrendCacheTtl: Duration = Duration(10, "minutes")

  /** Clamps a caller-supplied window into the supported range. */
  def clampWeeks(weeks: Int): Int = math.max(MinTrendWeeks, math.min(MaxTrendWeeks, weeks))
}

/**
 * Assembles the street/imagery lifecycle trends for the admin Street Status page (#4928), and performs that page's
 * one state-changing action: reopening a no_imagery street whose imagery came back (#4929).
 *
 * The page's map and table answer "what is the state of the city right now". These series answer the separate
 * question of what changed and when — which streets were retired, where labelers are reporting missing imagery, and
 * which panos lost or regained their imagery — none of which a snapshot can show.
 */
@Singleton
class StreetLifecycleServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    cacheApi: AsyncCacheApi,
    statusChangeTable: StreetEdgeStatusChangeTable,
    streetEdgeIssueTable: StreetEdgeIssueTable,
    panoDataTable: PanoDataTable,
    panoImageryChangeTable: PanoImageryChangeTable,
    streetReopenCandidateTable: StreetReopenCandidateTable,
    regionCompletionTable: RegionCompletionTable
)(implicit ec: ExecutionContext)
    extends StreetLifecycleService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  /**
   * @param weeks How far back the series reach. Clamped to the supported range.
   */
  def getStreetStatusTrend(weeks: Int): Future[StreetStatusTrend] = {
    val window = StreetLifecycleService.clampWeeks(weeks)
    // Keyed on the clamped window, so the three windows the page offers each get their own entry and a junk value
    // can't mint unbounded keys.
    cacheApi.getOrElseUpdate[StreetStatusTrend](s"streetStatus.trend.$window", StreetLifecycleService.TrendCacheTtl)(
      assembleTrend(window)
    )
  }

  /** Runs the seven series queries that back one window. */
  private def assembleTrend(window: Int): Future[StreetStatusTrend] = {
    // Bucket boundaries are ISO weeks, so start the window on one: an inclusive cutoff mid-week would leave the
    // oldest bucket a partial week that reads as a dip.
    //
    // Resolved through the zone rather than through today's offset, so a window reaching back across a daylight-saving
    // change gets the offset that Monday actually had. Stamping today's -07:00 onto a Monday that was -08:00 puts the
    // cutoff at 23:00 the previous Sunday, and Postgres then buckets those extra rows under the *preceding* Monday —
    // a week_start the client never generates, so they are silently dropped from every chart.
    val since = OffsetDateTime.now
      .minusWeeks(window.toLong)
      .`with`(java.time.DayOfWeek.MONDAY)
      .toLocalDate
      .atStartOfDay(ZoneId.systemDefault)
      .toOffsetDateTime

    // Bound before the for-comprehension so the seven reads run concurrently rather than one after another.
    val statusChangesF = db.run(statusChangeTable.transitionsByWeek(since))
    val reportsF       = db.run(streetEdgeIssueTable.reportsByWeek(since))
    val imageryF       = db.run(panoImageryChangeTable.transitionsByWeek(since))
    val regionsF       = db.run(streetEdgeIssueTable.topReportRegions(since, StreetLifecycleService.TopReportRegions))
    val corroboratedF  = db.run(
      streetEdgeIssueTable.corroboratedOpenStreets(
        since,
        StreetLifecycleService.MinCorroboratingReporters,
        StreetLifecycleService.MaxCorroboratedStreets
      )
    )
    val undatedF    = db.run(panoDataTable.countExpiredWithoutExpiryDate)
    val healedF     = db.run(panoImageryChangeTable.healedSince(since))
    val candidatesF =
      db.run(streetReopenCandidateTable.candidatesForReview(StreetLifecycleService.MaxReopenCandidates))

    for {
      statusChanges  <- statusChangesF
      reports        <- reportsF
      imageryChanges <- imageryF
      regions        <- regionsF
      corroborated   <- corroboratedF
      undated        <- undatedF
      healed         <- healedF
      candidates     <- candidatesF
    } yield StreetStatusTrend(window, since, statusChanges, reports, imageryChanges, regions, corroborated,
      StreetLifecycleService.MinCorroboratingReporters, undated, healed, candidates)
  }

  /**
   * Reopens a no_imagery street whose imagery came back, from the admin review queue (#4929).
   *
   * The only in-app writer of street_edge.status, mirroring mark_streets_no_imagery (db/scripts/helpers.sh) for the
   * opposite direction, in one transaction. Two steps beyond the status flip + change row are load-bearing: the
   * street_edge_priority row must be re-inserted if absent (task assignment INNER JOINs on priority and the nightly
   * recalc only ever updates existing rows, so without it the street is open yet silently unroutable), and
   * region_completion must be truncated (the reopened street raises its region's total distance; the table is a
   * cache rebuilt on next read). The Play cache is cleared after commit, never inside: landing-page stats and the
   * cached trend payloads all embed street counts that just changed.
   *
   * @param streetEdgeId The street to reopen.
   * @return Reopened on success; NotNoImagery with the current status when the street isn't reopenable; or
   *         StreetNotFound.
   */
  def reopenStreet(streetEdgeId: Int): Future[StreetLifecycleService.ReopenOutcome] = {
    val action = for {
      flipped <- sqlu"""
        WITH changed AS (
            UPDATE street_edge
            SET status = 'open'
            WHERE street_edge_id = $streetEdgeId AND status = 'no_imagery'
            RETURNING street_edge_id
        )
        INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
        SELECT changed.street_edge_id, 'no_imagery'::street_edge_status, 'open'::street_edge_status,
               'admin_reopen'::street_edge_status_change_source
        FROM changed;
      """
      outcome <-
        if (flipped == 0) {
          sql"SELECT status::text FROM street_edge WHERE street_edge_id = $streetEdgeId".as[String].headOption.map {
            case Some(status) => StreetLifecycleService.NotNoImagery(status)
            case None         => StreetLifecycleService.StreetNotFound
          }
        } else {
          for {
            _ <- sqlu"""
              INSERT INTO street_edge_priority (street_edge_id, priority)
              SELECT $streetEdgeId, 1.0
              WHERE NOT EXISTS (
                  SELECT 1 FROM street_edge_priority WHERE street_edge_priority.street_edge_id = $streetEdgeId
              );
            """
            _ <- streetReopenCandidateTable.delete(streetEdgeId)
            _ <- regionCompletionTable.truncateTable
          } yield StreetLifecycleService.Reopened
        }
    } yield outcome

    db.run(action.transactionally).flatMap {
      case StreetLifecycleService.Reopened => cacheApi.removeAll().map(_ => StreetLifecycleService.Reopened)
      case other                           => Future.successful(other)
    }
  }

  /**
   * Dismisses a reopen candidate without changing the street (#4929): the admin looked and judged the evidence not
   * good enough. The street stays in the slow re-poll rotation, and the dismissed evidence stays on the row as the
   * bar a later poll has to beat to re-queue it (StreetReopenCandidateTable.dismiss).
   *
   * Invalidates only the cached trend payloads rather than the whole application cache: nothing outside this page's
   * queue changes, so flushing landing-page stats and config alongside it would be collateral damage.
   *
   * @return Number of candidates dismissed (0 when the street had no queued one).
   */
  def dismissReopenCandidate(streetEdgeId: Int): Future[Int] = {
    db.run(streetReopenCandidateTable.dismiss(streetEdgeId)).flatMap { dismissed =>
      if (dismissed > 0) invalidateTrendCache.map(_ => dismissed) else Future.successful(dismissed)
    }
  }

  /**
   * Drops every cached trend payload.
   *
   * Sweeps the whole clamped window range rather than [[StreetLifecycleService.TrendWeekOptions]]: the key is the
   * clamped `weeks`, so a hand-typed `?weeks=40` mints a key the page's selector never offers, and skipping those
   * would leave a dismissed row on screen for whoever asked. The range is small and the cache is in-process, so
   * removing all of it costs less than the one landing-page stat a blanket flush would recompute.
   */
  private def invalidateTrendCache: Future[Unit] = {
    val windows = StreetLifecycleService.MinTrendWeeks to StreetLifecycleService.MaxTrendWeeks
    Future.traverse(windows)(weeks => cacheApi.remove(s"streetStatus.trend.$weeks")).map(_ => ())
  }
}
