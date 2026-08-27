package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskComment, AuditTaskInteractionTable, AuditTaskTable, OutdatedStreetForUser}
import models.label.{LabelLocation, LabelTable}
import models.mission.MissionTable
import models.region.Region
import models.street.StreetEdge
import models.user._
import models.userdashboard.{Trophy, TrophyTable}
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile
import models.utils.ProfanityGuard
import models.validation.LabelValidationTable
import play.api.Logger
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, Messages}
import slick.dbio.DBIO

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, OffsetDateTime, ZoneId}
import java.util.Locale
import javax.inject._
import scala.concurrent.duration.Duration
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

case class UserProfileData(
    userId: String,
    userTeam: Option[Team],
    allTeams: Seq[Team],
    missionCount: Int,
    auditedDistance: Double,
    labelCount: Int,
    validationCount: Int,
    accuracy: Option[Double]
)

/**
 * Everything the public profile page needs for one mapper, or the states in between.
 *
 * The service returns `None` when the username doesn't exist (404 state). When it exists, `visible` is the target's
 * `public_profile` flag OR-ed with the viewer being the owner; `profile`/`trophies` are populated only when visible so
 * a private profile leaks no stats.
 *
 * @param username Display name (as stored).
 * @param visible  Whether the accomplishments may be shown to this viewer.
 * @param profile  KPI/team data, present only when visible.
 * @param trophies The mapper's trophies, empty when not visible.
 */
case class PublicProfile(
    username: String,
    visible: Boolean,
    profile: Option[UserProfileData],
    trophies: Seq[Trophy]
)

/**
 * A user's accuracy for one label type, for the dashboard's learning section.
 *
 * @param labelType   LabelTypeEnum name (e.g. "NoCurbRamp").
 * @param cssKey      Kebab-case key for the `--color-label-*` token (e.g. "no-curb-ramp").
 * @param displayName Human-readable name (e.g. "No Curb Ramp").
 * @param pct         Accuracy percent (correct / validated), 0–100.
 * @param validated   Number of the user's labels of this type that were validated (correct + incorrect).
 * @param weakest     True for the user's lowest-accuracy type (among those with enough validations), to highlight.
 */
case class AccuracyByType(
    labelType: String,
    cssKey: String,
    displayName: String,
    pct: Int,
    validated: Int,
    weakest: Boolean
)

/**
 * One row of the all-time global leaderboard, with the DAO's schema name resolved to a city id (#3719).
 *
 * The view turns `topCityId` into a display name and link via `CommonPageData.allCityInfo`, keeping city naming and
 * localization in one place.
 *
 * @param username       Display name.
 * @param labelCount     Labels placed across all included cities.
 * @param missionCount   Missions completed across all included cities.
 * @param distanceMeters Street distance audited across all included cities.
 * @param accuracy       Cross-city validation agreement rate, or None below the 10-validated-label threshold.
 * @param topCityId      City id where this user placed the most labels, or None if its schema maps to no configured id.
 * @param profileLinked  Whether to link the name to `/userProfile`. False for a mapper with no public profile *here* —
 *                       most rows on most deployments, since a global row can come from a mapper who has never
 *                       labeled in this city — where the link would land on a "kept private" page.
 */
case class GlobalLeaderboardEntry(
    username: String,
    labelCount: Int,
    missionCount: Int,
    distanceMeters: Double,
    accuracy: Option[Double],
    topCityId: Option[String],
    profileLinked: Boolean
)

/**
 * One city in a mapper's cross-city breakdown, ready to render (#4496).
 *
 * @param cityId        Configured city id.
 * @param cityName      Short display name in the viewer's language.
 * @param cityUrl       That deployment's base URL, given even for a city that isn't publicly launched: every row is a
 *                      city this mapper has already worked in, so its URL is nothing they don't have. The global
 *                      leaderboard withholds those same URLs because it shows one mapper's city to everyone (#4979).
 * @param isCurrentCity True for the deployment being viewed, so the UI can mark it.
 * @param labels        Labels placed here.
 * @param validations   Validations given here.
 * @param missions      Missions completed here.
 * @param distance      Distance audited here, already converted to the viewer's units (km or miles).
 * @param liveDistance  Whether `distance` was computed live. True only for the current city; elsewhere it comes from
 *                      the nightly `user_stat.meters_audited` and can lag by up to a day.
 * @param lastActivity  When the mapper last labeled here, or None if they only validated.
 */
case class CityUserStat(
    cityId: String,
    cityName: String,
    cityUrl: String,
    isCurrentCity: Boolean,
    labels: Int,
    validations: Int,
    missions: Int,
    distance: Double,
    liveDistance: Boolean,
    lastActivity: Option[OffsetDateTime]
)

/**
 * A mapper's totals across every Project Sidewalk city they've contributed to (#4496).
 *
 * @param cities          Cities with any contribution, most labels first. Empty is possible (a brand-new account).
 * @param totalLabels     Labels across all of them.
 * @param totalValidation Validations across all of them.
 * @param totalMissions   Missions across all of them.
 * @param totalDistance   Distance across all of them, in the viewer's units.
 * @param publicCityCount How many publicly launched deployments exist, for the "try another city" nudge shown to
 *                        mappers who have only worked in one.
 */
case class CrossCityUserStats(
    cities: Seq[CityUserStat],
    totalLabels: Int,
    totalValidation: Int,
    totalMissions: Int,
    totalDistance: Double,
    publicCityCount: Int
)

/**
 * One city's share of a volunteer's logged hours, for the Time Check page's breakdown (#4526).
 *
 * @param cityId        Configured city id.
 * @param cityName      Short display name in the viewer's language.
 * @param hours         Hours logged in that city, to the tenth the page displays, apportioned so the rows reconcile
 *                      with the headline. May sit a tenth off this city's own value; see
 *                      [[UserService.apportionToTenths]].
 * @param isCurrentCity True for the deployment being viewed.
 */
case class CityHours(cityId: String, cityName: String, hours: Double, isCurrentCity: Boolean)

