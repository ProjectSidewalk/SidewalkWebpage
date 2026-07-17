package service

import com.google.inject.ImplementedBy
import com.typesafe.config.ConfigException
import models.api.DailyStatRecord
import models.label.LabelTypeEnum
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile.api._
import models.utils._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import slick.dbio.DBIO

import java.time.{LocalDate, OffsetDateTime}
import java.time.temporal.ChronoUnit
import javax.inject._
import scala.concurrent.duration.{Duration, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

case class CityInfo(
    cityId: String,
    stateId: Option[String],
    countryId: String,
    cityNameShort: String,
    cityNameFormatted: String,
    URL: String,
    visibility: String
)
case class CommonPageData(
    cityId: String,
    environmentType: String,
    googleAnalyticsId: String,
    prodUrl: String,
    imagerySource: PanoSource,
    imageryAccessToken: String,
    gMapsApiKey: String,
    mapboxApiKey: String,
    versionId: String,
    versionTimestamp: OffsetDateTime,
    allCityInfo: Seq[CityInfo]
)

/**
 * Represents label statistics for a specific label type.
 *
 * @param labels Total number of labels for this type
 * @param labelsValidated Total number of labels validated for this type
 * @param labelsValidatedAgree Number of validated labels that were agreed upon
 * @param labelsValidatedDisagree Number of validated labels that were disagreed upon
 */
case class LabelTypeStats(
    labels: Int,
    labelsValidated: Int,
    labelsValidatedAgree: Int,
    labelsValidatedDisagree: Int
)

/**
 * Represents aggregate statistics across all Project Sidewalk deployments.
 *
 * @param kmExplored Total kilometers explored across all cities
 * @param kmExploredNoOverlap Total kilometers explored without overlap across all cities
 * @param totalLabels Total number of (non-tutorial) labels across all cities. Equals the sum of `byLabelType` label
 *                    counts by construction (#3981), so the per-type breakdown always reconciles with this total.
 * @param tutorialLabels Total number of practice/tutorial labels across all cities. Tracked separately because tutorial
 *                       labels are excluded from `totalLabels` and `byLabelType` (they would skew the per-type ratios).
 * @param totalValidations Total number of validations across all cities
 * @param totalUsers Number of distinct contributors across all cities — users who added at least one (non-tutorial)
 *                   label or validated at least one label. Counted as distinct people: because `user_id` is a global
 *                   identifier shared across city schemas, a user active in multiple cities is counted once (the union
 *                   of contributor ids, not the sum of per-city counts). The legacy DC deployment contributes a fixed
 *                   historical estimate (`legacyDCUserCount`) since it has no per-user records.
 * @param numCities Number of cities where Project Sidewalk is deployed
 * @param numCountries Number of countries where Project Sidewalk is deployed
 * @param numLanguages Number of distinct languages supported
 * @param byLabelType Map of label type to its statistics
 */
case class AggregateStats(
    kmExplored: Double,
    kmExploredNoOverlap: Double,
    totalLabels: Int,
    tutorialLabels: Int,
    totalValidations: Int,
    totalUsers: Int,
    numCities: Int,
    numCountries: Int,
    numLanguages: Int,
    byLabelType: Map[String, LabelTypeStats]
)

/**
 * One week's contribution volume for a city, for the Across Cities activity trends (#4329).
 *
 * @param weekStart    Monday (Pacific) of the week.
 * @param labels       Non-tutorial, non-excluded labels created that week.
 * @param validations  Validations by non-excluded users that week.
 * @param activeUsers  Distinct non-excluded users who labeled or validated that week. Summed across cities for the
 *                     "active users over time" overview line, this slightly over-counts users active in multiple cities.
 */
case class WeeklyPoint(weekStart: LocalDate, labels: Int, validations: Int, activeUsers: Int)

/**
 * One city's summary row for the cross-city "Across Cities" admin overview (#4329).
 *
 * Unlike [[AggregateStats]], which sums every city into one total, this keeps each deployment separate so they can be
 * compared side by side across four lenses: coverage (how much is left), activity (what's happening and when), data
 * patterns (the label-type mix), and data quality (how trustworthy the data is). Display name / URL / visibility are
 * intentionally NOT here — they come from `getAllCityInfo(lang)` and are merged at the controller layer, so this
 * (cached) value stays language-agnostic.
 *
 * Counts use the same exclusions as the rest of the stats code (`NOT user_stat.excluded`, non-deleted, non-tutorial).
 *
 * @param cityId                  The city id (e.g. "seattle-wa").
 * @param totalStreets            Non-deleted streets in the city.
 * @param auditedStreets          Distinct streets with a completed audit by a non-excluded user.
 * @param coverage                auditedStreets / totalStreets in [0, 1]; 0.0 when the city has no streets.
 * @param totalKm                 Total length of the non-deleted street network, in km.
 * @param auditedKm               Distinct audited length (no double-counting overlapping audits), in km.
 * @param totalLabels             Non-tutorial, non-excluded labels (reconciles with the city's single-city total).
 * @param aiLabels                Subset of totalLabels authored by the AI role.
 * @param labelsWithSeverity      Subset of totalLabels that have a severity rating (a data-completeness signal).
 * @param labelsSeverityEligible  Labels whose type CAN take a severity (excludes NoSidewalk/Signal/Occlusion) — the
 *                                correct denominator for "% with severity".
 * @param labelsWithTags          Subset of totalLabels that have at least one tag applied.
 * @param labelsTagEligible       Labels whose type CAN take tags (types present in this deployment's tag table) — the
 *                                correct denominator for "% with tags".
 * @param labelsValidated         Labels that have at least one validation.
 * @param totalValidations        All validations by non-excluded users (the volume, including AI).
 * @param validationsAgree        HUMAN (non-AI) validations with an "Agree" result.
 * @param validationsDisagree     HUMAN (non-AI) validations with a "Disagree" result. (Agreement/disagreement is a
 *                                human-consensus signal; AI verdicts are reported separately via `aiValidations`.)
 * @param aiValidations           Subset of totalValidations cast by the AI role (distinct from AI-authored labels).
 * @param byLabelType             Per-label-type counts (labels, validated, agree, disagree) — the data-pattern lens.
 * @param activeContributors      Distinct non-excluded, non-AI users who placed a label or a validation.
 * @param lowQualityContributors  Distinct EXCLUDED (low-quality) users who placed a label — the quality lens.
 * @param labels7d                Labels created in the last 7 days.
 * @param labels30d               Labels created in the last 30 days.
 * @param validations7d           Validations in the last 7 days.
 * @param validations30d          Validations in the last 30 days.
 * @param audits7d                Streets completed in the last 7 days.
 * @param audits30d               Streets completed in the last 30 days.
 * @param lastActivity            Most recent label/validation/audit timestamp; None if the city has no activity.
 * @param weeklyTrend             Trailing weekly label/validation volume (oldest first) for the activity sparkline.
 * @param labelsPerUserMedian     Median labels per labeler (robust to the power-law skew; mean would mislead).
 * @param labelsPerUserP90        90th-percentile labels per labeler (the engaged tail).
 * @param numLabelers             Distinct non-AI, non-excluded users who placed a label.
 * @param validationsPerUserMedian Median validations per validator.
 * @param validationsPerUserP90   90th-percentile validations per validator.
 * @param numValidators           Distinct non-AI, non-excluded users who validated.
 * @param validationSecondsMedian Median seconds per validation (clamped to <= 5 min); 0 if unknown. ×10 = "time to
 *                                validate 10".
 */
case class CityScorecard(
    cityId: String,
    totalStreets: Int,
    auditedStreets: Int,
    coverage: Double,
    totalKm: Double,
    auditedKm: Double,
    totalLabels: Int,
    aiLabels: Int,
    labelsWithSeverity: Int,
    labelsSeverityEligible: Int,
    labelsWithTags: Int,
    labelsTagEligible: Int,
    labelsValidated: Int,
    totalValidations: Int,
    validationsAgree: Int,
    validationsDisagree: Int,
    aiValidations: Int,
    byLabelType: Map[String, LabelTypeStats],
    activeContributors: Int,
    lowQualityContributors: Int,
    labels7d: Int,
    labels30d: Int,
    validations7d: Int,
    validations30d: Int,
    audits7d: Int,
    audits30d: Int,
    lastActivity: Option[OffsetDateTime],
    weeklyTrend: Seq[WeeklyPoint],
    labelsPerUserMedian: Double,
    labelsPerUserP90: Double,
    numLabelers: Int,
    validationsPerUserMedian: Double,
    validationsPerUserP90: Double,
    numValidators: Int,
    validationSecondsMedian: Double
)

/**
 * A [[CityScorecard]] paired with the anomaly flags computed for it across the full cross-city set (#4329).
 *
 * @param scorecard The per-city metrics.
 * @param anomalies Zero or more flag keys: "stalled", "low_coverage", "high_disagreement". The page turns these into a
 *                  "needs attention" panel.
 */
case class CityScorecardWithFlags(scorecard: CityScorecard, anomalies: Seq[String])

/**
 * One demographic slice of a city's engagement funnel: the eight monotonic step counts for that slice (#288).
 *
 * @param steps Distinct users reaching each step, index 0 = step 1 (see [[ConfigService.FunnelDefs]]), non-increasing.
 */
case class FunnelSegment(steps: Seq[Int])

/**
 * One city's engagement funnel for a single time window, split by the dimensions the Across Cities page toggles (#288).
 *
 * The `all` segment is the whole (human, non-AI) population; the role and device segments partition it two different
 * ways. Device is only reliably known once a user enters the (desktop-only) audit tool, so `deviceUnknown` collects
 * everyone whose device could not be determined — see the page's caveat.
 *
 * @param cityId        The city id (e.g. "seattle-wa").
 * @param all           The funnel for every counted user.
 * @param registered    Users with a non-anonymous role.
 * @param anonymous     Users with the Anonymous role (a per-cookie identity, not necessarily a unique person).
 * @param desktop       Users classified as desktop.
 * @param mobile        Users classified as mobile.
 * @param deviceUnknown Users whose device could not be determined.
 */
case class CityFunnel(
    cityId: String,
    all: FunnelSegment,
    registered: FunnelSegment,
    anonymous: FunnelSegment,
    desktop: FunnelSegment,
    mobile: FunnelSegment,
    deviceUnknown: FunnelSegment
)

/**
 * The current deployment's own engagement funnels for a single time window, for the per-city Contributors page (#4379).
 *
 * This is the single-city counterpart of the cross-city read: one [[CityFunnel]] per funnel type for *this* schema
 * only (no cross-schema fan-out), plus when the rows were last precomputed so the page can show a "data as of" label.
 *
 * @param computedAt When this city's `funnel_stat` was last recomputed; `None` if the table has no rows yet.
 * @param byType     One [[CityFunnel]] per funnel type ("mapping", "contribution"); empty if there is no funnel data.
 */
case class CurrentCityFunnels(computedAt: Option[OffsetDateTime], byType: Map[String, CityFunnel])

/**
 * Lifecycle thresholds, the data-quality anomaly thresholds, and the (pure) classification helpers for the cross-city
 * overview (#4329).
 *
 * Centralized here so the thresholds are defined once and both the service and the controller (which echoes them back in
 * its summary block) read the same values.
 */
object ConfigService {

  /** Cached aggregate stats older than this trigger a background recompute when served (#4600). */
  val AggregateStatsFreshFor: FiniteDuration = Duration(5, "minutes")

  /** How long cached aggregate stats may be served at all; past this, a request blocks on recomputing them. */
  val AggregateStatsMaxAge: FiniteDuration = Duration(24, "hours")

  /** A city with activity within this many days is "active". */
  val ActiveWithinDays: Long = 30

  /**
   * Coverage at or above this means a quiet city is treated as having reached its milestone ("wrapped up") rather than
   * having failed — the Oradell case (#4329). Success is judged by street coverage.
   */
  val WrappedUpCoverage: Double = 0.80

  /**
   * A quiet, under-covered city with fewer than this many distinct contributors "never took off" (low traction) — the
   * LA case — versus "stalled" (it had a real community and lost momentum before finishing).
   */
  val LowTractionContributors: Int = 15

  /** A city with fewer than this many validations is never flagged "high_disagreement" (too small a sample). */
  val MinValidationsForDisagreement: Int = 100

  /** A disagreement rate above the cross-city median times this multiple flags "high_disagreement". */
  val DisagreementMedianMultiple: Double = 1.5

  /**
   * Classifies a city's lifecycle/health into one of four states (#4329), so a quiet-but-finished deployment reads
   * very differently from one that never took off:
   *   - "active"       — activity within [[ActiveWithinDays]].
   *   - "wrapped_up"   — quiet, but coverage >= [[WrappedUpCoverage]] (reached its milestone; celebrate, don't alarm).
   *   - "low_traction" — quiet, under-covered, and fewer than [[LowTractionContributors]] contributors (never took off).
   *   - "stalled"      — quiet, under-covered, but had a real community (had momentum, lost it before finishing).
   *
   * @param sc  The city scorecard.
   * @param now Reference time for the recency comparison.
   * @return    The lifecycle state key.
   */
  def lifecycle(sc: CityScorecard, now: OffsetDateTime): String = {
    val active = sc.lastActivity.exists(ts => ChronoUnit.DAYS.between(ts, now) <= ActiveWithinDays)
    if (active) "active"
    else if (sc.coverage >= WrappedUpCoverage) "wrapped_up"
    else if (sc.activeContributors < LowTractionContributors) "low_traction"
    else "stalled"
  }

  /** True if a city's lifecycle is one that warrants attention (stalled or never-took-off). */
  def lifecycleNeedsAttention(state: String): Boolean = state == "stalled" || state == "low_traction"

  /** Share of a city's HUMAN agree/disagree validations that are disagreements; 0.0 when it has none (AI excluded). */
  def disagreementRate(sc: CityScorecard): Double = {
    val denom = sc.validationsAgree + sc.validationsDisagree
    if (denom > 0) sc.validationsDisagree.toDouble / denom else 0.0
  }

  /**
   * Median disagreement rate across cities with enough validations to be meaningful — the baseline the
   * "high_disagreement" flag compares against.
   *
   * @param scorecards All gathered per-city scorecards.
   * @return           The median rate among cities clearing [[MinValidationsForDisagreement]]; 0.0 if none do.
   */
  def medianDisagreementRate(scorecards: Seq[CityScorecard]): Double = {
    val rates = scorecards.filter(_.totalValidations >= MinValidationsForDisagreement).map(disagreementRate).sorted
    if (rates.isEmpty) 0.0
    else if (rates.length % 2 == 1) rates(rates.length / 2)
    else (rates(rates.length / 2 - 1) + rates(rates.length / 2)) / 2.0
  }

  /**
   * The step keys for each engagement funnel (#288), in order. This is the source of truth for step identity and
   * count; the API echoes the relevant list to the client so the frontend never hardcodes its own copy.
   *   - "mapping":      the Explore onboarding flow (6 steps).
   *   - "contribution": any labeling-or-validation contribution (3 steps).
   * The iteration order here is the order the funnels are presented on the page.
   */
  val FunnelDefs: Seq[(String, Seq[String])] = Seq(
    "mapping" -> Seq("visited", "tutorial_started", "tutorial_finished", "took_step", "labeled", "mission_completed"),
    "contribution" -> Seq("visited", "contributed", "contribution_completed")
  )

  /** The funnel time windows offered by the API and precomputed in `funnel_stat`; the source of truth for the set. */
  val FunnelWindowKeys: Seq[String] = Seq("30d", "90d", "all")

  /** Step keys for one funnel type. */
  def funnelStepKeys(funnelType: String): Seq[String] = FunnelDefs.toMap.getOrElse(funnelType, Seq.empty)

  /** The longest funnel's step count (the mapping funnel), derived from [[FunnelDefs]] rather than hardcoded. */
  val MaxFunnelSteps: Int = FunnelDefs.map(_._2.length).max

  /** An all-zero funnel of the maximum length — the empty/identity input for the conversion helpers. */
  val ZeroFunnelSteps: Seq[Int] = Seq.fill(MaxFunnelSteps)(0)

  /**
   * Step-over-step conversion for a funnel: `stepConversion(i)` = `steps(i) / steps(i-1)` (#288).
   *
   * The first element is 1.0 (the entry step converts from itself). A ratio is 0.0 when the previous step had no users
   * (avoids divide-by-zero).
   *
   * @param steps The eight monotonic step counts.
   * @return      One conversion ratio per step, same length as `steps`.
   */
  def stepConversion(steps: Seq[Int]): Seq[Double] = steps.zipWithIndex.map {
    case (_, 0)     => 1.0
    case (count, i) =>
      val prev = steps(i - 1)
      if (prev > 0) count.toDouble / prev else 0.0
  }

  /**
   * Overall funnel conversion: last step / first step (#288).
   *
   * @param steps The eight monotonic step counts.
   * @return      Fraction of entrants who reached the final step; 0.0 when there were no entrants.
   */
  def overallConversion(steps: Seq[Int]): Double =
    if (steps.nonEmpty && steps.head > 0) steps.last.toDouble / steps.head else 0.0

  /**
   * Builds a [[CityFunnel]] for one funnel type from a city's precomputed `funnel_stat` rows (#288), zero-filling any
   * segment that has no row (e.g. a city with no mobile or no anonymous users) and trimming the stored six-slot steps
   * to the funnel's actual step count.
   *
   * Pure (depends only on [[funnelStepKeys]]) so both the cross-city read ([[ConfigService.getCityFunnels]]) and the
   * single-city read ([[ConfigService.getCurrentCityFunnels]]) share one assembly, and it can be unit-tested without a
   * DB.
   *
   * @param cityId     The city id to stamp on the result.
   * @param funnelType "mapping" or "contribution"; determines the step count the steps are trimmed to.
   * @param rowsOfType The `funnel_stat` rows for that city and funnel type (any subset of the six segments).
   * @return           One [[CityFunnel]] with every segment present (zero-filled when absent).
   */
  def assembleCityFunnel(cityId: String, funnelType: String, rowsOfType: Seq[FunnelStat]): CityFunnel = {
    val numSteps                              = funnelStepKeys(funnelType).length
    val stepsBySegment: Map[String, Seq[Int]] = rowsOfType.map(r => r.segment -> r.steps.take(numSteps)).toMap
    def seg(key: String): FunnelSegment       = FunnelSegment(stepsBySegment.getOrElse(key, Seq.fill(numSteps)(0)))
    CityFunnel(
      cityId = cityId, all = seg("all"), registered = seg("role:registered"), anonymous = seg("role:anon"),
      desktop = seg("device:desktop"), mobile = seg("device:mobile"), deviceUnknown = seg("device:unknown")
    )
  }
}

@ImplementedBy(classOf[ConfigServiceImpl])
trait ConfigService {

  /**
   * Computes a per-city summary scorecard for every configured city whose schema exists (#4329).
   *
   * Reuses the same cross-schema fan-out as [[getAggregateStats]] — read the configured city ids, keep the ones whose
   * schema actually exists, query each in parallel with per-city recovery, cache the merged result — but keeps cities
   * separate rather than summing them. Anomaly flags ("stalled", "low_coverage", "high_disagreement") are computed
   * across the whole set (the disagreement flag is relative to the cross-city median), so they are returned together.
   *
   * @return A Future of one [[CityScorecardWithFlags]] per available city (legacy DC and "staging" excluded).
   */
  def getCityScorecards(): Future[Seq[CityScorecardWithFlags]]

  /**
   * Returns the weekly label/validation/active-user volume summed across all available cities (#4329), for the
   * "over time" overview charts. Active users are summed per city, so a person active in multiple cities is counted in
   * each (documented on the page).
   *
   * @param weeks Trailing weeks to include, or None for full history (the page's "All time" toggle).
   * @return      Merged weekly series, ascending by week.
   */
  def getCrossCityWeeklyTrend(weeks: Option[Int]): Future[Seq[WeeklyPoint]]

  /**
   * Returns each city's labeling speed as seconds of active auditing per 100 m covered (#4329).
   *
   * This is the project's one EXPENSIVE cross-city metric (a window-function scan of each schema's
   * `audit_task_interaction_small`), so it is computed on its own long (daily) cache rather than on every scorecard
   * load — the "nightly precompute" half of the hybrid delivery. Cities with no interaction data are omitted from the
   * map (the page shows them as unknown).
   *
   * @return A Future of cityId → seconds per 100 m (lower is faster).
   */
  def getCrossCityLabelingSpeed(): Future[Map[String, Double]]

  /**
   * Returns each available city's precomputed engagement funnels for a time window (#288).
   *
   * Reads each schema's nightly-precomputed `funnel_stat` table (cheap) and assembles one [[CityFunnel]] per city,
   * using the same available-schema fan-out as [[getCityScorecards]]. Cities whose deployment has not yet created or
   * populated `funnel_stat` are omitted (they appear once their nightly job has run). Segments absent from a city's
   * rows (e.g. no mobile users) are zero-filled.
   *
   * @param window The funnel window key: "30d", "90d", or "all".
   * @return       Per funnel type ("mapping", "contribution"), one [[CityFunnel]] per available city with funnel data.
   */
  def getCityFunnels(window: String): Future[Map[String, Seq[CityFunnel]]]

  /**
   * Returns THIS deployment's own precomputed engagement funnels for a time window (#4379), for the per-city
   * Contributors page.
   *
   * The single-city counterpart of [[getCityFunnels]]: reads only the current city's `funnel_stat` (no cross-schema
   * fan-out), so per-city Administrators can see their own onboarding/contribution conversion without Owner access.
   * Returns an empty result (no funnel types) when the table has not been populated yet.
   *
   * @param window The funnel window key: "30d", "90d", or "all".
   * @return       One [[CityFunnel]] per funnel type for this city, plus when the rows were last recomputed.
   */
  def getCurrentCityFunnels(window: String): Future[CurrentCityFunnels]

  /**
   * Drops the cached funnel reads ([[getCityFunnels]] and [[getCurrentCityFunnels]]) for every window (#4379).
   *
   * Called after a funnel recompute so a manual `/adminapi/updateFunnelStats` (or the nightly job) is reflected on the
   * next page load instead of after the 10-minute cache TTL.
   *
   * @return Completes when all entries have been removed.
   */
  def invalidateFunnelCaches(): Future[Unit]

  /**
   * Maps a city ID to its corresponding database user/schema.
   *
   * @param cityId The ID of the city
   * @return The database user/schema for the city
   */
  def getCitySchema(cityId: String): String

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method attempts to retrieve map parameters (center coordinates, zoom level, and boundary coordinates) for the
   * specified city by querying its database schema. Gets geographic info about cities other than the current one.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]. The Option will be:
   *         - Some(mapParams) if parameters were successfully retrieved
   *         - None if parameters could not be retrieved (e.g., schema not found or query failed)
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]]

  /**
   * Calculates aggregate statistics across all Project Sidewalk deployments.
   *
   * Fetches statistics from all configured cities by querying their respective db schemas and aggregating the results.
   * Results are cached and may lag reality by roughly [[ConfigService.AggregateStatsFreshFor]]; stale data is served
   * immediately while a background recompute refreshes it (#4600).
   *
   * @return A Future containing aggregated statistics across all cities
   */
  def getAggregateStats(): Future[AggregateStats]

  /**
   * Returns daily label and validation counts aggregated across all configured cities.
   *
   * Queries each city schema in parallel and sums counts by (date, labelType) across cities.
   * Cities whose schemas do not exist in the current environment are silently skipped (same
   * guard as getAggregateStats). The legacy DC dataset is omitted because its schema predates
   * the label_validation table format used here.
   *
   * @param startDate        Inclusive start date (Pacific time); no lower bound if None.
   * @param endDate          Inclusive end date; no upper bound if None.
   * @param filterLowQuality If true, restrict to high-quality users.
   * @return                 Merged, sorted sequence of DailyStatRecord summed across all cities.
   */
  def getAggregateStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]]

  def getCityMapParams: Future[MapParams]
  def getTutorialStreetId: Future[Int]
  def getMakeCrops: Future[Boolean]
  def getMapathonEventLink: Future[Option[String]]
  def getOpenStatus: Future[String]
  def getOffsetHours: Future[Int]
  def getExcludedTags: DBIO[Seq[ExcludedTag]]
  def getAllCityInfo(lang: Lang): Seq[CityInfo]
  def getCityId: String
  def getCurrentCountryId: String
  def getCityName(lang: Lang): String
  def getAiTagSuggestionsEnabled: Boolean
  def getPrivateProfilesByDefault: Boolean
  def getPanoSource: PanoSource
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Double): Future[Int]
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T]
  def getCommonPageData(lang: Lang): Future[CommonPageData]
}

