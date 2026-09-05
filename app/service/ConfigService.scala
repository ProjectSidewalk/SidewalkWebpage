package service

import com.google.inject.ImplementedBy
import com.typesafe.config.ConfigException
import models.api.{AggregateStats, DailyStatRecord, LabelTypeStats}
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile.api._
import models.utils._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import play.twirl.api.Html
import slick.dbio.DBIO

import java.lang.management.ManagementFactory
import java.time.{Instant, LocalDate, OffsetDateTime, ZoneId, ZoneOffset}
import java.time.temporal.ChronoUnit
import javax.inject._
import scala.concurrent.duration.{Duration, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

/**
 * Which cities the by-name global leaderboard may read, split by what it may read them for (#3719).
 *
 * The two sets differ because contributing and opting out are asymmetric: a city has to clear every bar to put its
 * mappers' labels on a public, cross-deployment board, but a mapper's "don't name me" is worth honoring from any city
 * where the flag actually means that. Aggregate, non-identifying totals (the community-impact band, /v3/api stats) are
 * unaffected by either set and still cover every city (#4480).
 *
 * @param cities        (cityId, schema) pairs whose labels, distance, and missions count toward the board, in
 *                      configured order. A city qualifies only if it is a real, publicly launched deployment that has
 *                      not opted out, does not default profiles to private, and is far enough along on evolutions to
 *                      have every column the query reads.
 * @param optOutSchemas Schemas to additionally honor `on_leaderboard = FALSE` from without counting their
 *                      contributions — leaderboard-ready deployments held out of `cities` for a reason unrelated to
 *                      what the flag means there. Excludes private-by-default deployments, where the flag starts off
 *                      for everyone and so cannot be read as a deliberate opt-out.
 */
case class GlobalLeaderboardScope(cities: Seq[(String, String)], optOutSchemas: Seq[String])

/**
 * Which cities a self-view fan-out may read, and which it had to leave out (#4526).
 *
 * @param cities         (cityId, schema) pairs in configured order.
 * @param skippedSchemas Schemas held back because they lack a column the query reads. A volunteer's hours page reports
 *                       this count to the reader, since a dropped city can only ever make their total look smaller.
 */
case class SelfViewScope(cities: Seq[(String, String)], skippedSchemas: Seq[String])

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
    versionDescription: Option[String],
    appStartTime: OffsetDateTime,
    buildCommit: Option[String],
    buildDescribe: Option[String],
    buildDirty: Boolean,
    allCityInfo: Seq[CityInfo],
    // Content-fingerprint digests for the assets JS builds URLs for, serialized once at startup by
    // AssetManifestService; stamped on every page for util.assetPath (#4893).
    assetDigestsJson: Html
) {

  /** The deployment city's info; cityId always comes from the same config that builds allCityInfo. */
  def currentCity: CityInfo = allCityInfo.find(_.cityId == cityId).get
}

/**
 * One deployment's headline totals, for the Leaderboard's city-scoped hero band (#4687).
 *
 * A slice of the per-city data [[AggregateStats]] already fans out for, so the two bands on the Leaderboard use
 * identical definitions and every hero number is a strict subset of its cross-city counterpart.
 *
 * `kmExploredNoOverlap` is the distance metric here rather than `kmExplored`: the latter sums every completed
 * `audit_task`, so a street audited by three people counts three times, which on a band that names the city can print
 * more miles than the city has streets. Only cities where both the stats and the contributor query succeeded get a
 * `CityImpact`, so a partial failure can't render a tile reading zero next to tiles reading six figures.
 *
 * @param contributors        Distinct non-excluded users who added a non-tutorial label or validated one in this city.
 * @param totalLabels         Non-tutorial, non-deleted labels from non-excluded users.
 * @param totalValidations    Validations from non-excluded users.
 * @param kmExploredNoOverlap Kilometers of distinct streets with a completed audit task.
 */
case class CityImpact(contributors: Int, totalLabels: Int, totalValidations: Int, kmExploredNoOverlap: Double)

/**
 * One week's contribution volume for a city, for the Across Cities activity trends (#4329).
 *
 * @param weekStart    Monday (Pacific) of the week.
 * @param labels       Non-tutorial, non-excluded labels created that week.
 * @param validations  Validations by non-excluded users that week.
 * @param activeUsers  Distinct non-excluded users who labeled or validated that week. Summed across cities for the
 *                     "active users over time" overview line, this slightly over-counts users active in multiple cities.
 * @param newUsers     Users whose first-ever label or validation fell in that week — the increment for the cumulative
 *                     users chart (#4686). Only populated on full-history queries: a trailing window can't know a
 *                     user's true first week, so bounded queries return 0 here.
 */
case class WeeklyPoint(weekStart: LocalDate, labels: Int, validations: Int, activeUsers: Int, newUsers: Int)

/**
 * How one account's contribution is attributed on the Across Cities page (#4931).
 *
 * The distinction is what lets the page report community activity honestly. `Ai` output can dwarf everything people
 * did — one pipeline account was 80% of prod's weekly validations — and an `Anonymous` account is a per-cookie
 * identity, so a repeat visitor without an account shows up as several of them and cannot be counted as a person.
 *
 * String values match the labels [[models.utils.ConfigTable]]'s `account_kinds` CTE emits, which is how a row is
 * parsed back into this type.
 */
object ContributorKind extends Enumeration {
  val Registered: ContributorKind.Value = Value("registered")
  val Anonymous: ContributorKind.Value  = Value("anonymous")
  val Ai: ContributorKind.Value         = Value("ai")
}

/**
 * One person's contribution to one city on one day, the grain the "this week" bar charts are built from (#4931).
 *
 * @param day         Calendar day (Pacific).
 * @param userId      The contributor's user id, which identifies them across cities when their days are merged.
 * @param username    Their display name, empty when `sidewalk_login` has no row for the id.
 * @param kind        How this account's activity is attributed — a person, a cookie identity, or the pipeline.
 * @param labels      Non-tutorial, non-excluded labels they created that day.
 * @param validations Validations they submitted that day.
 */
case class DailyContributorActivity(
    day: LocalDate,
    userId: String,
    username: String,
    kind: ContributorKind.Value,
    labels: Int,
    validations: Int
)

/**
 * One person's contribution to one city across both rolling weekly windows (#4931).
 *
 * @param userId              The contributor's user id.
 * @param username            Their display name, empty when `sidewalk_login` has no row for the id.
 * @param kind                How this account's activity is attributed.
 * @param labels7d            Labels they created in the trailing 7 days.
 * @param labelsPrior7d       Labels they created 7–14 days ago.
 * @param validations7d       Validations they submitted in the trailing 7 days.
 * @param validationsPrior7d  Validations they submitted 7–14 days ago.
 */
case class ContributorWindowActivity(
    userId: String,
    username: String,
    kind: ContributorKind.Value,
    labels7d: Int,
    labelsPrior7d: Int,
    validations7d: Int,
    validationsPrior7d: Int
)