/**
 * A volunteer's logged hours across every city, and what the total could not reach (#4526).
 *
 * [[totalHours]] is the rounded full-precision total *and* exactly the sum of the rows a reader can see, because the
 * rows are apportioned to it rather than rounded on their own. Rounding both sides independently lets them disagree —
 * `0.25 + 0.25` renders as `0.3 + 0.3` beneath a headline of `0.5` — and a breakdown that visibly fails to add up
 * undermines the one job this page has, which is making the headline credible to a supervisor.
 *
 * @param cities            Cities with logged time, most hours first.
 * @param unreachableCities How many deployments could not be totalled at all. Any of them may have held hours, so a
 *                          nonzero count means the total is a floor rather than an answer, and the page says so.
 */
case class CrossCityHours(cities: Seq[CityHours], unreachableCities: Int) {

  /**
   * The figure a volunteer reports: the sum of the rows shown beneath it, to the tenth.
   *
   * Summed in decimal rather than binary floating point, so adding a column of tenths lands on the tenth itself
   * instead of an ulp either side of it.
   */
  def totalHours: Double = cities.map(city => BigDecimal.decimal(city.hours)).sum.toDouble

  /**
   * Whether the per-city rows are worth showing beneath the total.
   *
   * True for a lone city too when it isn't this deployment, so hours earned elsewhere are never left looking like they
   * were earned here. Lives here rather than in each surface because the volunteer's page and the admin's view of it
   * must not diverge on it (#4986).
   */
  def showBreakdown: Boolean = cities.nonEmpty && (cities.length > 1 || !cities.exists(_.isCurrentCity))
}

/**
 * The cacheable half of [[UserServiceImpl.getCrossCityUserStats]]: the cross-schema fan-out's raw output (#4496).
 *
 * Everything here is viewer-independent — meters, schema names, counts — so one cached copy per mapper serves every
 * combination of measurement system and language. Caching the *rendered* [[CrossCityUserStats]] instead would freeze
 * both: measurement system is a cookie the mapper can flip at any moment, so a toggle followed by a reload inside the
 * TTL would leave the table holding miles under a header that now says "km".
 *
 * @param rows          One row per queried schema, most labels first.
 * @param currentSchema The schema this connection reads, identifying which row is the city being viewed.
 * @param liveMeters    Distance audited in the current city, recomputed live so its row matches the hero KPI exactly.
 */
private[service] case class CrossCityFanOut(
    rows: Seq[CrossCityUserStat],
    currentSchema: String,
    liveMeters: Double
)

/**
 * The admin-only additions to a user's dashboard (`/admin/user/:username/admin`).
 *
 * Hours are not here: the page reports the user's cross-city total, which it fetches after rendering (#4986).
 */
case class AdminUserProfileData(
    currentRegion: Option[Region],
    userStats: UserStat,
    exploreComments: Seq[AuditTaskComment]
)

object UserService {

  /**
   * Minimum cohort size for showing a numeric rank/percentile in "your standing". Below this, the UI reframes to a
   * shared-goal celebration so a small city/class never reads as e.g. "ranked 3 of 4". Source of truth for the UI.
   */
  val StandingCohortThreshold: Int = 8

  /** Number of weeks shown in the activity heatmap (~4 months — enough to read a rhythm without lots of empty cells). */
  val HeatmapWeeks: Int = 18

  /**
   * How many cities the volunteer-hours fan-out queries at once (#4526).
   *
   * Chosen against the pool rather than the city count: `numThreads`/`maxConnections` are both 25, and one page load
   * taking every connection would stall every other request on the instance for the duration. Six keeps most of the
   * parallelism win — the wall clock stays near the volunteer's single heaviest city rather than the sum of 52 — while
   * leaving the pool with room to serve everyone else.
   */
  val CrossCityHoursBatchSize: Int = 6

  /**
   * Rounds hours to the tenth the Time Check page displays, half-up to match `"%.1f".format` (#4526).
   *
   * @param hours Unrounded hours.
   * @return      The same value to one decimal place.
   */
  def toDisplayedTenth(hours: Double): Double =
    BigDecimal.decimal(hours).setScale(1, BigDecimal.RoundingMode.HALF_UP).toDouble

  /**
   * Rounds each city to a tenth such that the rows still add up to the rounded *true* total (#4526).
   *
   * The headline is what a volunteer hands a supervisor, so it is rounded from the full-precision sum rather than
   * assembled out of already-rounded rows — that keeps it the most accurate figure available. Largest-remainder
   * apportionment then hands out the tenths: every row lands on the floor or the ceiling of its own value, and the
   * tenths left over by flooring go to the cities that came nearest to earning one. The breakdown therefore
   * reconciles with the headline exactly, at a cost of at most a tenth on an individual row.
   *
   * Ties break toward the larger city and then the earlier city id, matching the display order, so the same input
   * always produces the same table.
   *
   * @param rows Cities carrying unrounded hours, most hours first.
   * @return     The same rows in the same order, each to one decimal place, summing to the rounded total of the
   *             originals.
   */
  def apportionToTenths(rows: Seq[CityHours]): Seq[CityHours] = {
    val tenths: Seq[BigDecimal] = rows.map(row => BigDecimal.decimal(row.hours) * 10)
    val floors: Seq[Long]       = tenths.map(_.setScale(0, BigDecimal.RoundingMode.FLOOR).toLong)
    val target: Long            = tenths.sum.setScale(0, BigDecimal.RoundingMode.HALF_UP).toLong

    val spare: Int          = (target - floors.sum).toInt
    val roundedUp: Set[Int] = rows.indices
      .sortBy(i => (-(tenths(i) - BigDecimal(floors(i))), -rows(i).hours, rows(i).cityId))
      .take(spare)
      .toSet

    rows.zipWithIndex.map { case (row, i) =>
      row.copy(hours = (floors(i) + (if (roundedUp(i)) 1L else 0L)) / 10d)
    }
  }

  /** Label types shown in the per-type accuracy bars (the ones with canonical `--color-label-*` colors), in order. */
  private val PrimaryLabelTypes: Seq[String] =
    Seq("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal")

  /**
   * Minimum validated labels of a type before it's eligible to be flagged as the user's "weakest" (avoids flagging a
   * type off one or two validations). Public because the dashboard copy states the rule — source of truth for the UI.
   */
  val MinValidatedForWeakest: Int = 5

