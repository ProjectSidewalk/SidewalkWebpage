package service

import com.google.inject.ImplementedBy
import models.pano.{PanoDataTable, PanoExpiryWeek}
import models.street.{
  CorroboratedNoImageryStreet,
  NoImageryReportRegion,
  NoImageryReportWeek,
  StatusChangeWeek,
  StreetEdgeIssueTable,
  StreetEdgeStatusChangeTable
}
import models.utils.MyPostgresProfile
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._

import java.time.OffsetDateTime
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
 * @param panosExpired         Panos whose imagery went away, by week.
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
    panosExpired: Seq[PanoExpiryWeek],
    topReportRegions: Seq[NoImageryReportRegion],
    corroboratedStreets: Seq[CorroboratedNoImageryStreet],
    minReporters: Int,
    panosExpiredUndated: Int
)

object StreetStatusTrend {

  /** snake_case per the admin dashboard convention. Weeks with nothing to report are absent; the client zero-fills. */
  implicit val writes: Writes[StreetStatusTrend] = Writes { trend =>
    Json.obj(
      "weeks"          -> trend.weeks,
      "since"          -> trend.since.toString,
      "status_changes" -> JsArray(trend.statusChanges.map { week =>
        Json.obj(
          "week_start"   -> week.weekStart.toString,
          "new_status"   -> week.newStatus.toString,
          "street_count" -> week.streetCount
        )
      }),
      "no_imagery_reports" -> JsArray(trend.noImageryReports.map { week =>
        Json.obj(
          "week_start"   -> week.weekStart.toString,
          "report_count" -> week.reportCount,
          "street_count" -> week.streetCount
        )
      }),
      "panos_expired" -> JsArray(trend.panosExpired.map { week =>
        Json.obj("week_start" -> week.weekStart.toString, "pano_count" -> week.panoCount)
      }),
      "top_report_regions" -> JsArray(trend.topReportRegions.map { region =>
        Json.obj(
          "region_id"    -> region.regionId,
          "region_name"  -> region.regionName,
          "report_count" -> region.reportCount,
          "street_count" -> region.streetCount
        )
      }),
      "corroborated_streets" -> JsArray(trend.corroboratedStreets.map { street =>
        Json.obj(
          "street_edge_id"   -> street.streetEdgeId,
          "region_id"        -> street.regionId,
          "region_name"      -> street.regionName,
          "reporter_count"   -> street.reporterCount,
          "report_count"     -> street.reportCount,
          "last_reported_at" -> street.lastReportedAt.toString
        )
      }),
      "min_reporters"         -> trend.minReporters,
      "panos_expired_undated" -> trend.panosExpiredUndated
    )
  }
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
   * Six unindexed scans of `pano_data` and `street_edge_issue` back one payload, and the page re-fires all of them
   * on load and on every window change. Nothing here moves faster than the nightly jobs that feed it, so ten minutes
   * costs the reader no freshness they could act on.
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
 * how many panos the nightly sweep found gone — none of which a snapshot can show.
 */
@Singleton
class StreetLifecycleServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    cacheApi: AsyncCacheApi,
    statusChangeTable: StreetEdgeStatusChangeTable,
    streetEdgeIssueTable: StreetEdgeIssueTable,
    panoDataTable: PanoDataTable
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
    val since = OffsetDateTime.now
      .minusWeeks(window.toLong)
      .`with`(java.time.DayOfWeek.MONDAY)
      .toLocalDate
      .atStartOfDay(OffsetDateTime.now.getOffset)
      .toOffsetDateTime

    for {
      statusChanges <- db.run(statusChangeTable.transitionsByWeek(since))
      reports       <- db.run(streetEdgeIssueTable.reportsByWeek(since))
      expired       <- db.run(panoDataTable.newlyExpiredByWeek(since))
      regions       <- db.run(streetEdgeIssueTable.topReportRegions(since, StreetLifecycleService.TopReportRegions))
      corroborated  <- db.run(
        streetEdgeIssueTable.corroboratedOpenStreets(
          since,
          StreetLifecycleService.MinCorroboratingReporters,
          StreetLifecycleService.MaxCorroboratedStreets
        )
      )
      undated <- db.run(panoDataTable.countExpiredWithoutExpiryDate)
    } yield StreetStatusTrend(window, since, statusChanges, reports, expired, regions, corroborated,
      StreetLifecycleService.MinCorroboratingReporters, undated)
  }
}