/**
 * One day's contribution volume across cities, for the Across Cities "this week" bar charts (#4686, #4931).
 *
 * Counted on the same two bases as [[ActivityWindowSummary]] — volumes are human work with pipeline work beside it,
 * headcounts are distinct and split registered / anonymous / AI. One AI account can out-produce every person in the
 * project on a given day, so a blended total would describe the pipeline's schedule, not the community's day.
 *
 * @param day           Calendar day (Pacific).
 * @param labels        Non-tutorial, non-excluded labels people created that day (registered and anonymous).
 * @param validations   Validations people submitted that day.
 * @param contributors  Distinct registered people who labeled or validated that day, across all cities.
 * @param anonSessions  Distinct anonymous (per-cookie) identities active that day, across all cities.
 * @param aiLabels      Labels created that day by accounts holding the `AI` role.
 * @param aiValidations Validations submitted that day by accounts holding the `AI` role.
 * @param aiAgents      Distinct AI accounts active that day, across all cities.
 */
case class DailyPoint(
    day: LocalDate,
    labels: Int,
    validations: Int,
    contributors: Int,
    anonSessions: Int,
    aiLabels: Int,
    aiValidations: Int,
    aiAgents: Int
)

/**
 * One day's cross-city activity: the volumes behind that day's bars, plus the breakdown its hover card shows (#4931).
 *
 * @param point            The day's totals.
 * @param topCities        The day's busiest cities, most human activity first.
 * @param contributors     The day's busiest *nameable* contributors — registered accounts and AI, merged across cities
 *                         so a person active in two shows up once, capped at [[ConfigService.DayContributorLimit]].
 *                         Anonymous contributors are counted in `point.anonSessions` but never listed, because their
 *                         usernames are generated cookie ids rather than names.
 * @param contributorTotal How many contributors the capped list was drawn from, on the same nameable basis, so a card
 *                         can say exactly how many it is not showing.
 */
case class DailyActivity(
    point: DailyPoint,
    topCities: Seq[CityDayTotals],
    contributors: Seq[DailyContributor],
    contributorTotal: Int
)

/**
 * One city's share of a single day, for the "top cities" line of a day's hover card (#4931).
 *
 * @param cityId       The city id (e.g. "seattle-wa").
 * @param labels       Labels people created there that day.
 * @param validations  Validations people submitted there that day.
 * @param contributors Distinct people active there that day.
 */
case class CityDayTotals(cityId: String, labels: Int, validations: Int, contributors: Int)

/**
 * One contributor's day, merged across every city they were active in (#4931).
 *
 * @param username    Their display name, empty when `sidewalk_login` has no row for the id.
 * @param kind        How this account's activity is attributed.
 * @param labels      Labels they created that day.
 * @param validations Validations they submitted that day.
 */
case class DailyContributor(username: String, kind: ContributorKind.Value, labels: Int, validations: Int)

/**
 * Cross-city rolling week-over-week activity — the trailing 7 days vs the 7 before — for the "Today & this week"
 * tiles on the Across Cities page (#4758).
 *
 * Windows are exact rolling 168-hour spans (the same basis as [[CityScorecard]]'s labels7d/validations7d), not
 * Pacific calendar days, so the tiles agree with the per-city 7d columns. Same activity definition, exclusions, and
 * attribution split as [[DailyPoint]].
 *
 * The two families of number here are counted differently, and the difference is the whole point. **Volumes** are
 * human work with pipeline work reported beside it: `labels7d`/`validations7d` cover registered *and* anonymous
 * contributors, because an anonymous visitor's label is still a person's label, while `ai*` is the pipeline's.
 * **Headcounts** split three ways, because only a registered account reliably denotes one person: an anonymous account
 * is a per-cookie identity that a repeat visitor mints again, so it is reported as a session, not a contributor.
 *
 * Every headcount is *distinct* at whatever scope the instance describes — see [[ActivityWindowSummary.fromContributors]]
 * for the one-row-per-person precondition that guarantees it.
 *
 * @param labels7d              Labels people created in the trailing 7 days (registered and anonymous).
 * @param labelsPrior7d         Labels people created 7–14 days ago.
 * @param validations7d         Validations people submitted in the trailing 7 days.
 * @param validationsPrior7d    Validations people submitted 7–14 days ago.
 * @param aiLabels7d            Labels created in the trailing 7 days by `AI`-role accounts.
 * @param aiLabelsPrior7d       Labels created 7–14 days ago by `AI`-role accounts.
 * @param aiValidations7d       Validations submitted in the trailing 7 days by `AI`-role accounts.
 * @param aiValidationsPrior7d  Validations submitted 7–14 days ago by `AI`-role accounts.
 * @param contributors7d        Distinct registered people who labeled or validated in the trailing 7 days.
 * @param contributorsPrior7d   Same, for 7–14 days ago.
 * @param anonSessions7d        Distinct anonymous (per-cookie) identities active in the trailing 7 days.
 * @param anonSessionsPrior7d   Same, for 7–14 days ago.
 * @param aiAgents7d            Distinct `AI`-role accounts active in the trailing 7 days.
 */
case class ActivityWindowSummary(
    labels7d: Int,
    labelsPrior7d: Int,
    validations7d: Int,
    validationsPrior7d: Int,
    aiLabels7d: Int,
    aiLabelsPrior7d: Int,
    aiValidations7d: Int,
    aiValidationsPrior7d: Int,
    contributors7d: Int,
    contributorsPrior7d: Int,
    anonSessions7d: Int,
    anonSessionsPrior7d: Int,
    aiAgents7d: Int
)

object ActivityWindowSummary {

  /** A window with nothing in it — the fallback for a city whose schema read failed. */
  val empty: ActivityWindowSummary = ActivityWindowSummary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

  /**
   * Rolls per-person rows up into window totals.
   *
   * Every count the page shows comes from this one derivation, so a headline number and the contributor list behind it
   * can't drift apart.
   *
   * **Precondition: `rows` holds at most one row per person.** Headcounts here are `count`s of matching rows, so they
   * are distinct people exactly as far as that holds. It holds per city because the DAO groups by user; to summarize
   * across cities, merge a person's rows first (see [[ConfigService.mergeByContributor]]) rather than summing
   * per-city summaries — summing would count someone active in three cities as three contributors. There is
   * deliberately no `add` on this type: field-wise addition is correct for the volumes and wrong for every headcount,
   * and a single combinator can't be both.
   *
   * @param rows Contributors, at most one row each.
   * @return     Their window totals.
   */
  def fromContributors(rows: Seq[ContributorWindowActivity]): ActivityWindowSummary = {
    val byKind = rows.groupBy(_.kind).withDefaultValue(Seq.empty)
    val ai     = byKind(ContributorKind.Ai)
    val anon   = byKind(ContributorKind.Anonymous)
    val people = byKind(ContributorKind.Registered) ++ anon
    ActivityWindowSummary(
      labels7d = people.map(_.labels7d).sum,
      labelsPrior7d = people.map(_.labelsPrior7d).sum,
      validations7d = people.map(_.validations7d).sum,
      validationsPrior7d = people.map(_.validationsPrior7d).sum,
      aiLabels7d = ai.map(_.labels7d).sum,
      aiLabelsPrior7d = ai.map(_.labelsPrior7d).sum,
      aiValidations7d = ai.map(_.validations7d).sum,
      aiValidationsPrior7d = ai.map(_.validationsPrior7d).sum,
      contributors7d = byKind(ContributorKind.Registered).count(c => c.labels7d + c.validations7d > 0),
      contributorsPrior7d = byKind(ContributorKind.Registered).count(c => c.labelsPrior7d + c.validationsPrior7d > 0),
      anonSessions7d = anon.count(c => c.labels7d + c.validations7d > 0),
      anonSessionsPrior7d = anon.count(c => c.labelsPrior7d + c.validationsPrior7d > 0),
      aiAgents7d = ai.count(c => c.labels7d + c.validations7d > 0)
    )
  }
}