  /** Meters to the viewer's units. Shared so the hero KPI and the per-city row below it can't round differently. */
  def convertDistance(meters: Double, metricSystem: Boolean): Double =
    if (metricSystem) meters / 1000d else meters * METERS_TO_MILES

  /**
   * The public-profile visibility decision, isolated so it can be unit-tested without a DB. A profile is shown only if
   * the viewer owns it or its `public_profile` flag is on; a missing user_stat row (privacy = None) reads as private so
   * nothing leaks by default.
   *
   * @param privacy The (onLeaderboard, publicProfile) flags, or None if the user has no user_stat row.
   * @param isOwner Whether the viewer is the profile's owner.
   * @return        True if the profile's accomplishments may be shown to this viewer.
   */
  def profileVisible(privacy: Option[(Boolean, Boolean)], isOwner: Boolean): Boolean =
    isOwner || privacy.exists(_._2)

  /**
   * Builds the per-type accuracy rows from raw (labelType, correct, incorrect) tallies. Pure/testable.
   *
   * Keeps only the primary (colored) label types the user has validated labels for, computes each type's accuracy,
   * flags the lowest-accuracy type (among those with enough validations) as `weakest`, and orders canonically.
   */
  def computeAccuracyByType(rows: Seq[(String, Int, Int)]): Seq[AccuracyByType] = {
    val primary                       = PrimaryLabelTypes.toSet
    val pcts: Seq[(String, Int, Int)] = rows.collect {
      case (t, correct, incorrect) if primary.contains(t) && (correct + incorrect) > 0 =>
        (t, math.round(correct.toDouble / (correct + incorrect) * 100).toInt, correct + incorrect)
    }
    val weakest: Option[String] = pcts.filter(_._3 >= MinValidatedForWeakest).sortBy(_._2).headOption.map(_._1)
    pcts.sortBy(p => PrimaryLabelTypes.indexOf(p._1)).map { case (t, pct, total) =>
      AccuracyByType(t, kebabCase(t), spacedCase(t), pct, total, weakest.contains(t))
    }
  }

  /** "NoCurbRamp" -> "no-curb-ramp" (matches the `--color-label-*` token names). */
  private def kebabCase(labelType: String): String = labelType.replaceAll("(?<=[a-z])(?=[A-Z])", "-").toLowerCase

  /** "NoCurbRamp" -> "No Curb Ramp". */
  private def spacedCase(labelType: String): String = labelType.replaceAll("(?<=[a-z])(?=[A-Z])", " ")

