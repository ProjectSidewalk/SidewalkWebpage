package service

import com.google.inject.ImplementedBy
import models.pano.{PanoDataTable, PanoImageryChangeTable, PanoImageryWeek}
import models.street.{
  CorroboratedNoImageryStreet,
  NoImageryReportRegion,
  NoImageryReportWeek,
  StatusChangeWeek,
  StreetEdgeIssueTable,
  StreetEdgeStatus,
  StreetEdgeStatusChangeTable
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
    panosExpiredUndated: Int
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

  implicit val writes: Writes[StreetStatusTrend] = Json.writes[StreetStatusTrend]
}

@ImplementedBy(classOf[StreetLifecycleServiceImpl])
trait StreetLifecycleService {
  def getStreetStatusTrend(weeks: Int): Future[StreetStatusTrend]
}

object StreetLifecycleService {

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

  /**
   * How long an assembled trend is served from cache.
   *
   * Six aggregate scans back one payload — most of them unindexed, over `street_edge_issue` and `pano_data` — and
   * the page re-fires all of them on load and on every window change. Nothing here moves faster than the nightly
   * jobs that feed it, so ten minutes costs the reader no freshness they could act on.
   */
  val TrendCacheTtl: Duration = Duration(10, "minutes")

  /** Clamps a caller-supplied window into the supported range. */
  def clampWeeks(weeks: Int): Int = math.max(MinTrendWeeks, math.min(MaxTrendWeeks, weeks))
}

/**
 * Assembles the street/imagery lifecycle trends for the admin Street Status page (#4928).
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
    panoImageryChangeTable: PanoImageryChangeTable
)(implicit ec: ExecutionContext)
    extends StreetLifecycleService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

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

  /** Runs the six series queries that back one window. */
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

    // Bound before the for-comprehension so the six reads run concurrently rather than one after another.
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
    val undatedF = db.run(panoDataTable.countExpiredWithoutExpiryDate)

    for {
      statusChanges  <- statusChangesF
      reports        <- reportsF
      imageryChanges <- imageryF
      regions        <- regionsF
      corroborated   <- corroboratedF
      undated        <- undatedF
    } yield StreetStatusTrend(window, since, statusChanges, reports, imageryChanges, regions, corroborated,
      StreetLifecycleService.MinCorroboratingReporters, undated)
  }
}