/**
 * One city's rolling weekly windows, with the people whose work they are made of (#4758, #4931).
 *
 * @param summary          The city's window totals.
 * @param contributors     Its nameable contributors — registered accounts and AI — busiest first and capped at
 *                         [[ConfigService.WindowContributorLimit]], for the "Most active cities" hover cards.
 *                         Anonymous contributors are counted in the summary but never listed (generated cookie ids).
 * @param contributorTotal How many contributors the capped list was drawn from, on the same nameable basis, so a card
 *                         can say exactly how many it is not showing.
 */
case class CityActivityWindow(
    summary: ActivityWindowSummary,
    contributors: Seq[ContributorWindowActivity],
    contributorTotal: Int
)

/**
 * Rolling week-over-week activity for every available city plus the cross-city total (#4758).
 *
 * The per-city rows and the total come from one pass: each city is queried once, and `total` is derived from those same
 * rows. So the "Most active cities" table costs nothing beyond the "Today & this week" tiles that need the total anyway.
 *
 * `total` is **not** the per-city summaries added up. Volumes would survive that, but headcounts would not: someone who
 * mapped in three cities is three per-city contributors and one person. So the total re-derives from every city's rows
 * merged by person, which is why it can be smaller than the same column summed down the table — worth a note wherever
 * the two appear together.
 *
 * @param byCity Per-city windows, keyed by city id. Cities whose query failed carry zeros rather than being dropped.
 * @param total  Cross-city totals: volumes summed, headcounts distinct across all cities.
 */