  /**
   * Computes streak stats and the heatmap grid from a user's per-day activity counts. Pure (no I/O) so it's easy to
   * test and reason about.
   *
   * @param counts Map of active calendar day (US/Pacific) to that day's contribution count.
   * @param today  Today's date in US/Pacific (passed in so the logic is deterministic/testable).
   * @param locale Locale for the heatmap's cell-date and month labels (defaults to English for tests).
   * @return       Current/longest/total streak plus heatmap cells in column-major order.
   */
  def computeStreakStats(
      counts: Map[LocalDate, Int],
      today: LocalDate,
      locale: Locale = Locale.ENGLISH
  ): StreakStats = {
    val dates: Set[LocalDate] = counts.keySet

    // Current streak: consecutive active days ending today, or ending yesterday if today isn't active yet.
    var current = 0
    var cursor  = if (dates.contains(today)) today else today.minusDays(1)
    while (dates.contains(cursor)) { current += 1; cursor = cursor.minusDays(1) }

    // Longest streak: the longest run of consecutive days across all activity.
    var longest         = 0
    var run             = 0
    var prev: LocalDate = null
    for (d <- dates.toSeq.sorted) {
      run = if (prev != null && prev.plusDays(1) == d) run + 1 else 1
      if (run > longest) longest = run
      prev = d
    }

    // Heatmap: 7 rows (Sun–Sat) × HeatmapWeeks columns, aligned so the last column is the current week.
    val daysFromSunday                 = today.getDayOfWeek.getValue % 7 // Mon=1..Sat=6, Sun=0
    val currentWeekSunday              = today.minusDays(daysFromSunday.toLong)
    val startSunday                    = currentWeekSunday.minusWeeks((HeatmapWeeks - 1).toLong)
    val fmt                            = DateTimeFormatter.ofPattern("EEE, MMM d", locale)
    val cells: Seq[Option[StreakCell]] = for {
      w <- 0 until HeatmapWeeks
      d <- 0 until 7
    } yield {
      val cellDate = startSunday.plusWeeks(w.toLong).plusDays(d.toLong)
      if (cellDate.isAfter(today)) None
      else {
        val c         = counts.getOrElse(cellDate, 0)
        val intensity = c match {
          case 0           => 0
          case n if n <= 2 => 1
          case n if n <= 5 => 2
          case n if n <= 9 => 3
          case _           => 4
        }
        Some(StreakCell(intensity, c, cellDate.format(fmt)))
      }
    }

    // Month label for each week column: the abbreviated month on the first column that falls in a new month (GitHub
    // style), so the heatmap has date scaffolding along the top.
    val monthFmt                          = DateTimeFormatter.ofPattern("MMM", locale)
    var prevMonth                         = -1
    val columnMonths: Seq[Option[String]] = (0 until HeatmapWeeks).map { w =>
      val weekSunday = startSunday.plusWeeks(w.toLong)
      if (weekSunday.getMonthValue != prevMonth) {
        prevMonth = weekSunday.getMonthValue; Some(weekSunday.format(monthFmt))
      } else None
    }

    StreakStats(current, longest, dates.size, cells, columnMonths)
  }
}

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getUserProfileData(userId: String, metricSystem: Boolean): Future[UserProfileData]
  def getDistanceAudited(userId: String): Future[Double]
  def countLabelsFromUser(userId: String): Future[Int]
  def countCompletedMissions(userId: String): Future[Int]
  def countValidations(userId: String): Future[Int]
  def getUserAccuracy(userId: String): Future[Option[Double]]

  /**
   * Updates the high_quality_manual column for the given user. If None, recalculates stats and updates high_quality.
   * @param userId The user whose stats should be updated
   * @param highQualityManual The new value to set in the high_quality_manual column
   * @return The user's new value in the high_quality column; None if user marked excluded or no user found
   */
  def setManualUserQuality(userId: String, highQualityManual: Option[Boolean]): Future[Option[Boolean]]
  def getUserStats(userId: String): Future[Option[UserStat]]
  def getPrivacySettings(userId: String): Future[Option[(Boolean, Boolean)]]
  def updatePrivacySettings(userId: String, onLeaderboard: Boolean, publicProfile: Boolean): Future[Int]
  def getPublicProfile(
      username: String,
      isOwner: Boolean,
      isMetric: Boolean,
      cityName: String,
      messages: Messages
  ): Future[Option[PublicProfile]]
  def resolveVisibleUser(username: String, isOwner: Boolean): Future[Option[String]]
  def validateUsername(userId: String, newUsername: String): Future[Either[String, String]]
  def changeUsername(userId: String, newUsername: String): Future[Either[String, String]]
  def getUserTeam(userId: String): Future[Option[Team]]
  def setUserTeam(userId: String, newTeamId: Int): Future[Int]
  def leaveTeam(userId: String): Future[Int]
  def getAllTeams: Future[Seq[Team]]
  def getAllOpenTeams: Future[Seq[Team]]
  def createTeam(name: String, description: String): Future[Int]
  def getLeaderboardStats(
      n: Int,
      timePeriod: String = "overall",
      byTeam: Boolean = false,
      userIdForTeam: Option[String] = None
  ): Future[Seq[LeaderboardStat]]
  def getUserStanding(userId: String): Future[Option[UserStanding]]

  /**
   * Gets the all-time global leaderboard: top contributors by labels summed across every included city (#3719).
   *
   * @param n How many rows to return.
   * @return  `Some` of up to `n` rows in rank order, each carrying the id of the city where that user labeled most —
   *          `Some(Nil)` meaning the board is live but nobody qualifies yet. `None` when the board can't be computed
   *          (no city qualifies, or the query failed), so the page can omit the section instead of claiming the
   *          community has no labels.
   */
  def getGlobalLeaderboardStats(n: Int): Future[Option[Seq[GlobalLeaderboardEntry]]]

  /**
   * Gets one mapper's own totals in every city they've contributed to (#4496).
   *
   * @param userId       The mapper: the signed-in viewer, or the user an admin is looking at — never a public profile.
   * @param metricSystem Whether to report distances in kilometers rather than miles.
   * @param lang         Language for city display names.
   * @return             `Some` of their breakdown, `Some` with an empty city list for an account that has yet to
   *                     contribute anywhere, or `None` when it can't be computed so the page can omit the section
   *                     rather than claim the mapper has done nothing.
   */
  def getCrossCityUserStats(userId: String, metricSystem: Boolean, lang: Lang): Future[Option[CrossCityUserStats]]
  def getActivityStreak(userId: String, locale: Locale = Locale.ENGLISH): Future[StreakStats]
  def getAccuracyByType(userId: String): Future[Seq[AccuracyByType]]
  def getTrophies(userId: String, cityName: String, messages: Messages): Future[Seq[Trophy]]
  def getHoursAuditingAndValidating(userId: String): Future[Double]

  /**
   * Gets a volunteer's logged hours in every Project Sidewalk city they've worked in (#4526).
   *
   * Deliberately uncached: volunteers check this page repeatedly in a day while logging service hours, and a total
   * that lagged their last session would be worse than a slow one. The admin surface leans on the same freshness —
   * an admin opens it to check a claim the volunteer just made, so a cached copy would put the two numbers back into
   * disagreement, which is what #4986 exists to end.
   *
   * Never fails: if the fan-out can't run at all, it degrades to this city's own total, which is what the page
   * reported before it learned to look further.
   *
   * @param userId The volunteer: the signed-in viewer on `/timeCheck`, or the user being administered on
   *               `/admin/user/:username/admin`, which must report the same figure (#4986).
   * @param lang   Language for city display names.
   * @return       Cities with any logged time, most hours first; empty when nothing has been logged anywhere.
   */
  def getCrossCityHours(userId: String, lang: Lang): Future[CrossCityHours]
  def getAuditedStreets(userId: String): Future[Seq[(StreetEdge, Boolean)]]
  def getOutdatedStreetsForUser(userId: String, limit: Int): Future[(Seq[OutdatedStreetForUser], Int)]
  def getLabelLocations(userId: String, regionId: Option[Int] = None): Future[Seq[LabelLocation]]
  def updateTaskFlag(auditTaskId: Int, flag: String, state: Boolean): Future[Int]
  def updateTaskFlagsBeforeDate(userId: String, date: OffsetDateTime, flag: String, state: Boolean): Future[Int]
  def insertUserUtm(utm: UserUtm): Future[Int]
}