@Singleton
class ConfigServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    messagesApi: MessagesApi,
    cacheApi: AsyncCacheApi,
    ws: WSClient,
    configTable: ConfigTable,
    funnelStatTable: FunnelStatTable,
    versionTable: VersionTable,
    panoDataService: PanoDataService
)(implicit val ec: ExecutionContext)
    extends ConfigService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

  /**
   * Per-label-type counts for the original DC deployment (2015–2017), preserved from the historical spreadsheet:
   * https://docs.google.com/spreadsheets/d/1eTwVuEIz2lV-LD-Vz_5knNoyGgzmH5kERsQ0y_jGHDE/
   *
   * That deployment used an outdated schema too costly to migrate, so these hard-coded counts are folded into the
   * aggregate stats to represent Project Sidewalk's full historical scope. DC only ever had these seven label types
   * (Crosswalk and Pedestrian Signal did not exist yet).
   *
   * These per-type rows sum to 249,905. The spreadsheet also lists 263,403, which is the UNFILTERED count: the
   * ~13,498 difference is DC's tutorial labels plus "junk"-user labels (low-quality users Mikey identified by manual
   * assessment) — exactly the labels our stats exclude elsewhere via `tutorial = FALSE` and `NOT user_stat.excluded`.
   * So 249,905 is the correct filtered `total_labels` (consistent with how live cities are counted), and 263,403 must
   * NOT be used as the total. `legacyDCData.totalLabels` is therefore derived from this breakdown (#3981).
   */
  private val legacyDCByLabelType: Map[String, LabelTypeStats] = Map(
    LabelTypeEnum.CurbRamp.name -> LabelTypeStats(
      labels = 150680,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.NoCurbRamp.name -> LabelTypeStats(
      labels = 19792,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.Obstacle.name -> LabelTypeStats(
      labels = 22264,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.SurfaceProblem.name -> LabelTypeStats(
      labels = 8964,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.NoSidewalk.name -> LabelTypeStats(
      labels = 45395,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.Other.name -> LabelTypeStats(
      labels = 1471,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    ),
    LabelTypeEnum.Occlusion.name -> LabelTypeStats(
      labels = 1339,
      labelsValidated = 0,
      labelsValidatedAgree = 0,
      labelsValidatedDisagree = 0
    )
    // Note: Crosswalk and Signal data not available (NA) for DC legacy deployment.
  )

  /**
   * DC's UNFILTERED historical label count from the source spreadsheet (gid=963888605 tab):
   * https://docs.google.com/spreadsheets/d/1eTwVuEIz2lV-LD-Vz_5knNoyGgzmH5kERsQ0y_jGHDE/edit?gid=963888605#gid=963888605
   *
   * This counts everything, including tutorial and low-quality "junk"-user labels. It is NOT the reportable total — see
   * `legacyDCData` for how the filtered total and `tutorialLabels` are derived from it.
   */
  private val legacyDCUnfilteredLabelCount = 263403

  /**
   * Distinct contributors from the legacy DC deployment, a fixed historical estimate (#3976).
   *
   * The archived DC dataset has no per-user records we can query, so unlike live cities its user count can't be derived
   * from the union of contributor ids. This value (from the gid=963888605 tab of the DC spreadsheet linked above) is
   * added on top of the live-city distinct-user union in getAggregateStats. DC user_ids don't exist in current schemas,
   * so there is nothing to dedup against — the addition is exact.
   */
  private val legacyDCUserCount = 1395

  /**
   * Legacy DC deployment rolled into an AggregateStats so getAggregateStats can sum it alongside live cities.
   *
   * `totalLabels` is derived from `legacyDCByLabelType` (249,905, the filtered count), NOT the unfiltered 263,403
   * headline, so the per-type breakdown always reconciles with the total (see `legacyDCByLabelType` above).
   *
   * `tutorialLabels` is the gap between the unfiltered count and the filtered total (263,403 − 249,905 = 13,498) so
   * DC's numbers close cleanly back to the historical headline. CAVEAT: for live cities `tutorialLabels` is strictly
   * `tutorial = TRUE` labels, but DC's export can't separate tutorial from junk-user labels, so this single legacy
   * value bundles both and is really an UPPER BOUND on DC's tutorial labels. Documented as such in the API docs.
   *
   * Validations were never implemented during the DC deployment, so `totalValidations` is 0.
   *
   * `totalUsers` is 0 here: DC's contributors are added separately via `legacyDCUserCount` (they can't be deduped by
   * union like live-city users), so this field must NOT also contribute to the aggregate user count.
   */
  private val legacyDCData = AggregateStats(
    kmExplored = 5482.0,
    kmExploredNoOverlap = 1747, // Mikey calculated this for us on July 18, 2025
    totalLabels = legacyDCByLabelType.values.map(_.labels).sum,
    tutorialLabels = legacyDCUnfilteredLabelCount - legacyDCByLabelType.values.map(_.labels).sum,
    totalValidations = 0,
    totalUsers = 0,
    numCities = 0,
    numCountries = 0,
    numLanguages = 0,
    byLabelType = legacyDCByLabelType
  )

  /**
   * Maps a city ID to its corresponding database user/schema. The mapping is loaded from configuration.
   *
   * @param cityId The ID of the city.
   * @return The database schema name for the city.
   * @throws com.typesafe.config.ConfigException.Missing if the cityId is not found in the configuration
   */
  def getCitySchema(cityId: String): String = {
    // Try to get schema from configuration.
    val configPath = s"city-params.db-schema.$cityId"
    try {
      config.get[String](configPath)
    } catch {
      case e: ConfigException => // Catching any ConfigException (or be more specific like ConfigException.Missing).
        val errorMessage = s"Configuration error for city ID '$cityId' at path '$configPath'."
        // Log the error, including the original exception's stack trace.
        logger.error(errorMessage, e)
        throw e // Rethrow the original caught exception.
    }
  }

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method handles the special case of the current city separately, as it can use the standard method that doesn't
   * require cross-schema access. For other cities, it resolves the schema name and queries that schema. Results are
   * cached to improve performance.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]] = {
    // For the current city, use the standard method which doesn't require cross-schema access.
    if (cityId == getCityId) {
      getCityMapParams.map(Some(_))
    } else {
      // For other cities, get the schema name and query that schema.
      val schema = getCitySchema(cityId)

      // Use cache to avoid repeated database queries.
      cacheApi.getOrElseUpdate[Option[MapParams]](s"getMapParams_$cityId", Duration(1, "days")) {
        try {
          // Attempt to run the database query.
          db.run(configTable.getCityMapParamsBySchema(schema))
            .map(Some(_)) // Wrap successful result in Some.
            .recover { case e: Exception =>
              // Log failures but don't propagate exceptions.
              logger.warn(s"Failed to retrieve map params for city $cityId from schema $schema: ${e.getMessage}")
              None // Return None when query fails.
            }
        } catch {
          case e: Exception =>
            // Handle exceptions during query preparation (rare).
            logger.error(s"Exception setting up query for city $cityId: ${e.getMessage}", e)
            Future.successful(None)
        }
      }
    }
  }

  def getCityScorecards(): Future[Seq[CityScorecardWithFlags]] = {
    // Heavier than getAggregateStats (a multi-subquery per city) and only viewed by Owners, so cache a bit longer.
    cacheApi.getOrElseUpdate[Seq[CityScorecardWithFlags]]("getCityScorecards", Duration(10, "minutes")) {
      // Same available-schema guard as getAggregateStats. "staging" is skipped (not a real deployment), as in
      // CitiesApiController; legacy DC is skipped because it predates the modern label_validation schema.
      val configuredCityIds = config.get[Seq[String]]("city-params.city-ids").filter(_ != "staging")

      val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
        try {
          val schema = getCitySchema(cityId)
          checkSchemaExists(schema).map(cityId -> _).recover { case _ => cityId -> false }
        } catch {
          case _: Exception => Future.successful(cityId -> false)
        }
      }

      Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
        val availableCities = schemaResults.filter(_._2).map(_._1)

        // Query each available city in parallel; one failing schema yields None rather than sinking the whole page.
        val scorecardFutures: Seq[Future[Option[CityScorecard]]] = availableCities.map { cityId =>
          val schema = getCitySchema(cityId)
          db.run(configTable.getCityScorecardBySchema(schema))
            .map(sc => Some(sc.copy(cityId = cityId))) // The DAO only knows the schema; restore the real cityId here.
            .recover { case e: Exception =>
              logger.warn(s"Failed to compute scorecard for city $cityId (schema $schema): ${e.getMessage}")
              None
            }
        }

        Future.sequence(scorecardFutures).map(opts => flagAnomalies(opts.flatten))
      }
    }
  }

  def getCrossCityWeeklyTrend(weeks: Option[Int]): Future[Seq[WeeklyPoint]] = {
    val cacheKey = s"getCrossCityWeeklyTrend_${weeks.map(_.toString).getOrElse("all")}"
    cacheApi.getOrElseUpdate[Seq[WeeklyPoint]](cacheKey, Duration(10, "minutes")) {
      val configuredCityIds = config.get[Seq[String]]("city-params.city-ids").filter(_ != "staging")

      val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
        try {
          checkSchemaExists(getCitySchema(cityId)).map(cityId -> _).recover { case _ => cityId -> false }
        } catch {
          case _: Exception => Future.successful(cityId -> false)
        }
      }

      Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
        val availableCities = schemaResults.filter(_._2).map(_._1)
        val perCityFutures  = availableCities.map { cityId =>
          db.run(configTable.getCityWeeklyTrendBySchema(getCitySchema(cityId), weeks))
            .recover { case e: Exception =>
              logger.warn(s"Failed to fetch weekly trend for city $cityId: ${e.getMessage}")
              Seq.empty[WeeklyPoint]
            }
        }
        Future.sequence(perCityFutures).map { perCity =>
          // Sum each city's weekly points into one cross-city series, week by week.
          perCity.flatten
            .groupBy(_.weekStart)
            .toSeq
            .sortBy(_._1)
            .map { case (week, pts) =>
              WeeklyPoint(week, pts.map(_.labels).sum, pts.map(_.validations).sum, pts.map(_.activeUsers).sum)
            }
        }
      }
    }
  }

  def getCrossCityLabelingSpeed(): Future[Map[String, Double]] = {
    // Daily cache: this is the heavy interaction-table scan, and labeling speed barely moves day to day.
    cacheApi.getOrElseUpdate[Map[String, Double]]("getCrossCityLabelingSpeed", Duration(24, "hours")) {
      val configuredCityIds = config.get[Seq[String]]("city-params.city-ids").filter(_ != "staging")

      val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
        try {
          checkSchemaExists(getCitySchema(cityId)).map(cityId -> _).recover { case _ => cityId -> false }
        } catch {
          case _: Exception => Future.successful(cityId -> false)
        }
      }

      Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
        val availableCities                                       = schemaResults.filter(_._2).map(_._1)
        val perCityFutures: Seq[Future[Option[(String, Double)]]] = availableCities.map { cityId =>
          db.run(configTable.getCityLabelingSpeedBySchema(getCitySchema(cityId)))
            .map { case (hours, km) =>
              // Only report cities with both interaction data and audited distance; otherwise speed is unknowable.
              if (hours > 0 && km > 0) Some(cityId -> (hours * 3600.0) / (km * 10.0)) else None
            }
            .recover { case e: Exception =>
              logger.warn(s"Failed to compute labeling speed for city $cityId: ${e.getMessage}")
              None
            }
        }
        Future.sequence(perCityFutures).map(_.flatten.toMap)
      }
    }
  }

  def getCityFunnels(window: String): Future[Map[String, Seq[CityFunnel]]] = {
    // Reads the precomputed funnel_stat per schema, so it is cheap; the short cache just coalesces bursts of requests.
    cacheApi.getOrElseUpdate[Map[String, Seq[CityFunnel]]](s"getCityFunnels_$window", Duration(10, "minutes")) {
      val configuredCityIds = config.get[Seq[String]]("city-params.city-ids").filter(_ != "staging")

      val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
        try {
          checkSchemaExists(getCitySchema(cityId)).map(cityId -> _).recover { case _ => cityId -> false }
        } catch {
          case _: Exception => Future.successful(cityId -> false)
        }
      }

      Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
        val availableCities = schemaResults.filter(_._2).map(_._1)
        // Each city's rows cover all funnel types for this window; None ⇒ no funnel_stat yet, so omit the city.
        val perCityFutures: Seq[Future[Option[(String, Seq[FunnelStat])]]] = availableCities.map { cityId =>
          db.run(funnelStatTable.getFunnelStatsBySchema(getCitySchema(cityId), window))
            .map(rows => if (rows.isEmpty) None else Some(cityId -> rows))
            .recover { case e: Exception =>
              logger.warn(s"Failed to read funnel for city $cityId (window $window): ${e.getMessage}")
              None
            }
        }
        Future.sequence(perCityFutures).map { results =>
          val citiesWithRows = results.flatten
          // Group into funnelType -> one CityFunnel per city, in the page's funnel order.
          ConfigService.FunnelDefs.map { case (funnelType, _) =>
            funnelType -> citiesWithRows.map { case (cityId, rows) =>
              ConfigService.assembleCityFunnel(cityId, funnelType, rows.filter(_.funnelType == funnelType))
            }
          }.toMap
        }
      }
    }
  }

  def getCurrentCityFunnels(window: String): Future[CurrentCityFunnels] = {
    // Reads only this deployment's own precomputed funnel_stat (no cross-schema fan-out), so it is cheap; the short
    // cache just coalesces bursts of requests from the Contributors page.
    cacheApi.getOrElseUpdate[CurrentCityFunnels](s"getCurrentCityFunnels_$window", Duration(10, "minutes")) {
      val cityId = getCityId
      db.run(funnelStatTable.getFunnelStatsBySchema(getCitySchema(cityId), window)).map { rows =>
        // No rows yet (the nightly FunnelStatActor hasn't run, or /adminapi/updateFunnelStats hasn't been hit): return
        // an empty result so the page can show its "no funnel data yet" state rather than zero-filled funnels.
        if (rows.isEmpty) CurrentCityFunnels(None, Map.empty)
        else {
          val byType = ConfigService.FunnelDefs.map { case (funnelType, _) =>
            funnelType -> ConfigService.assembleCityFunnel(cityId, funnelType, rows.filter(_.funnelType == funnelType))
          }.toMap
          CurrentCityFunnels(rows.headOption.map(_.computedAt), byType)
        }
      }
    }
  }

  def invalidateFunnelCaches(): Future[Unit] = {
    // Both reads cache per window for 10 min; drop every window's entry so a recompute is reflected immediately rather
    // than after the TTL. Tiny, fixed key set — cheaper and clearer than a tagged/region cache.
    Future
      .sequence(ConfigService.FunnelWindowKeys.flatMap { w =>
        Seq(cacheApi.remove(s"getCityFunnels_$w"), cacheApi.remove(s"getCurrentCityFunnels_$w"))
      })
      .map(_ => ())
  }

  /**
   * Attaches data-quality anomaly flags to each scorecard, using the full set for the relative (median-based) check
   * (#4329). The activity/coverage story is carried separately by the lifecycle classification
   * ([[ConfigService.lifecycle]]), not here, so this only surfaces "high_disagreement".
   *
   * @param scorecards All gathered per-city scorecards.
   * @return           Each scorecard paired with its data-quality flags.
   */
  private def flagAnomalies(scorecards: Seq[CityScorecard]): Seq[CityScorecardWithFlags] = {
    val medianDisagreement = ConfigService.medianDisagreementRate(scorecards)

    scorecards.map { sc =>
      val flags = scala.collection.mutable.ListBuffer.empty[String]

      // Outlier disagreement, but only among cities with a meaningful validation volume.
      if (
        sc.totalValidations >= ConfigService.MinValidationsForDisagreement &&
        ConfigService.disagreementRate(sc) > medianDisagreement * ConfigService.DisagreementMedianMultiple
      ) {
        flags += "high_disagreement"
      }

      CityScorecardWithFlags(sc, flags.toSeq)
    }
  }

  /** Cached aggregate stats plus when they were computed, so stale data can be served while a refresh runs (#4600). */
  private case class TimestampedAggregateStats(stats: AggregateStats, computedAt: OffsetDateTime)

  private val aggregateStatsCacheKey = "getAggregateStats"

  /** The in-flight aggregate-stats computation, if any; concurrent refreshes share it instead of re-querying. */
  private var aggregateStatsRefresh: Option[Future[AggregateStats]] = None

  /**
   * Calculates aggregate statistics across all Project Sidewalk deployments, serving cached results when available.
   *
   * The computation fans out several aggregate queries to every configured city schema, which can take well over 10s
   * on a loaded database — long enough that a request hitting an expired cache would time out client-side (#4600). So
   * cached stats are served immediately for up to [[ConfigService.AggregateStatsMaxAge]], with a single background
   * recompute triggered once they are older than [[ConfigService.AggregateStatsFreshFor]]. Only the first request
   * after a JVM start (nothing cached yet) waits for the full computation.
   *
   * @return A Future containing aggregated statistics across all cities
   */
  def getAggregateStats(): Future[AggregateStats] = {
    cacheApi.get[TimestampedAggregateStats](aggregateStatsCacheKey).flatMap {
      case Some(cached) =>
        val ageSeconds = ChronoUnit.SECONDS.between(cached.computedAt, OffsetDateTime.now())
        if (ageSeconds >= ConfigService.AggregateStatsFreshFor.toSeconds) { val _ = refreshAggregateStats() }
        Future.successful(cached.stats)
      case None => refreshAggregateStats() // Nothing cached yet (first call since JVM start): wait for the compute.
    }
  }

  /**
   * Recomputes aggregate stats and caches the result, coalescing concurrent calls into one shared computation.
   *
   * @return The freshly computed stats, or the computation's failure (already-cached data is left untouched).
   */
  private def refreshAggregateStats(): Future[AggregateStats] = synchronized {
    aggregateStatsRefresh.getOrElse {
      val computation = computeAggregateStats().flatMap { stats =>
        cacheApi
          .set(
            aggregateStatsCacheKey,
            TimestampedAggregateStats(stats, OffsetDateTime.now()),
            ConfigService.AggregateStatsMaxAge
          )
          .map(_ => stats)
      }
      computation.onComplete { result =>
        synchronized { aggregateStatsRefresh = None }
        result.failed.foreach(e => logger.warn(s"Aggregate stats recompute failed: ${e.getMessage}", e))
      }
      aggregateStatsRefresh = Some(computation)
      computation
    }
  }

  /**
   * Runs the full cross-schema fan-out that computes aggregate statistics.
   *
   * Uses direct database queries with cross-schema access to gather only the essential statistics from all configured
   * cities. Filters out cities whose schemas don't exist in the current environment (so plays nice with localhost dev
   * setups). Additionally, calculates deployment counts for cities, countries, and supported languages.
   *
   * @return A Future containing freshly computed aggregate statistics across all cities
   */
  private def computeAggregateStats(): Future[AggregateStats] = {
    // Get all configured city IDs.
    val configuredCityIds = config.get[Seq[String]]("city-params.city-ids")

    // Filter to only include cities whose schemas actually exist in the database.
    val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
      try {
        val schema = getCitySchema(cityId)
        // Check if the schema actually exists in the database.
        checkSchemaExists(schema).map(cityId -> _).recover { case _ => cityId -> false }
      } catch {
        case _: Exception =>
          Future.successful(cityId -> false)
      }
    }

    // Wait for all schema checks to complete.
    Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
      val availableCities = schemaResults.filter(_._2).map(_._1)

      if (availableCities.isEmpty) {
        logger.warn("No cities with valid schemas found")
        Future.successful(
          AggregateStats(
            kmExplored = 0.0, kmExploredNoOverlap = 0.0, totalLabels = 0, tutorialLabels = 0, totalValidations = 0,
            totalUsers = 0, numCities = 0, numCountries = 0, numLanguages = 0, byLabelType = Map.empty
          )
        )
      } else {
        // Calculate deployment statistics.
        val numCities    = availableCities.length + 1 // +1 for legacy DC city
        val numCountries = calculateNumCountries(availableCities)
        val numLanguages = calculateNumLanguages()

        // Fetch essential statistics from available cities in parallel.
        val cityStatsFutures: Seq[Future[Option[AggregateStats]]] = availableCities.map { cityId =>
          getCityAggregateData(cityId)
        }

        // Distinct contributors across all live cities, deduped by the global `user_id` then DC added on top (#3976).
        // Computed by unioning per-city contributor-id sets rather than summing per-city counts, so a user active in
        // multiple cities is counted once. Each city recovers to an empty set so one bad schema can't sink the count.
        val distinctUsersFut: Future[Int] = Future
          .sequence(availableCities.map { cityId =>
            db.run(configTable.getContributorUserIdsBySchema(getCitySchema(cityId)))
              .map(_.toSet)
              .recover { case e: Exception =>
                logger.warn(s"Failed to retrieve contributor ids for city $cityId: ${e.getMessage}")
                Set.empty[String]
              }
          })
          .map(perCity => perCity.foldLeft(Set.empty[String])(_ ++ _).size + legacyDCUserCount)

        // Wait for all futures to complete and aggregate results.
        Future.sequence(cityStatsFutures).zip(distinctUsersFut).map { case (cityStatsOptions, totalUsers) =>
          // Filter out failed requests and aggregate the successful ones.
          val validCityStats = cityStatsOptions.flatten

          if (validCityStats.isEmpty) {
            logger.warn("No valid city statistics found for aggregate calculation")
            // Return empty aggregate stats if no cities provided data.
            AggregateStats(
              kmExplored = 0.0, kmExploredNoOverlap = 0.0, totalLabels = 0, tutorialLabels = 0, totalValidations = 0,
              totalUsers = 0, numCities = numCities, numCountries = numCountries, numLanguages = numLanguages,
              byLabelType = Map.empty
            )
          } else {
            // Add legacy DC data to the valid city stats before aggregating.
            aggregateCityData(validCityStats :+ legacyDCData, numCities, numCountries, numLanguages, totalUsers)
          }
        }
      }
    }
  }

  def getAggregateStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]] = {
    val configuredCityIds = config.get[Seq[String]]("city-params.city-ids")

    val schemaChecks = configuredCityIds.map { cityId =>
      try {
        val schema = getCitySchema(cityId)
        checkSchemaExists(schema).map(cityId -> _).recover { case _ => cityId -> false }
      } catch {
        case _: Exception => Future.successful(cityId -> false)
      }
    }

    Future.sequence(schemaChecks).flatMap { results =>
      val availableCities = results.filter(_._2).map(_._1)

      if (availableCities.isEmpty) {
        Future.successful(Seq.empty)
      } else {
        val cityDataFutures = availableCities.map { cityId =>
          val schema       = getCitySchema(cityId)
          val labelsFuture = db
            .run(configTable.getCityDailyLabelStatsBySchema(schema, startDate, endDate, filterLowQuality))
            .recover { case e: Exception =>
              logger.warn(s"Failed daily label stats for city $cityId: ${e.getMessage}")
              Seq.empty[(LocalDate, String, Int, Int)]
            }
          val valsFuture = db
            .run(configTable.getCityDailyValidationStatsBySchema(schema, startDate, endDate, filterLowQuality))
            .recover { case e: Exception =>
              logger.warn(s"Failed daily validation stats for city $cityId: ${e.getMessage}")
              Seq.empty[(LocalDate, String, Int, Int, Int, Int, Int, Int)]
            }
          for {
            labels      <- labelsFuture
            validations <- valsFuture
          } yield DailyStatRecord.merge(labels, validations)
        }

        Future.sequence(cityDataFutures).map { cityResults =>
          // Sum all numeric fields across cities, grouped by (date, labelType).
          cityResults.flatten
            .groupBy(r => (r.date, r.labelType))
            .map { case ((date, labelType), records) =>
              DailyStatRecord(
                date = date,
                labelType = labelType,
                humanLabels = records.map(_.humanLabels).sum,
                aiLabels = records.map(_.aiLabels).sum,
                humanValidationsAgree = records.map(_.humanValidationsAgree).sum,
                humanValidationsDisagree = records.map(_.humanValidationsDisagree).sum,
                humanValidationsUnsure = records.map(_.humanValidationsUnsure).sum,
                aiValidationsAgree = records.map(_.aiValidationsAgree).sum,
                aiValidationsDisagree = records.map(_.aiValidationsDisagree).sum,
                aiValidationsUnsure = records.map(_.aiValidationsUnsure).sum
              )
            }
            .toSeq
            .sortBy(r => (r.date, r.labelType))
        }
      }
    }
  }

  /**
   * Fetches essential aggregate data for a specific city using direct database access.
   * This method does NOT use caching since it's called from within a cached context.
   *
   * @param cityId The ID of the city to retrieve statistics for
   * @return A Future containing optional aggregate data for the city
   */
  private def getCityAggregateData(cityId: String): Future[Option[AggregateStats]] = {
    // Get the schema name.
    val schemaResult =
      try {
        Some(getCitySchema(cityId))
      } catch {
        case e: Exception =>
          logger.error(s"Failed to get schema for city $cityId: ${e.getMessage}", e)
          None
      }

    schemaResult match {
      case Some(schema) =>
        try {
          // Direct database query without additional caching.
          db.run(configTable.getCityAggregateDataBySchema(schema))
            .map(Some(_)) // Wrap successful result in Some
            .recover { case e: Exception =>
              // Log failures but don't propagate exceptions.
              logger.warn(s"Failed to retrieve aggregate data for city $cityId from schema $schema: ${e.getMessage}")
              None // Return None when query fails
            }
        } catch {
          case e: Exception =>
            // Handle exceptions during query preparation.
            logger.error(s"Exception setting up aggregate data query for city $cityId: ${e.getMessage}", e)
            Future.successful(None)
        }
      case None =>
        Future.successful(None)
    }
  }

  /**
   * Calculates the number of unique countries from available cities.
   *
   * @param cityIds List of available city IDs
   * @return Number of unique countries
   */
  private def calculateNumCountries(cityIds: Seq[String]): Int = {
    val countries = cityIds.flatMap { cityId =>
      try {
        Some(config.get[String](s"city-params.country-id.$cityId"))
      } catch {
        case e: ConfigException =>
          logger.warn(s"Could not get country ID for city $cityId: ${e.getMessage}")
          None
      }
    }.toSet
    countries.size
  }

  /**
   * Calculates the number of supported languages from configuration.
   *
   * Language variants (e.g., "en-US", "zh-TW", "es-MX") are grouped by their base language code
   * following ISO 639-1 standard where the part before the hyphen represents the base language.
   * For example: "en", "en-US", "en-NZ" all count as one language (English).
   *
   * @return Number of distinct base languages supported
   */
  private def calculateNumLanguages(): Int = {
    try {
      val configuredLanguages = config.get[Seq[String]]("play.i18n.langs")

      // Extract base language codes by taking everything before the first hyphen
      val baseLanguages = configuredLanguages.map { lang => lang.split("-").head.toLowerCase }.toSet

      baseLanguages.size
    } catch {
      case e: ConfigException =>
        logger.warn(s"Could not get language configuration: ${e.getMessage}")
        1 // Default to 1 if configuration is missing
    }
  }

  /**
   * Aggregates data from multiple cities into a single result.
   *
   * This method combines the individual city data into aggregate totals and includes deployment statistics.
   *
   * @param cityData Sequence of city aggregate data to combine
   * @param numCities Number of cities in deployment
   * @param numCountries Number of countries in deployment
   * @param numLanguages Number of languages supported
   * @param totalUsers Distinct contributors across all deployments. Passed in (like numCountries/numLanguages) rather
   *                   than summed from `cityData`, because it is a cross-schema deduped union, not a per-city sum (#3976).
   * @return Aggregated statistics across all provided cities
   */
  private def aggregateCityData(
      cityData: Seq[AggregateStats],
      numCities: Int,
      numCountries: Int,
      numLanguages: Int,
      totalUsers: Int
  ): AggregateStats = {
    import scala.collection.mutable

    // Aggregate basic metrics.
    val totalKmExplored          = cityData.map(_.kmExplored).sum
    val totalKmExploredNoOverlap = cityData.map(_.kmExploredNoOverlap).sum
    val totalLabelsCount         = cityData.map(_.totalLabels).sum
    val tutorialLabelsCount      = cityData.map(_.tutorialLabels).sum
    val totalValidationsCount    = cityData.map(_.totalValidations).sum

    // Aggregate label type statistics.
    val labelTypeStatsMap = mutable.Map[String, LabelTypeStats]()

    cityData.foreach { city =>
      city.byLabelType.foreach { case (labelType, stats) =>
        val currentStats = labelTypeStatsMap.getOrElse(labelType, LabelTypeStats(0, 0, 0, 0))

        // Update the aggregated stats.
        labelTypeStatsMap(labelType) = LabelTypeStats(
          labels = currentStats.labels + stats.labels,
          labelsValidated = currentStats.labelsValidated + stats.labelsValidated,
          labelsValidatedAgree = currentStats.labelsValidatedAgree + stats.labelsValidatedAgree,
          labelsValidatedDisagree = currentStats.labelsValidatedDisagree + stats.labelsValidatedDisagree
        )
      }
    }

    AggregateStats(
      kmExplored = totalKmExplored, kmExploredNoOverlap = totalKmExploredNoOverlap, totalLabels = totalLabelsCount,
      tutorialLabels = tutorialLabelsCount, totalValidations = totalValidationsCount, totalUsers = totalUsers,
      numCities = numCities, numCountries = numCountries, numLanguages = numLanguages,
      byLabelType = labelTypeStatsMap.toMap
    )
  }

  /**
   * Checks if a database schema exists.
   *
   * @param schemaName The name of the schema to check
   * @return A Future containing true if the schema exists, false otherwise
   */
  private def checkSchemaExists(schemaName: String): Future[Boolean] = {
    db.run(
      sql"""
        SELECT EXISTS(
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = $schemaName
        )
      """.as[Boolean].head
    ).recover { case _ => false }
  }

  def getCityMapParams: Future[MapParams] =
    cacheApi.getOrElseUpdate[MapParams]("getCityMapParams")(db.run(configTable.getCityMapParams))

  def getTutorialStreetId: Future[Int] =
    cacheApi.getOrElseUpdate[Int]("getTutorialStreetId")(db.run(configTable.getTutorialStreetId))

  def getMakeCrops: Future[Boolean] =
    cacheApi.getOrElseUpdate[Boolean]("getMakeCrops")(db.run(configTable.getMakeCrops))

  def getMapathonEventLink: Future[Option[String]] =
    cacheApi.getOrElseUpdate[Option[String]]("getMapathonEventLink")(db.run(configTable.getMapathonEventLink))

  def getOpenStatus: Future[String] =
    cacheApi.getOrElseUpdate[String]("getOpenStatus")(db.run(configTable.getOpenStatus))

  def getOffsetHours: Future[Int] = cacheApi.getOrElseUpdate[Int]("getOffsetHours")(db.run(configTable.getOffsetHours))

  def getExcludedTags: DBIO[Seq[ExcludedTag]] = cachedDBIO("getExcludedTags")(configTable.getExcludedTagsString)

  def getAllCityInfo(lang: Lang): Seq[CityInfo] = {
    val currentCityId    = config.get[String]("city-id")
    val currentCountryId = config.get[String](s"city-params.country-id.$currentCityId")
    val envType          = config.get[String]("environment-type")

    val cityIds = config.get[Seq[String]]("city-params.city-ids")
    cityIds.map { cityId =>
      val stateId    = config.get[Option[String]](s"city-params.state-id.$cityId")
      val countryId  = config.get[String](s"city-params.country-id.$cityId")
      val cityURL    = config.get[String](s"city-params.landing-page-url.$envType.$cityId")
      val visibility = config.get[String](s"city-params.status.$cityId")

      val cityName          = messagesApi(s"city.name.$cityId")(lang)
      val cityNameShort     = config.get[Option[String]](s"city-params.city-short-name.$cityId").getOrElse(cityName)
      val cityNameFormatted =
        if (currentCountryId == "usa" && stateId.isDefined && countryId == "usa")
          messagesApi("city.state", cityName, messagesApi(s"state.name.${stateId.get}")(lang))(lang)
        else
          messagesApi("city.state", cityName, messagesApi(s"country.name.$countryId")(lang))(lang)

      CityInfo(cityId, stateId, countryId, cityNameShort, cityNameFormatted, cityURL, visibility)
    }
  }

  def sha256Hash(text: String): String =
    String.format(
      "%064x",
      new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8")))
    )

  /**
   * Send a POST request to SciStarter to record the user's contributions.
   * @param email         The email address of the user who contributed. Will be hashed in POST request.
   * @param contributions Number of contributions. Either number of labels created or number of labels validated.
   * @param timeSpent     Total time spent on those contributions in seconds.
   * @return Response code from the API request.
   */
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Double): Future[Int] = {
    // Make API call, logging any errors.
    ws.url("https://scistarter.org/api/participation/hashed/project-sidewalk")
      .withQueryStringParameters("key" -> config.get[String]("scistarter-api-key"))
      .withHttpHeaders("Content-Type" -> "application/x-www-form-urlencoded")
      .post(
        Map(
          "hashed"   -> Seq(sha256Hash(email)),
          "type"     -> Seq("classification"),
          "count"    -> Seq(contributions.toString),
          "duration" -> Seq((timeSpent / contributions).toString)
        )
      )
      .map(response => response.status)
      .recover { case e: Exception =>
        logger.warn(s"Error sending contributions to SciStarter: ${e.getMessage}")
        throw e
      }
  }

  def getCityId: String = config.get[String]("city-id")

  def getCurrentCountryId: String = config.get[String](s"city-params.country-id.$getCityId")

  def getCityName(lang: Lang): String = messagesApi(s"city.name.$getCityId")(lang)

  def getAiTagSuggestionsEnabled: Boolean = config.get[Boolean](s"city-params.ai-tag-suggestions-enabled.$getCityId")

  // A city omitted from private-profiles-by-default (or a deployment whose config predates the block entirely) is
  // public by default. hasPath returns false for a missing key OR a missing parent block, so this never throws.
  def getPrivateProfilesByDefault: Boolean = {
    val path = s"city-params.private-profiles-by-default.$getCityId"
    config.underlying.hasPath(path) && config.get[Boolean](path)
  }

  def getPanoSource: PanoSource = PanoSource.withName(config.get[String](s"city-params.pano-viewer-type.$getCityId"))

  // Uses Play's cache API to cache the result of a DBIO.
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T] = {
    DBIO.from(cacheApi.get[T](key)).flatMap {
      case Some(cached) => DBIO.successful(cached)
      case None         =>
        dbOperation.map { result =>
          cacheApi.set(key, result, duration)
          result
        }
    }
  }

  def getCommonPageData(lang: Lang): Future[CommonPageData] = {
    for {
      version: Version <- cacheApi.getOrElseUpdate[Version]("currentVersion")(versionTable.currentVersion())
      cityId: String            = getCityId
      envType: String           = config.get[String]("environment-type")
      googleAnalyticsId: String = config.get[String](s"city-params.google-analytics-4-id.$envType.$cityId")
      prodUrl: String           = config.get[String](s"city-params.landing-page-url.prod.$cityId")
      gMapsApiKey: String       = config.get[String]("google-maps-api-key")
      imagerySource: PanoSource = PanoSource.withName(config.get[String](s"city-params.pano-viewer-type.$cityId"))
      imageryAccessToken: String <-
        if (imagerySource == PanoSource.Gsv) Future.successful(gMapsApiKey)
        else if (imagerySource == PanoSource.Infra3d) panoDataService.getInfra3dToken(cityId)
        else if (imagerySource == PanoSource.Mapillary) Future.successful(config.get[String]("mapillary-access-token"))
        else Future.failed(new Exception("No valid imagery source specified"))
      gMapsApiKey: String        = config.get[String]("google-maps-api-key")
      mapboxApiKey: String       = config.get[String]("mapbox-api-key")
      allCityInfo: Seq[CityInfo] = getAllCityInfo(lang)
    } yield {
      CommonPageData(cityId, envType, googleAnalyticsId, prodUrl, imagerySource, imageryAccessToken, gMapsApiKey,
        mapboxApiKey, version.versionId, version.versionStartTime, allCityInfo)
    }
  }
}