case class CrossCityActivityWindows(byCity: Map[String, CityActivityWindow], total: ActivityWindowSummary)

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
   * Age beyond which a cross-city read is refreshed in the background when served (#4931).
   *
   * One `/admin/across-cities` request triggers five of these reads, and each fans a query out to every city schema —
   * ~280 queries against a 25-connection pool at ~56 deployments. What `staleWhileRevalidate` buys over a plain
   * expiring cache is that **no request ever waits on that fan-out**: past this age the cached copy is still served
   * immediately and the refresh runs behind it, whereas an expiring entry makes whichever request arrives first pay
   * for the whole thing while holding pool connections that Explore and Validate share. (Coalescing concurrent
   * callers is not the difference — Caffeine's `get(key, mappingFunction)` under `getOrElseUpdate` is already atomic
   * per key. `refreshCachedValue` keeps that property for background refreshes.)
   */
  val CrossCityFreshFor: FiniteDuration = Duration(10, "minutes")

  /**
   * How long a cross-city read may be served at all; past this a request blocks on recomputing it.
   *
   * Far above [[CrossCityFreshFor]] because staleness is much cheaper here than a blocking fan-out: these numbers are
   * for an overview page, and a background refresh runs every time one is served past the fresh window anyway. So this
   * bound only decides how old the page may get while refreshes keep failing — not how fresh it normally is.
   */
  val CrossCityMaxAge: FiniteDuration = Duration(2, "hours")

  /**
   * How long the cross-city labeling-speed read may be served, and when it refreshes.
   *
   * Its own pair because it scans the interaction tables — by far the heaviest of the fan-outs, and the least volatile:
   * labeling speed barely moves day to day.
   */
  val LabelingSpeedFreshFor: FiniteDuration = Duration(24, "hours")

  /** How long a labeling-speed read may be served at all; see [[LabelingSpeedFreshFor]]. */
  val LabelingSpeedMaxAge: FiniteDuration = Duration(7, "days")

  /**
   * How many contributors each city ships for its "Most active cities" hover cards (#4931).
   *
   * Sized to what the cards can draw, not to the population. The untruncated count travels separately as
   * `CityActivityWindow.contributorTotal`, so this list only has to cover what is rendered: ~5 rows per card, plus
   * headroom because the cards rank by labels in one column and validations in another and so draw different people
   * from the same list. This ships per city for every deployment, so each unit of it is paid ~56 times.
   */
  val WindowContributorLimit: Int = 10

  /** How many cities a day's hover card lists. The card draws every one it is sent, so this is the only cap. */
  val DayTopCityLimit: Int = 3

  /** How many contributors a day's hover card lists, with the untruncated count sent alongside as a total. */
  val DayContributorLimit: Int = 8

  /**
   * Merges a person's rows from several cities into one row per person, summing their volumes.
   *
   * The precondition [[ActivityWindowSummary.fromContributors]] needs in order to count distinct people: without this,
   * summarizing across cities counts someone who mapped in three cities three times. Sorted busiest-first with the user
   * id breaking ties, so a caller that truncates keeps a reproducible list across cache refreshes rather than one that
   * depends on `HashMap` iteration order.
   *
   * @param rows Per-city, per-person rows from any number of cities.
   * @return     One row per person, volumes summed, busiest first.
   */
  def mergeByContributor(rows: Seq[ContributorWindowActivity]): Seq[ContributorWindowActivity] = rows
    .groupBy(_.userId)
    .values
    .map(userRows =>
      userRows.head.copy(
        labels7d = userRows.map(_.labels7d).sum,
        labelsPrior7d = userRows.map(_.labelsPrior7d).sum,
        validations7d = userRows.map(_.validations7d).sum,
        validationsPrior7d = userRows.map(_.validationsPrior7d).sum
      )
    )
    .toSeq
    .sortBy(c => (-(c.labels7d + c.validations7d), c.userId))

  /**
   * Rolls one day's per-city, per-person rows up into the day's bars and the breakdown behind them (#4931).
   *
   * Every figure the day's hover card shows is derived here, from the same rows the bars are summed from, so the card
   * can't contradict the bar it explains. That includes the headcounts: they are derived from the *merged* rows, the
   * same ones the card names, so the day's contributor count and the list under it can never disagree about how many
   * people there were.
   *
   * @param day  The Pacific calendar day being summarized.
   * @param rows That day's (cityId, contributor-activity) rows; empty for a day nobody was active.
   * @return     The day's totals, its busiest cities, and its busiest contributors.
   */
  def summarizeDay(day: LocalDate, rows: Seq[(String, DailyContributorActivity)]): DailyActivity = {
    val byKind     = rows.groupBy(_._2.kind).withDefaultValue(Seq.empty)
    val aiRows     = byKind(ContributorKind.Ai)
    val peopleRows = byKind(ContributorKind.Registered) ++ byKind(ContributorKind.Anonymous)
    // Ranked and truncated below, so ties break on a stable key rather than on HashMap iteration order.
    val merged = rows
      .groupBy(_._2.userId)
      .toSeq
      .map { case (userId, userRows) =>
        val first = userRows.head._2
        (
          userId,
          DailyContributor(
            first.username,
            first.kind,
            userRows.map(_._2.labels).sum,
            userRows.map(_._2.validations).sum
          )
        )
      }
      .sortBy { case (userId, c) => (-(c.labels + c.validations), userId) }
      .map(_._2)
    def activeOfKind(kind: ContributorKind.Value): Int =
      merged.count(c => c.kind == kind && c.labels + c.validations > 0)
    // Anonymous contributors are counted (as sessions, on the point) but not listed: their usernames are generated
    // cookie ids, so naming them fills the card with hex and implies a person behind each one.
    val named = merged.filter(_.kind != ContributorKind.Anonymous)
    val point = DailyPoint(
      day = day,
      labels = peopleRows.map(_._2.labels).sum,
      validations = peopleRows.map(_._2.validations).sum,
      contributors = activeOfKind(ContributorKind.Registered),
      anonSessions = activeOfKind(ContributorKind.Anonymous),
      aiLabels = aiRows.map(_._2.labels).sum,
      aiValidations = aiRows.map(_._2.validations).sum,
      aiAgents = activeOfKind(ContributorKind.Ai)
    )
    // Cities are ranked and listed by what people did there; AI output belongs to the pipeline, not to a community.
    val topCities = peopleRows
      .groupBy(_._1)
      .toSeq
      .map { case (cityId, cityRows) =>
        CityDayTotals(
          cityId,
          cityRows.map(_._2.labels).sum,
          cityRows.map(_._2.validations).sum,
          cityRows.map(_._2.userId).distinct.size
        )
      }
      .sortBy(city => (-(city.labels + city.validations), city.cityId))
      .take(DayTopCityLimit)
    DailyActivity(point, topCities, named.take(DayContributorLimit), named.size)
  }

  /**
   * The (table, column) pairs the global leaderboard's cross-schema query reads (#3719).
   *
   * A schema must have all of them to join the union, and the readiness probe derives its `information_schema` filter
   * from this same list — so adding a column to the query and forgetting the probe is not expressible.
   */
  val LeaderboardRequiredColumns: Set[(String, String)] = Set(
    "label"     -> "user_id",
    "label"     -> "deleted",
    "label"     -> "tutorial",
    "label"     -> "correct",
    "user_stat" -> "user_id",
    "user_stat" -> "excluded",
    "user_stat" -> "on_leaderboard",
    "user_stat" -> "meters_audited",
    "mission"   -> "user_id"
  )

  /**
   * The (table, column) pairs the cross-city volunteer-hours query reads (#4526).
   *
   * A schema missing any of them can't be totalled, and quietly counting it as zero hours would understate a
   * volunteer's service time — so it is excluded and logged instead.
   */
  val CrossCityHoursRequiredColumns: Set[(String, String)] = Set(
    "label_validation"             -> "user_id",
    "label_validation"             -> "end_timestamp",
    "audit_task"                   -> "user_id",
    "audit_task"                   -> "audit_task_id",
    "audit_task_interaction_small" -> "audit_task_id",
    "audit_task_interaction_small" -> "timestamp",
    "webpage_activity"             -> "user_id",
    "webpage_activity"             -> "activity",
    "webpage_activity"             -> "timestamp"
  )

  /**
   * The (table, column) pairs a user's cross-city stats query reads (#4496).
   *
   * Deliberately smaller than [[LeaderboardRequiredColumns]]: a mapper's own totals need no visibility flags, so a
   * schema that is behind on the evolutions adding `on_leaderboard`/`public_profile` still reports its numbers.
   */
  val CrossCityUserRequiredColumns: Set[(String, String)] = Set(
    "label"            -> "user_id",
    "label"            -> "deleted",
    "label"            -> "tutorial",
    "label"            -> "street_edge_id",
    "label"            -> "audit_task_id",
    "label"            -> "time_created",
    "audit_task"       -> "audit_task_id",
    "audit_task"       -> "street_edge_id",
    "config"           -> "tutorial_street_edge_id",
    "label_validation" -> "user_id",
    "mission"          -> "user_id",
    "mission"          -> "completed",
    "mission"          -> "skipped",
    "user_stat"        -> "user_id",
    "user_stat"        -> "meters_audited"
  )

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
   * @return A Future of one [[CityScorecardWithFlags]] per available city ("staging" excluded).
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
   * Returns the daily label/validation/active-user volume summed across all available cities for the trailing window
   * (#4686), plus the busiest cities and named contributors behind each day (#4931), for the "this week" bar charts
   * and their hover cards. Same definitions and exclusions as [[getCrossCityWeeklyTrend]]; active users are summed per
   * city, so a person active in multiple cities is counted in each (documented on the page), while the contributor
   * list merges their cities so each person appears once.
   *
   * @param days Trailing calendar days (Pacific) to include; the last day is today, so its counts are partial.
   * @return     Exactly `days` days, zero-filled and ascending by day.
   */
  def getCrossCityDailyTrend(days: Int): Future[Seq[DailyActivity]]

  /**
   * Returns rolling week-over-week activity across all available cities (#4758): the trailing 7 days vs the 7 before,
   * for the "Today & this week" tiles and the "Most active cities" table, each city carrying the contributors its
   * counts are made of (#4931). Same activity definition and exclusions as [[getCrossCityDailyTrend]]; contributors
   * are distinct per city per window and summed across cities.
   *
   * @return Per-city windows plus their cross-city total.
   */
  def getCrossCityActivitySummary(): Future[CrossCityActivityWindows]

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
   * Returns the current city's labeling pace as minutes of active auditing per 100 m covered.
   *
   * Same expensive interaction-table scan as [[getCrossCityLabelingSpeed]] but for this deployment's schema only,
   * on its own daily cache. RouteBuilder bases its route exploration-time estimate on this.
   *
   * @return A Future of minutes per 100 m, or None when the city has no interaction data yet.
   */
  def getCityLabelingSpeed(): Future[Option[Double]]

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
   * Which cities the by-name global leaderboard may read, split by what it may read them for (#3719).
   *
   * @return The scope, or a failed future if schema readiness can't be determined (the caller decides how to degrade).
   */
  def getGlobalLeaderboardScope: Future[GlobalLeaderboardScope]

  /**
   * Which cities a mapper's own cross-city stats may be gathered from (#4496).
   *
   * Every deployment that exists here and is far enough along on evolutions, with none of the leaderboard's privacy
   * exclusions: those hold a city back from *naming people to strangers*, whereas this is a mapper reading their own
   * totals, so work they did in a private or unlaunched city is still theirs to see. Privacy re-enters at the link —
   * only publicly launched cities get a click-through.
   *
   * @return (cityId, schema) pairs in configured order, or a failed future if readiness can't be determined.
   */
  def getCrossCityUserScope: Future[Seq[(String, String)]]

  /**
   * Which cities a volunteer's hours may be totalled from (#4526).
   *
   * Same self-view reasoning as [[getCrossCityUserScope]], but gated on the interaction tables that query reads
   * rather than the contribution tables. Carries the excluded schemas too, which its caller shows the volunteer:
   * a hours total that silently dropped a city is the very bug #4526 exists to fix.
   *
   * @return The scope, or a failed future if readiness can't be determined.
   */
  def getCrossCityHoursScope: Future[SelfViewScope]

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
   * The cross-city totals plus this deployment's own slice of them, for the Leaderboard's two bands (#4687).
   *
   * Both come out of one cache read of the same fan-out, so the city numbers are a slice of exactly the computation
   * the totals summarize — not of a neighbouring one a background refresh landed in between. Costs no queries beyond
   * what [[getAggregateStats]] already runs, and carries the same staleness.
   *
   * @return The cross-city aggregate, and this city's totals — None if its schema is unavailable or either of its
   *         queries failed, in which case the caller should hide the band rather than render zeros.
   */
  def getAggregateStatsWithCurrentCity(): Future[(AggregateStats, Option[CityImpact])]

  /**
   * Returns daily label and validation counts aggregated across all configured cities.
   *
   * Queries each city schema in parallel and sums counts by (date, labelType) across cities.
   * Cities whose schemas do not exist in the current environment are silently skipped (same
   * guard as getAggregateStats). The full-range result is cached like
   * getAggregateStats (stale data served immediately, background refresh — #4600), and the
   * requested date window is sliced from the cached per-day rows.
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
  def getAiLabelSubmissionEnabled: Boolean
  def getPrivateProfilesByDefault: Boolean
  def defaultPrivacyFlags: (Boolean, Boolean)
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
    panoDataService: PanoDataService,
    swrCache: SwrCache,
    assetManifestService: AssetManifestService
)(implicit val ec: ExecutionContext)
    extends ConfigService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

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

  def getGlobalLeaderboardScope: Future[GlobalLeaderboardScope] = {
    // Cached because the answer only changes when config or the schema list does, and it gates a per-page-load query.
    // The recover is deliberately outside, so a transient failure isn't memoized as "no cities" for the next hour.
    cacheApi.getOrElseUpdate[GlobalLeaderboardScope]("getGlobalLeaderboardScope", Duration(1, "hours")) {
      val deployments: Seq[(String, String)] = config
        .get[Seq[String]]("city-params.city-ids")
        .filter(_ != "staging") // Not a real deployment.
        .flatMap { cityId =>
          try { Some(cityId -> getCitySchema(cityId)) }
          catch { case _: Exception => None } // A city id with no db-schema entry simply can't be queried.
        }

      // One metadata query rather than a per-city existence probe: schemas can sit at different evolution levels, and a
      // single missing column would otherwise fail the whole union at query time.
      schemasWithColumns(ConfigService.LeaderboardRequiredColumns).map { ready =>
        val (readyDeployments, skipped) = deployments.partition { case (_, schema) => ready.getOrElse(schema, false) }
        // A schema with *some* of the columns exists but is behind on evolutions — real, actionable drift, unlike a
        // schema that is simply absent (every dev box and single-city deployment has ~50 of those).
        val behind = skipped.map(_._2).filter(ready.contains)
        if (behind.nonEmpty) {
          logger.warn(
            s"Global leaderboard excluding ${behind.size} city schema(s) missing columns it reads " +
              s"(evolutions likely not yet applied there): ${behind.mkString(", ")}"
          )
        }

        val cities       = readyDeployments.filterNot { case (cityId, _) => isExcludedFromGlobalLeaderboard(cityId) }
        val contributing = cities.map(_._2).toSet
        // Everything ready but not contributing, minus the private-by-default cities where a FALSE flag is just the
        // signup default rather than a choice. Rereading those as opt-outs would silently unlist most of their mappers.
        val optOutSchemas = readyDeployments.collect {
          case (cityId, schema) if !contributing.contains(schema) && !cityFlag("private-profiles-by-default", cityId) =>
            schema
        }
        GlobalLeaderboardScope(cities, optOutSchemas)
      }
    }
  }

  def getCrossCityUserScope: Future[Seq[(String, String)]] =
    crossCitySelfViewScope("getCrossCityUserScope", ConfigService.CrossCityUserRequiredColumns, "user stats")
      .map(_.cities)

  def getCrossCityHoursScope: Future[SelfViewScope] =
    crossCitySelfViewScope("getCrossCityHoursScope", ConfigService.CrossCityHoursRequiredColumns, "volunteer hours")

  /**
   * Which cities one mapper's data may be gathered from, for a query needing `required`.
   *
   * Shared by these fan-outs: they differ only in the columns they read, never in which deployments they are entitled
   * to see — that is what separates them from [[getGlobalLeaderboardScope]], which withholds unlaunched and
   * private-by-default cities so a public by-name board can't advertise them.
   *
   * Those exclusions stay off here even on the admin surfaces that read *another* user's breakdown
   * (`adminGetCrossCityStats`, `adminGetCrossCityHours`): both are gated on `WithAdmin`, and an admin who can already
   * read the account is not who the leaderboard rules withhold it from. Any surface past that gate needs a fresh look.
   *
   * @param cacheKey Cache key for this scope; distinct per column set, since the answers differ.
   * @param required The (table, column) pairs the caller's query reads.
   * @param label    Human-readable name of the caller, for the drift warning.
   * @return         The readable cities in configured order, and the schemas held back.
   */
  private def crossCitySelfViewScope(
      cacheKey: String,
      required: Set[(String, String)],
      label: String
  ): Future[SelfViewScope] = {
    // Cached for the same reason as the leaderboard scope: it only changes when config or the schema list does, and it
    // gates a per-request query. The recover stays outside so a transient failure isn't memoized as "no cities".
    cacheApi.getOrElseUpdate[SelfViewScope](cacheKey, Duration(1, "hours")) {
      availableCityIds().flatMap { cityIds =>
        val deployments: Seq[(String, String)] = cityIds.flatMap { cityId =>
          try { Some(cityId -> getCitySchema(cityId)) }
          catch { case _: Exception => None } // A city id with no db-schema entry simply can't be queried.
        }
        schemasWithColumns(required).map { ready =>
          val (readyDeployments, skipped) = deployments.partition { case (_, schema) =>
            ready.getOrElse(schema, false)
          }
          // A schema with *some* of the columns is behind on evolutions — real drift, unlike a schema that is simply
          // absent. availableCityIds already dropped those, so anything here is worth a warning.
          if (skipped.nonEmpty) {
            logger.warn(
              s"Cross-city $label excluding ${skipped.size} city schema(s) missing columns they read " +
                s"(evolutions likely not yet applied there): ${skipped.map(_._2).mkString(", ")}"
            )
          }
          SelfViewScope(readyDeployments, skipped.map(_._2))
        }
      }
    }
  }

  /**
   * Whether a city's contributions are held out of the by-name global leaderboard.
   *
   * Three independent reasons, any of which excludes: the deployment isn't publicly launched (naming it in the "Top
   * city" column would advertise a URL we don't publish), an explicit `global-leaderboard-excluded` entry, or a
   * deployment that defaults profiles to private — a school/minor city starts users opted out, so naming its
   * contributors globally would leak exactly what that default protects (#4480).
   *
   * @param cityId The city to test.
   * @return True if the city's contributions must not appear on the global leaderboard.
   */
  private def isExcludedFromGlobalLeaderboard(cityId: String): Boolean = {
    val isPublic = config.getOptional[String](s"city-params.status.$cityId").contains("public")
    !isPublic || cityFlag("global-leaderboard-excluded", cityId) || cityFlag("private-profiles-by-default", cityId)
  }

  /**
   * Reads one of the per-city boolean blocks in `city-params`.
   *
   * @param block  The `city-params` sub-block holding the flag, e.g. "private-profiles-by-default".
   * @param cityId The city whose entry to read.
   * @return       The flag's value, or false when the city (or the whole block) is unlisted — hasPath is false for a
   *               missing key *or* a missing parent, so an unlisted city always reads as the permissive default.
   */
  private def cityFlag(block: String, cityId: String): Boolean = {
    val path = s"city-params.$block.$cityId"
    config.underlying.hasPath(path) && config.get[Boolean](path)
  }

  /**
   * Which schemas have every column in `required`, keyed by schema.
   *
   * Covers every schema rather than filtering to a candidate list in SQL, so the query needs no list binding; the
   * caller intersects. Note `information_schema` only exposes objects the connected role can see, so a schema the app
   * cannot read reports as absent — which is the behavior we want.
   *
   * The required set is matched in Scala, and the probe derives its own `table_name` filter from that same set, so a
   * cross-schema query and the readiness bar guarding it cannot drift apart.
   *
   * @param required The (table, column) pairs a caller's cross-schema query reads.
   * @return         Schema name to whether it has all the required columns; a schema with only some appears as false,
   *                 which is what distinguishes "behind on evolutions" from "absent".
   */
  private def schemasWithColumns(required: Set[(String, String)]): Future[Map[String, Boolean]] = {
    // Table names come from a hardcoded required-column set, never from a request, so splicing them is safe.
    val tables: Set[String] = required.map(_._1)
    db.run(
      sql"""
        SELECT table_schema, table_name, column_name
        FROM information_schema.columns
        WHERE table_name IN (#${tables.map(table => s"'$table'").mkString(", ")})
      """.as[(String, String, String)]
    ).map { rows =>
      rows
        .groupBy(_._1)
        .view
        .mapValues { schemaRows =>
          val present = schemaRows.map { case (_, table, column) => (table, column) }.toSet
          required.subsetOf(present)
        }
        .toMap
    }
  }

  /**
   * Resolves which configured cities actually exist in this database, for the cross-city fan-out queries.
   *
   * A city whose schema-existence check fails or throws is treated as unavailable rather than failing the whole
   * fan-out — this is what lets a localhost DB holding a handful of schemas serve pages that fan out over the full
   * configured city list.
   *
   * @param excludeStaging Whether to drop the "staging" pseudo-city (not a real deployment, as in
   *                       CitiesApiController); every caller except the public aggregate stats does.
   * @return               City ids from city-params.city-ids whose schema exists, in configured order.
   */
  private def availableCityIds(excludeStaging: Boolean = true): Future[Seq[String]] = {
    val allCityIds        = config.get[Seq[String]]("city-params.city-ids")
    val configuredCityIds = if (excludeStaging) allCityIds.filter(_ != "staging") else allCityIds

    val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
      try {
        checkSchemaExists(getCitySchema(cityId)).map(cityId -> _).recover { case _ => cityId -> false }
      } catch {
        case _: Exception => Future.successful(cityId -> false)
      }
    }
    Future.sequence(schemaExistenceChecks).map(_.filter(_._2).map(_._1))
  }

  def getCityScorecards(): Future[Seq[CityScorecardWithFlags]] = {
    swrCache.staleWhileRevalidate[Seq[CityScorecardWithFlags]](
      "getCityScorecards",
      ConfigService.CrossCityFreshFor,
      ConfigService.CrossCityMaxAge
    ) {
      availableCityIds().flatMap { availableCities =>
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
    swrCache.staleWhileRevalidate[Seq[WeeklyPoint]](
      cacheKey,
      ConfigService.CrossCityFreshFor,
      ConfigService.CrossCityMaxAge
    ) {
      availableCityIds().flatMap { availableCities =>
        val perCityFutures = availableCities.map { cityId =>
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
              WeeklyPoint(
                week,
                pts.map(_.labels).sum,
                pts.map(_.validations).sum,
                pts.map(_.activeUsers).sum,
                pts.map(_.newUsers).sum
              )
            }
        }
      }
    }
  }

  def getCrossCityDailyTrend(days: Int): Future[Seq[DailyActivity]] = {
    swrCache.staleWhileRevalidate[Seq[DailyActivity]](
      s"getCrossCityDailyTrend_$days",
      ConfigService.CrossCityFreshFor,
      ConfigService.CrossCityMaxAge
    ) {
      availableCityIds().flatMap { availableCities =>
        val perCityFutures = availableCities.map { cityId =>
          db.run(configTable.getCityDailyActivityByUserBySchema(getCitySchema(cityId), days))
            .recover { case e: Exception =>
              logger.warn(s"Failed to fetch daily trend for city $cityId: ${e.getMessage}")
              Seq.empty[DailyContributorActivity]
            }
            .map(cityId -> _)
        }
        Future.sequence(perCityFutures).map { perCity =>
          val rowsByDay: Map[LocalDate, Seq[(String, DailyContributorActivity)]] = perCity
            .flatMap { case (cityId, rows) => rows.map(cityId -> _) }
            .groupBy(_._2.day)
          // Zero-fill the exact trailing window so the page always gets `days` bars. Iterating the window (rather
          // than the query results) also drops any extra day the DAO's index-friendly coarse bound let through.
          val today = LocalDate.now(ZoneId.of("US/Pacific"))
          (0 until days).map { i =>
            val day = today.minusDays((days - 1 - i).toLong)
            ConfigService.summarizeDay(day, rowsByDay.getOrElse(day, Seq.empty))
          }
        }
      }
    }
  }

  def getCrossCityActivitySummary(): Future[CrossCityActivityWindows] = {
    swrCache.staleWhileRevalidate[CrossCityActivityWindows](
      "getCrossCityActivitySummary",
      ConfigService.CrossCityFreshFor,
      ConfigService.CrossCityMaxAge
    ) {
      availableCityIds().flatMap { availableCities =>
        val perCityFutures = availableCities.map { cityId =>
          db.run(configTable.getCityWindowActivityByUserBySchema(getCitySchema(cityId)))
            .recover { case e: Exception =>
              logger.warn(s"Failed to fetch activity windows for city $cityId: ${e.getMessage}")
              Seq.empty[ContributorWindowActivity]
            }
            .map(cityId -> _)
        }
        Future.sequence(perCityFutures).map { perCity =>
          val byCity = perCity.map { case (cityId, rows) =>
            // The DAO returns every contributor because the city's totals are derived from all of them; only the list
            // the page renders is capped, and capping after the derivation keeps a long tail out of a headline count.
            val named = rows.filter(c => c.labels7d + c.validations7d > 0 && c.kind != ContributorKind.Anonymous)
            cityId -> CityActivityWindow(
              ActivityWindowSummary.fromContributors(rows),
              named.take(ConfigService.WindowContributorLimit),
              named.size
            )
          }
          // Merging every city's rows by person before summarizing is what makes the cross-city headcounts distinct
          // people rather than per-city contributor slots added up.
          val total = ActivityWindowSummary.fromContributors(
            ConfigService.mergeByContributor(perCity.flatMap { case (_, rows) => rows })
          )
          CrossCityActivityWindows(byCity.toMap, total)
        }
      }
    }
  }

  /**
   * Labeling pace for one city's schema, in seconds of exploration per 100 m of street audited.
   *
   * Seconds per 100 m is the canonical unit both public accessors convert from, so the formula lives in exactly
   * one place — the two differ only by a factor of 60, which is easy to skew by fixing one copy and not the other.
   *
   * @param schema The city's Postgres schema (e.g. "sidewalk_seattle").
   * @return       None when the schema has no interaction data or no audited distance, which leaves pace
   *               unknowable, and None (logged) if the query fails.
   */
  private def labelingSpeedForSchema(schema: String): Future[Option[Double]] = {
    db.run(configTable.getCityLabelingSpeedBySchema(schema))
      .map { case (hours, km) => if (hours > 0 && km > 0) Some((hours * 3600.0) / (km * 10.0)) else None }
      .recover { case e: Exception =>
        logger.warn(s"Failed to compute labeling speed for schema $schema: ${e.getMessage}")
        None
      }
  }

  def getCrossCityLabelingSpeed(): Future[Map[String, Double]] = {
    swrCache.staleWhileRevalidate[Map[String, Double]](
      "getCrossCityLabelingSpeed",
      ConfigService.LabelingSpeedFreshFor,
      ConfigService.LabelingSpeedMaxAge
    ) {
      availableCityIds().flatMap { availableCities =>
        val perCityFutures: Seq[Future[Option[(String, Double)]]] = availableCities.map { cityId =>
          labelingSpeedForSchema(getCitySchema(cityId)).map(_.map(cityId -> _))
        }
        Future.sequence(perCityFutures).map(_.flatten.toMap)
      }
    }
  }

  def getCityLabelingSpeed(): Future[Option[Double]] = {
    // Daily cache, matching getCrossCityLabelingSpeed: the underlying interaction-table scan is expensive.
    cacheApi.getOrElseUpdate[Option[Double]](s"getCityLabelingSpeed_$getCityId", Duration(24, "hours")) {
      // Minutes per 100 m, the unit the RouteBuilder time estimate reads. Reject a physically implausible pace as
      // unknown (→ caller's default) so a degenerate ratio can't drive the estimate: a dev DB whose interaction log is
      // trimmed but whose audited distance is intact yields a near-zero pace, and both bounds guard against bad data.
      val minPace = 0.5  // min/100 m; a faster pace (> ~12 km/h) is impossible while auditing.
      val maxPace = 60.0 // min/100 m; a slower pace signals broken data, not real auditing.
      labelingSpeedForSchema(getCitySchema(getCityId))
        .map(_.map(_ / 60.0).filter(pace => pace >= minPace && pace <= maxPace))
    }
  }

  def getCityFunnels(window: String): Future[Map[String, Seq[CityFunnel]]] = {
    // Reads the precomputed funnel_stat per schema, so it is cheap; the short cache just coalesces bursts of requests.
    cacheApi.getOrElseUpdate[Map[String, Seq[CityFunnel]]](s"getCityFunnels_$window", Duration(10, "minutes")) {
      availableCityIds().flatMap { availableCities =>
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

  /**
   * One cross-schema fan-out's output: the summed cross-city totals plus each city's own slice, keyed by city id.
   *
   * Cached as a unit so the Leaderboard's city hero and its community band come from the same computation, which is
   * what guarantees every hero number is a strict subset of its cross-city counterpart (#4687).
   */
  private case class AggregateStatsBundle(overall: AggregateStats, byCity: Map[String, CityImpact])

  def getAggregateStats(): Future[AggregateStats] = aggregateStatsBundle().map(_.overall)

  def getAggregateStatsWithCurrentCity(): Future[(AggregateStats, Option[CityImpact])] =
    aggregateStatsBundle().map(bundle => (bundle.overall, bundle.byCity.get(getCityId)))

  /**
   * The cached cross-schema fan-out that backs [[getAggregateStats]] and [[getAggregateStatsWithCurrentCity]].
   *
   * The computation fans out several aggregate queries to every configured city schema, which can take well over 10s
   * on a loaded database — long enough that a request hitting an expired cache would time out client-side (#4600). So
   * cached stats are served immediately for up to [[ConfigService.AggregateStatsMaxAge]], with a single background
   * recompute triggered once they are older than [[ConfigService.AggregateStatsFreshFor]]. Only the first request
   * after a JVM start (nothing cached yet) waits for the full computation.
   *
   * The cache key names the value's shape because [[SwrCache.staleWhileRevalidate]] reads the cached value as
   * `Timestamped[T]` and `T` erases, so nothing would catch a differently-shaped value stored under the same key by
   * other code.
   *
   * @return A Future containing the cross-city totals plus each city's own slice of them
   */
  private def aggregateStatsBundle(): Future[AggregateStatsBundle] =
    swrCache.staleWhileRevalidate(
      "getAggregateStats:v2-bundle",
      ConfigService.AggregateStatsFreshFor,
      ConfigService.AggregateStatsMaxAge
    )(computeAggregateStats())

  /**
   * Runs the full cross-schema fan-out that computes aggregate statistics.
   *
   * Uses direct database queries with cross-schema access to gather only the essential statistics from all configured
   * cities. Filters out cities whose schemas don't exist in the current environment (so plays nice with localhost dev
   * setups). Additionally, calculates deployment counts for cities, countries, and supported languages.
   *
   * @return A Future containing freshly computed aggregate statistics across all cities, plus the per-city slices
   */
  private def computeAggregateStats(): Future[AggregateStatsBundle] = {
    // The public aggregate counts every schema that exists, staging included.
    availableCityIds(excludeStaging = false).flatMap { availableCities =>
      if (availableCities.isEmpty) {
        logger.warn("No cities with valid schemas found")
        Future.successful(AggregateStatsBundle(emptyAggregateStats(0, 0, 0), Map.empty))
      } else {
        // Calculate deployment statistics.
        val numCities    = availableCities.length
        val numCountries = calculateNumCountries(availableCities)
        val numLanguages = calculateNumLanguages()

        // Fetch essential statistics from available cities in parallel, tagged by city so the per-city slices the
        // hero band needs survive the roll-up instead of being summed away (#4687).
        val cityStatsFutures: Seq[Future[(String, Option[AggregateStats])]] = availableCities.map { cityId =>
          getCityAggregateData(cityId).map(cityId -> _)
        }

        // Contributor ids per live city. `None` marks a failed query, distinct from a city that genuinely has no
        // contributors: a failure must drop that city from `byCity` entirely rather than publish a zero next to a
        // six-figure label count, while both cases contribute nothing to the cross-city union.
        val contributorIdsFut: Future[Seq[(String, Option[Set[String]])]] = Future.sequence(
          availableCities.map { cityId =>
            db.run(configTable.getContributorUserIdsBySchema(getCitySchema(cityId)))
              .map(ids => cityId -> Option(ids.toSet))
              .recover { case e: Exception =>
                logger.warn(s"Failed to retrieve contributor ids for city $cityId: ${e.getMessage}")
                cityId -> None
              }
          }
        )

        // Wait for all futures to complete and aggregate results.
        Future.sequence(cityStatsFutures).zip(contributorIdsFut).map { case (cityStats, contributorIds) =>
          // Distinct contributors across all cities, deduped by the global `user_id` (#3976): a union of per-city
          // contributor-id sets rather than a sum of per-city counts, so a user active in multiple cities counts once.
          val totalUsers: Int = contributorIds.flatMap(_._2).foldLeft(Set.empty[String])(_ ++ _).size

          // A city gets a hero slice only when both of its queries succeeded, so every tile in the band is real.
          val contributorCounts: Map[String, Int] = contributorIds.collect { case (cityId, Some(ids)) =>
            cityId -> ids.size
          }.toMap
          val byCity: Map[String, CityImpact] = cityStats.collect {
            case (cityId, Some(stats)) if contributorCounts.contains(cityId) =>
              cityId -> CityImpact(
                contributorCounts(cityId),
                stats.totalLabels,
                stats.totalValidations,
                stats.kmExploredNoOverlap
              )
          }.toMap

          // Filter out failed requests and aggregate the successful ones.
          val validCityStats = cityStats.flatMap(_._2)

          if (validCityStats.isEmpty) {
            logger.warn("No valid city statistics found for aggregate calculation")
            // Return empty aggregate stats if no cities provided data.
            AggregateStatsBundle(emptyAggregateStats(numCities, numCountries, numLanguages), byCity)
          } else {
            val overall = aggregateCityData(validCityStats, numCities, numCountries, numLanguages, totalUsers)
            AggregateStatsBundle(overall, byCity)
          }
        }
      }
    }
  }

  /** Zeroed totals for the two paths where no city produced data, carrying whatever deployment counts are known. */
  private def emptyAggregateStats(numCities: Int, numCountries: Int, numLanguages: Int): AggregateStats =
    AggregateStats(
      kmExplored = 0.0, kmExploredNoOverlap = 0.0, totalLabels = 0, tutorialLabels = 0, totalValidations = 0,
      totalUsers = 0, numCities = numCities, numCountries = numCountries, numLanguages = numLanguages,
      byLabelType = Map.empty
    )

  def getAggregateStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]] = {
    // Cache the full date range once per filterLowQuality variant — a bounded key space, where caching per requested
    // date range would let arbitrary query params mint unbounded cache entries — and slice the requested window out
    // of it. A per-day row depends only on its own day's data, so slicing cached rows is equivalent to querying with
    // bounds; and because rows are keyed by Pacific date, the slice honors the documented inclusive-Pacific-date
    // window exactly, where the raw-timestamp WHERE it replaced could emit partial edge days outside it.
    swrCache
      .staleWhileRevalidate(
        s"getAggregateStatsByDay:filterLowQuality=$filterLowQuality",
        ConfigService.AggregateStatsFreshFor,
        ConfigService.AggregateStatsMaxAge
      )(computeAggregateStatsByDay(filterLowQuality))
      .map { allDays =>
        allDays.filter(r => startDate.forall(!r.date.isBefore(_)) && endDate.forall(!r.date.isAfter(_)))
      }
  }

  /**
   * Runs the full cross-schema fan-out that computes daily stats over the entire date range.
   *
   * Queries each city schema in parallel and sums counts by (date, labelType) across cities. Cities whose schemas do
   * not exist in the current environment are silently skipped (same guard as computeAggregateStats).
   *
   * @param filterLowQuality If true, restrict to high-quality users.
   * @return                 Merged, sorted sequence of DailyStatRecord summed across all cities.
   */
  private def computeAggregateStatsByDay(filterLowQuality: Boolean): Future[Seq[DailyStatRecord]] = {
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
            .run(configTable.getCityDailyLabelStatsBySchema(schema, filterLowQuality))
            .recover { case e: Exception =>
              logger.warn(s"Failed daily label stats for city $cityId: ${e.getMessage}")
              Seq.empty[(LocalDate, String, Int, Int)]
            }
          val valsFuture = db
            .run(configTable.getCityDailyValidationStatsBySchema(schema, filterLowQuality))
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

  def getAiLabelSubmissionEnabled: Boolean = cityFlag("ai-label-submission-enabled", getCityId)

  def getPrivateProfilesByDefault: Boolean = cityFlag("private-profiles-by-default", getCityId)

  /**
   * The initial values for a new user's two privacy flags in this deployment.
   *
   * Public cities start users ON (visible); school/minor deployments that set city-params.private-profiles-by-default
   * start them OFF so usernames aren't public without an explicit opt-in (#4323). Both flags share the one default.
   *
   * This is deployment policy, so it lives here rather than on whichever service happens to create the row: every
   * path that inserts a `user_stat` row must seed the same values, or a user ends up public in a private city
   * depending on which page they (or an admin) happened to hit first.
   *
   * @return (onLeaderboard, publicProfile) for a newly created user_stat row.
   */
  def defaultPrivacyFlags: (Boolean, Boolean) = {
    val isPublic = !getPrivateProfilesByDefault
    (isPublic, isPublic)
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

  // JVM boot time stands in for "when was this instance deployed": prod runs the staged binary as its own process, so
  // process start = deploy/restart. Under dev-mode `sbt ~run` it is the sbt JVM's start, which is close enough locally.
  private val appStartTime: OffsetDateTime =
    OffsetDateTime.ofInstant(Instant.ofEpochMilli(ManagementFactory.getRuntimeMXBean.getStartTime), ZoneOffset.UTC)

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
        mapboxApiKey, version.versionId, version.versionStartTime, version.description, appStartTime, BuildInfo.gitSha,
        BuildInfo.gitDescribe, BuildInfo.gitDirty, allCityInfo, assetManifestService.assetDigestsJson)
    }
  }
}