@Singleton
class UserServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    userStatTable: UserStatTable,
    sidewalkUserTable: SidewalkUserTable,
    trophyTable: TrophyTable,
    missionTable: MissionTable,
    labelTable: LabelTable,
    labelValidationTable: LabelValidationTable,
    auditTaskTable: AuditTaskTable,
    auditTaskInteractionTable: AuditTaskInteractionTable,
    streetService: StreetService,
    userTeamTable: UserTeamTable,
    teamTable: TeamTable,
    userUtmTable: UserUtmTable,
    configService: ConfigService,
    cacheApi: AsyncCacheApi,
    implicit val ec: ExecutionContext
) extends UserService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  /**
   * Gets the data to show on a user's dashboard.
   * @param userId ID of the user whose data we're getting.
   * @param metricSystem Whether to return distance in metric units.
   */
  def getUserProfileData(userId: String, metricSystem: Boolean): Future[UserProfileData] = {
    db.run(for {
      userTeam: Option[Team] <- userTeamTable.getTeam(userId)
      teams: Seq[Team]       <- teamTable.getAllTeams
      missionCount: Int <- missionTable.countCompletedMissions(userId, includeOnboarding = true, includeSkipped = false)
      auditedDistanceMeters: Double <- auditTaskTable.getDistanceAudited(userId)
      labelCount: Int               <- labelTable.countLabelsFromUser(userId)
      valCount: Int                 <- labelValidationTable.countValidations(userId)
      accuracy: Option[Double]      <- labelValidationTable.getUserAccuracy(userId)
    } yield {
      val auditedDistance: Double = UserService.convertDistance(auditedDistanceMeters, metricSystem)
      UserProfileData(userId, userTeam, teams, missionCount, auditedDistance, labelCount, valCount, accuracy)
    })
  }

  def setManualUserQuality(userId: String, highQualityManual: Option[Boolean]): Future[Option[Boolean]] = {
    db.run(for {
      hqmRowsUpdated <- userStatTable.updateHighQualityManual(userId, highQualityManual)

      // If high_quality_manual set to None, recalculate stats to update high_quality column.
      hqRowsUpdated <- {
        if (highQualityManual.isDefined) userStatTable.updateHighQuality(userId, highQualityManual.get)
        else updateStatsForUser(userId)
      }

      // If rows weren't actually updated, return None, otherwise return the user's new high_quality value.
      currUserStats <- {
        if (hqmRowsUpdated > 0 && hqRowsUpdated > 0) userStatTable.getStatsFromUserId(userId)
        else DBIO.successful(None)
      }
    } yield currUserStats.map(_.highQuality))
  }

  def getUserStats(userId: String): Future[Option[UserStat]] = db.run(userStatTable.getStatsFromUserId(userId))

  /**
   * Calls functions to update all columns in user_stat table for the given user.
   * @param userId The user whose stats should be updated
   * @return The number of users whose stats were updated; should be 1, or 0 if user marked excluded or no user found
   */
  private def updateStatsForUser(userId: String): DBIO[Int] = {
    for {
      _           <- userStatTable.updateAuditedDistance(userId)
      _           <- userStatTable.updateLabelsPerMeter(userId)
      _           <- userStatTable.updateAccuracy(Seq(userId))
      rowsUpdated <- userStatTable.updateUserQuality(userId)
    } yield rowsUpdated
  }

  def getDistanceAudited(userId: String): Future[Double] = db.run(auditTaskTable.getDistanceAudited(userId))

  def countLabelsFromUser(userId: String): Future[Int] = db.run(labelTable.countLabelsFromUser(userId))

  def countCompletedMissions(userId: String): Future[Int] =
    db.run(missionTable.countCompletedMissions(userId, includeOnboarding = true, includeSkipped = false))

  def countValidations(userId: String): Future[Int] = db.run(labelValidationTable.countValidations(userId))

  def getUserAccuracy(userId: String): Future[Option[Double]] = db.run(labelValidationTable.getUserAccuracy(userId))

  def getPrivacySettings(userId: String): Future[Option[(Boolean, Boolean)]] =
    db.run(userStatTable.getPrivacySettings(userId))

  def updatePrivacySettings(userId: String, onLeaderboard: Boolean, publicProfile: Boolean): Future[Int] =
    db.run(userStatTable.updatePrivacySettings(userId, onLeaderboard, publicProfile))

  def getPublicProfile(
      username: String,
      isOwner: Boolean,
      isMetric: Boolean,
      cityName: String,
      messages: Messages
  ): Future[Option[PublicProfile]] = {
    sidewalkUserTable.findByUsername(username).flatMap {
      case None    => Future.successful(None) // No such user -> the view shows a "not found" state.
      case Some(u) =>
        db.run(userStatTable.getPrivacySettings(u.userId)).flatMap { privacy =>
          val visible = UserService.profileVisible(privacy, isOwner)
          if (visible) {
            for {
              profile  <- getUserProfileData(u.userId, isMetric)
              trophies <- getTrophies(u.userId, cityName, messages)
            } yield Some(PublicProfile(u.username, visible = true, Some(profile), trophies))
          } else {
            Future.successful(Some(PublicProfile(u.username, visible = false, None, Seq.empty)))
          }
        }
    }
  }

  /**
   * Resolves a username to its user id only if the profile may be shown to this viewer, gating the public profile's
   * map endpoints. Returns None for an unknown username or a private profile the viewer doesn't own.
   *
   * @param username The mapper's username.
   * @param isOwner  Whether the viewer is that mapper (owners always see their own map).
   * @return         Some(userId) if visible, else None.
   */
  def resolveVisibleUser(username: String, isOwner: Boolean): Future[Option[String]] = {
    sidewalkUserTable.findByUsername(username).flatMap {
      case None    => Future.successful(None)
      case Some(u) =>
        if (isOwner) Future.successful(Some(u.userId))
        else
          db.run(userStatTable.getPrivacySettings(u.userId))
            .map(p => if (UserService.profileVisible(p, isOwner)) Some(u.userId) else None)
    }
  }

  /**
   * Checks a requested username without applying it (#4373), enforcing the same rules the Settings UI advertises.
   *
   * Rejects (returns `Left(messageKey)`) empty/too-short/too-long names, disallowed characters, profanity, and names
   * already taken by another user. A no-op change to the user's current name is allowed. Separate from the write so a
   * save that also touches other settings can refuse before it writes any of them.
   *
   * @param userId      The user changing their name.
   * @param newUsername The requested new username (leading/trailing whitespace is trimmed).
   * @return `Right(trimmedUsername)` if acceptable, or `Left(i18nKey)` if rejected — the caller localizes the key.
   */
  def validateUsername(userId: String, newUsername: String): Future[Either[String, String]] = {
    val name = newUsername.trim
    // Bounds/charset come from UsernamePolicy so rename and sign-up enforce the same contract (#4375); the caller
    // localizes the returned i18n key at the HTTP boundary.
    if (name.length < forms.UsernamePolicy.minLength || name.length > forms.UsernamePolicy.maxLength)
      Future.successful(Left("dashboard.settings.username.error.length"))
    else if (forms.UsernamePolicy.pattern.findFirstIn(name).isEmpty)
      Future.successful(Left("dashboard.settings.username.error.charset"))
    else if (!ProfanityGuard.isClean(name))
      Future.successful(Left("dashboard.settings.username.error.allowed"))
    else
      sidewalkUserTable.findByUsername(name).map {
        case Some(existing) if existing.userId != userId => Left("dashboard.settings.username.error.taken")
        case _                                           => Right(name)
      }
  }

  /**
   * Validates and applies a username change. Usernames are display-only (everything keys on user_id), so no
   * downstream references need updating.
   *
   * @return `Right(trimmedUsername)` on success, or `Left(i18nKey)` from [[validateUsername]] if rejected.
   */
  def changeUsername(userId: String, newUsername: String): Future[Either[String, String]] = {
    validateUsername(userId, newUsername).flatMap {
      case Right(name) => db.run(sidewalkUserTable.updateUsername(userId, name)).map(_ => Right(name))
      case left        => Future.successful(left)
    }
  }

  def getUserTeam(userId: String): Future[Option[Team]] = db.run(userTeamTable.getTeam(userId))

  def setUserTeam(userId: String, newTeamId: Int): Future[Int] = {
    val updateTeamAction = userTeamTable.getTeam(userId).flatMap {
      case Some(team) if team.teamId != newTeamId =>
        userTeamTable
          .remove(userId, team.teamId)
          .flatMap(_ => userTeamTable.save(userId, newTeamId))
      case None => userTeamTable.save(userId, newTeamId)
      case _    => DBIO.successful(0)
    }
    db.run(updateTeamAction)
  }

  def leaveTeam(userId: String): Future[Int] = {
    val action: DBIO[Int] = userTeamTable.getTeam(userId).flatMap {
      case Some(team) => userTeamTable.remove(userId, team.teamId)
      case None       => DBIO.successful(0)
    }
    db.run(action)
  }

  def getAllTeams: Future[Seq[Team]] = db.run(teamTable.getAllTeams)

  def getAllOpenTeams: Future[Seq[Team]] = db.run(teamTable.getAllOpenTeams)

  def createTeam(name: String, description: String): Future[Int] = db.run(teamTable.insert(name, description))

  def getLeaderboardStats(
      n: Int,
      timePeriod: String = "overall",
      byTeam: Boolean = false,
      userIdForTeam: Option[String] = None
  ): Future[Seq[LeaderboardStat]] = {
    db.run(for {
      // If we are only showing the leaderboard for the user's team, get the teamId.
      teamId: Option[Int] <- userIdForTeam match {
        case Some(userId) => userTeamTable.getTeam(userId).map(_.map(_.teamId))
        case None         => DBIO.successful(None)
      }
      streetDist: Double          <- streetService.getTotalStreetDistanceDBIO
      stats: Seq[LeaderboardStat] <- userStatTable.getLeaderboardStats(n, timePeriod, byTeam, teamId, streetDist)
    } yield stats)
  }

  def getGlobalLeaderboardStats(n: Int): Future[Option[Seq[GlobalLeaderboardEntry]]] = {
    // Cached because every city's deployment renders the same global board, so an uncached read would recompute a
    // ~50-schema union on each of their page loads. 10 minutes matches the other cross-city reads; the board is
    // all-time, so it barely moves between refreshes. The recover sits outside the cache so a transient DB failure
    // isn't stored as a successful "no board" for the next 10 minutes.
    cacheApi
      .getOrElseUpdate[Option[Seq[GlobalLeaderboardEntry]]](
        s"getGlobalLeaderboardStats_$n",
        Duration(10, "minutes")
      ) {
        configService.getGlobalLeaderboardScope.flatMap { scope =>
          if (scope.cities.isEmpty) {
            Future.successful(None)
          } else {
            val cityIdBySchema: Map[String, String] = scope.cities.map { case (cityId, schema) =>
              schema -> cityId
            }.toMap
            db.run(userStatTable.getGlobalLeaderboardStats(scope.cities.map(_._2), scope.optOutSchemas, n)).flatMap {
              stats =>
                // Profile visibility is per city, so it's resolved against *this* deployment's user_stat rows: a row
                // earned entirely in another city has no profile to link to here.
                db.run(userStatTable.usersWithPublicProfile(stats.map(_.userId))).map { linkable =>
                  Some(stats.map { stat =>
                    GlobalLeaderboardEntry(stat.username, stat.labelCount, stat.missionCount, stat.distanceMeters,
                      stat.accuracy, cityIdBySchema.get(stat.topCitySchema), linkable.contains(stat.userId))
                  })
                }
            }
          }
        }
      }
      .recover { case e: Exception =>
        // The section is supplementary, so a failure here drops it rather than taking down the whole leaderboard page.
        logger.warn(s"Failed to compute the global leaderboard, omitting the section: ${e.getMessage}", e)
        None
      }
  }

  def getCrossCityUserStats(userId: String, metricSystem: Boolean, lang: Lang): Future[Option[CrossCityUserStats]] = {
    val cityInfoById: Map[String, CityInfo] =
      configService.getAllCityInfo(lang).map(city => city.cityId -> city).toMap
    val publicCityCount: Int = cityInfoById.values.count(_.visibility == "public")

    // The scope is resolved BEFORE the cache block, not inside it. Both are backed by the same Caffeine cache, and
    // Caffeine's computeIfAbsent refuses to be re-entered on the same thread — a nested getOrElseUpdate throws
    // "Recursive update" whenever the inner key happens to be cold.
    configService.getCrossCityUserScope
      .flatMap { scope =>
        // Keyed per user and short-lived: this is one mapper's own data, and it should reflect a label they placed a
        // minute ago. The TTL exists to absorb a reload, not to keep the number stale. As elsewhere, the recover sits
        // outside the cache so a transient DB failure isn't memoized as "no cities" (Play only caches a success).
        //
        // Only the fan-out is cached; units and language are applied to every response. See [[CrossCityFanOut]].
        cacheApi
          .getOrElseUpdate[CrossCityFanOut](s"getCrossCityUserStats_$userId", Duration(60, "seconds")) {
            for {
              // Identifies the current city by the schema the connection actually reads, so the row marked "you're
              // here" is the one the hero KPIs above it were computed from.
              // Both in one round trip; neither depends on the other.
              (currentSchema, archiveSchemas) <- db.run(
                userStatTable.currentSchema.zip(userStatTable.schemasWithVoidedValidationArchive)
              )
              // That city's distance is recomputed live rather than read from the nightly user_stat value, so its row
              // matches the hero KPI exactly. Other cities keep the nightly value — recomputing geodesic lengths in a
              // 50-way union is what the cross-schema query exists to avoid.
              liveMeters <- db.run(auditTaskTable.getDistanceAudited(userId))
              rows       <- db.run(userStatTable.getCrossCityUserStats(scope.map(_._2), archiveSchemas, userId))
            } yield CrossCityFanOut(rows, currentSchema, liveMeters)
          }
          .map { fanOut =>
            val cityIdBySchema: Map[String, String] = scope.map { case (cityId, schema) => schema -> cityId }.toMap
            val cities: Seq[CityUserStat]           = fanOut.rows.flatMap { row =>
              cityIdBySchema.get(row.citySchema).flatMap(cityInfoById.get).flatMap { city =>
                val isCurrent: Boolean   = row.citySchema == fanOut.currentSchema
                val meters: Double       = if (isCurrent) fanOut.liveMeters else row.metersAudited.getOrElse(0d)
                val hasActivity: Boolean = row.labels > 0 || row.validations > 0 || row.missions > 0 || meters > 0d
                if (!hasActivity) None
                else {
                  Some(
                    CityUserStat(
                      city.cityId,
                      city.cityNameShort,
                      city.URL,
                      isCurrent,
                      row.labels,
                      row.validations,
                      row.missions,
                      UserService.convertDistance(meters, metricSystem),
                      isCurrent,
                      row.lastActivity
                    )
                  )
                }
              }
            }
            Some(
              CrossCityUserStats(
                cities,
                cities.map(_.labels).sum,
                cities.map(_.validations).sum,
                cities.map(_.missions).sum,
                cities.map(_.distance).sum,
                publicCityCount
              )
            )
          }
      }
      .recover { case e: Exception =>
        // Supplementary section: a failure hides it rather than breaking the dashboard the mapper came for.
        logger.warn(s"Failed to compute cross-city user stats, omitting the section: ${e.getMessage}", e)
        None
      }
  }

  /**
   * Gets the user's weekly standing (rank by labels) plus how many spots they've moved since last week.
   *
   * Computes this week's standing (with a neighbor slice) and last week's rank in one round trip, then sets `delta`
   * to `lastWeekRank - thisWeekRank` (positive = climbed). `delta` is `None` if the user wasn't ranked last week.
   */
  def getUserStanding(userId: String): Future[Option[UserStanding]] = {
    db.run(for {
      thisWeek <- userStatTable.getUserStanding(userId, "weekly", n = 2)
      lastWeek <- userStatTable.getUserStanding(userId, "lastWeek", n = 0)
    } yield thisWeek.map(tw => tw.copy(delta = lastWeek.map(lw => lw.rank - tw.rank))))
  }

  def getActivityStreak(userId: String, locale: Locale = Locale.ENGLISH): Future[StreakStats] = {
    db.run(userStatTable.getActivityDayCounts(userId)).map { rows =>
      val counts = rows.map { case (day, count) => LocalDate.parse(day) -> count }.toMap
      UserService.computeStreakStats(counts, LocalDate.now(ZoneId.of("US/Pacific")), locale)
    }
  }

  def getAccuracyByType(userId: String): Future[Seq[AccuracyByType]] = {
    db.run(userStatTable.getLabelTypeAccuracy(userId)).map(UserService.computeAccuracyByType)
  }

  /** Explore-this-neighborhood link for a region trophy — opens the audit tool scoped to that region. */
  private def exploreRegionLink(regionId: Int): String = s"/explore?regionId=$regionId"

  /**
   * Assembles a user's trophy case from the four trophy queries.
   *
   * Trophy titles are deliberately untranslated brand names (#4475); the sub lines localize through `messages`,
   * whose locale also formats the weekly-podium dates.
   */
  def getTrophies(userId: String, cityName: String, messages: Messages): Future[Seq[Trophy]] = {
    val aiId = SidewalkUserTable.aiUserId
    // Kick off the four independent queries before the for-comprehension so they run in parallel.
    val cityPioneerF    = db.run(trophyTable.getCityPioneerUserId(aiId))
    val regionPioneersF = db.run(trophyTable.getRegionPioneers(userId, aiId, 5))
    val championsF      = db.run(trophyTable.getRegionChampions(userId, aiId, 6))
    val weeklyF         = db.run(trophyTable.getWeeklyPodiums(userId, 6))
    val freeExploreF    = db.run(trophyTable.getFreeExplorationTrophyFlags(userId))
    val medals          = Map(1 -> "🥇", 2 -> "🥈", 3 -> "🥉")
    val weekOfFmt       = DateTimeFormatter.ofPattern("MMM d, yyyy", messages.lang.toLocale)
    for {
      cityPioneer                            <- cityPioneerF
      regionPioneers                         <- regionPioneersF
      champions                              <- championsF
      weekly                                 <- weeklyF
      (triedFreeExplore, labeledFreeExplore) <- freeExploreF
    } yield {
      // Order by prestige/rarity: city pioneer, then region pioneers, then region champions, then weekly podiums.
      val cityTrophy =
        if (cityPioneer.contains(userId))
          Seq(Trophy("🌱", "City pioneer", messages("dashboard.trophy.sub.pioneer", cityName), "pioneer"))
        else Seq.empty
      val regionPioneerTrophies = regionPioneers.map { case (name, regionId) =>
        Trophy(
          "🧭",
          "Region pioneer",
          messages("dashboard.trophy.sub.pioneer", name),
          "pioneer",
          link = Some(exploreRegionLink(regionId))
        )
      }
      val championTrophies = champions.map { case (name, regionId, count) =>
        Trophy(
          "👑",
          s"$name champion",
          messages("dashboard.trophy.sub.champion", "%,d".format(count)),
          "region",
          link = Some(exploreRegionLink(regionId))
        )
      }
      val weeklyTrophies = weekly.map { case (weekOf, rank, _) =>
        val weekLabel = LocalDate.parse(weekOf).format(weekOfFmt)
        Trophy(
          medals.getOrElse(rank, "🏅"),
          "Top labeler",
          messages("dashboard.trophy.sub.weekly", weekLabel),
          "podium",
          rank
        )
      }
      // Participation trophies rather than rankings, so they sit last — after everything that had to be earned
      // against other mappers.
      val freeExploreTrophies =
        Seq(
          if (triedFreeExplore)
            Some(Trophy("🗺️", "Free explorer", messages("dashboard.trophy.sub.free-explore-tried"), "freeExplore"))
          else None,
          if (labeledFreeExplore)
            Some(Trophy("🔎", "Explorer's eye", messages("dashboard.trophy.sub.free-explore-labeled"), "freeExplore"))
          else None
        ).flatten

      cityTrophy ++ regionPioneerTrophies ++ championTrophies ++ weeklyTrophies ++ freeExploreTrophies
    }
  }

  def getHoursAuditingAndValidating(userId: String): Future[Double] =
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))

  def getCrossCityHours(userId: String, lang: Lang): Future[CrossCityHours] = {
    val cityInfoById: Map[String, CityInfo] =
      configService.getAllCityInfo(lang).map(city => city.cityId -> city).toMap

    configService.getCrossCityHoursScope
      .flatMap { scope =>
        val currentSchema: String = configService.getCitySchema(configService.getCityId)

        // A per-city fan-out rather than one union: this query is a window function over the interaction log, so it is
        // heavy where the volunteer worked and three index misses where they didn't, and a 52-arm union serializes.
        // Batched rather than started all at once, because the pool has 25 connections and this page is both uncached
        // and reload-heavy — an unbounded fan-out would park every connection and stall the whole instance.
        Batching
          .inBatches(scope.cities, UserService.CrossCityHoursBatchSize) { case (cityId, schema) =>
            // Building the query can throw on a malformed schema name, and that happens while the argument is evaluated,
            // so it has to be caught here rather than by a recover hung off the db.run future.
            Future
              .fromTry(Try(auditTaskInteractionTable.getHoursAuditingAndValidatingBySchema(userId, schema)))
              .flatMap(db.run)
              .map(hours => Right(cityId -> hours))
              .recover { case e: Exception =>
                // One unreadable schema costs its own row, not the volunteer's whole total.
                logger.warn(s"Could not total hours in $schema, omitting the city: ${e.getMessage}", e)
                Left(schema)
              }
          }
          .map { perCity =>
            val (failedSchemas, totals) = perCity.partitionMap(identity)
            val schemaByCityId          = scope.cities.toMap
            val worked                  = totals.filter { case (_, hours) => hours > 0d }

            // A city with hours but no config entry can't be named in the table, so it drops out the same way an
            // unreadable schema does — and has to be counted the same way too.
            val (nameable, unnameable) = worked.partition { case (cityId, _) => cityInfoById.contains(cityId) }
            if (unnameable.nonEmpty) {
              logger.warn(s"No city info for ${unnameable.map(_._1).mkString(", ")}, omitting from the hours breakdown")
            }

            // Sorted on full precision, so the order reflects the real amounts rather than whichever way a tie rounded.
            val rows = nameable
              .flatMap { case (cityId, hours) =>
                cityInfoById.get(cityId).map { city =>
                  CityHours(cityId, city.cityNameShort, hours, schemaByCityId.get(cityId).contains(currentSchema))
                }
              }
              .sortBy(city => (-city.hours, city.cityId))

            CrossCityHours(
              UserService.apportionToTenths(rows),
              scope.skippedSchemas.size + failedSchemas.size + unnameable.size
            )
          }
      }
      .recoverWith { case e: Exception =>
        // Degrade to this city's own total rather than 500 a page a volunteer may be mid-way through logging hours
        // from. If even that fails there is nothing left to show, and it fails the way it always has.
        logger.warn(s"Cross-city hours failed for $userId, falling back to this city alone: ${e.getMessage}", e)
        getHoursAuditingAndValidating(userId).map { hours =>
          val allCities = configService.getAllCityInfo(lang)
          val rows      = Seq(
            CityHours(
              configService.getCityId,
              allCities.find(_.cityId == configService.getCityId).map(_.cityNameShort).getOrElse(""),
              UserService.toDisplayedTenth(hours),
              isCurrentCity = true
            )
          ).filter(_.hours > 0d)
          // Every other deployment went unchecked, not just one — the reader is owed the real size of the gap.
          CrossCityHours(rows, allCities.count(_.cityId != configService.getCityId))
        }
      }
  }

  def getAuditedStreets(userId: String): Future[Seq[(StreetEdge, Boolean)]] =
    db.run(auditTaskTable.getAuditedStreets(userId))

  /**
   * The user's streets that still need a re-audit, capped for display, plus how many there are in total (#4896).
   *
   * @param limit Most rows to return; the total is counted separately so the list can say "showing 12 of 40".
   * @return      (rows, total). Both are empty/zero for a user who has never completed an audit.
   */
  def getOutdatedStreetsForUser(userId: String, limit: Int): Future[(Seq[OutdatedStreetForUser], Int)] = {
    // Independent queries, so they're started before the for-comprehension sequences them.
    val streetsFuture = db.run(auditTaskTable.getOutdatedStreetsForUser(userId, limit))
    val countFuture   = db.run(auditTaskTable.countOutdatedStreetsForUser(userId))
    for {
      streets <- streetsFuture
      count   <- countFuture
    } yield (streets, count)
  }

  def getLabelLocations(userId: String, regionId: Option[Int] = None): Future[Seq[LabelLocation]] =
    db.run(labelTable.getLabelLocations(userId, regionId))

  def updateTaskFlag(auditTaskId: Int, flag: String, state: Boolean): Future[Int] = {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
    db.run(auditTaskTable.updateTaskFlag(auditTaskId, flag, state))
  }

  def updateTaskFlagsBeforeDate(userId: String, date: OffsetDateTime, flag: String, state: Boolean): Future[Int] = {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
    db.run(auditTaskTable.updateTaskFlagsBeforeDate(userId, date, flag, state))
  }

  def insertUserUtm(utm: UserUtm): Future[Int] = db.run(userUtmTable.insert(utm))
}
