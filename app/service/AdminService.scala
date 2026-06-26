package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.audit._
import models.label.{LabelCount, LabelTable, TagCount}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.street.StreetEdgeTable
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.{ApiDailyCount, ApiDailySourceCount, ApiEndpointCount, ApiEndpointSourceCount, ApiFormatCount, ApiFormatSourceCount, ApiSourceIpCount, MyPostgresProfile, WebpageActivityTable}
import models.validation.{LabelValidationTable, ValidationCount, ValidationOption, ValidationTaskCommentTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval.TimeInterval
import slick.dbio.DBIO

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

object TimeInterval extends Enumeration {
  type TimeInterval = Value
  val AllTime = Value("all_time")
  val Week    = Value("week")
  val Today   = Value("today")
}

case class StreetCountsData(
    total: Int,
    audited: Map[String, Int],
    auditedHighQualityOnly: Map[String, Int],
    withOverlap: Map[TimeInterval, Int]
)
case class StreetDistanceData(
    total: Double,
    audited: Map[String, Double],
    auditedHighQualityOnly: Map[String, Double],
    withOverlap: Map[TimeInterval, Double]
)
case class CoverageData(streetCounts: StreetCountsData, streetDistance: StreetDistanceData)

/** Source-split v3 API usage, assembled for the admin API Analytics page. */
case class ApiAnalyticsBySourceData(
    endpointCounts: Seq[ApiEndpointSourceCount],
    dailyCounts: Seq[ApiDailySourceCount],
    formatCounts: Seq[ApiFormatSourceCount],
    ipCounts: Seq[ApiSourceIpCount],
    totalUniqueIps: Long,
    lastApiCall: Option[String]
)

/**
 * One day in the admin Activity page's daily time series — the volume/tempo of each kind of contribution on that date.
 *
 * Sign-ins and active-user counts are split into registered vs anonymous so registered engagement can be read apart
 * from drive-by anonymous traffic. Days with no activity in any series are simply absent; the client zero-fills.
 *
 * @param date              Calendar day (DB session time zone, truncated to the day).
 * @param labels            Labels placed that day (includes tutorial labels, matching the legacy by-date count).
 * @param validations       Human validations completed that day.
 * @param audits            Explore tasks (streets) completed that day.
 * @param missions          Completed, non-skipped, non-onboarding missions that ended that day.
 * @param signinsRegistered Registered sign-in events that day.
 * @param signinsAnon       Anonymous auto sign-ups that day.
 * @param activeRegistered  Distinct registered users with any logged activity that day.
 * @param activeAnon        Distinct anonymous users with any logged activity that day.
 * @param newUsers          Newly registered accounts (SignUp events) that day.
 */
case class ActivityDayRecord(
    date: LocalDate,
    labels: Int,
    validations: Int,
    audits: Int,
    missions: Int,
    signinsRegistered: Int,
    signinsAnon: Int,
    activeRegistered: Int,
    activeAnon: Int,
    newUsers: Int
)

/**
 * One entry in the admin Activity page's recent-activity stream — a single recent contribution by a person.
 *
 * Unifies three kinds of activity so the feed can show them interleaved by recency. The optional fields carry only
 * what the kind needs: a label has a `labelType`; a validation adds a `validationResult`; a comment carries `comment`
 * text. `labelId` is present whenever the item points at a specific label (so the feed can deep-link it).
 *
 * @param activityType     "label", "validation", or "comment".
 * @param username         Who did it.
 * @param timestamp        When.
 * @param labelId          The label this points at, if any.
 * @param labelType        Label type name (labels and validations).
 * @param validationResult "Agree" / "Disagree" / "Unsure" (validations only).
 * @param comment          Comment text (comments only).
 */
case class RecentActivityItem(
    activityType: String,
    username: String,
    timestamp: OffsetDateTime,
    labelId: Option[Int],
    labelType: Option[String],
    validationResult: Option[String],
    comment: Option[String]
)

/**
 * One row of the Contributors page's "Top labelers" leaderboard: a prolific labeler with the breakdowns that reveal
 * *how* they label, not just how much — for spotting patterns and anomalies.
 *
 * @param labelTypeCounts Per-label-type counts, descending — drives the label-type mix bar (canonical colors).
 * @param severityCounts  Per-severity-rating counts, ascending by rating — drives the severity mini-distribution.
 */
case class LabelerLeaderboardEntry(
    userId: String,
    username: String,
    role: String,
    labels: Int,
    ownValidated: Int,
    ownValidatedAgreedPct: Double,
    highQuality: Boolean,
    labelTypeCounts: Seq[(String, Int)],
    severityCounts: Seq[(Int, Int)]
)

/**
 * One row of the Contributors page's "Top validators" leaderboard: an active validator with their agree/disagree/unsure
 * split, so an over-harsh or unsure-everything validator stands out.
 */
case class ValidatorLeaderboardEntry(
    userId: String,
    username: String,
    role: String,
    validations: Int,
    agree: Int,
    disagree: Int,
    unsure: Int,
    agreementPct: Double
)

/** The two Contributors leaderboards, assembled together so the page fetches them in one call. */
case class ContributorLeaderboards(
    labelers: Seq[LabelerLeaderboardEntry],
    validators: Seq[ValidatorLeaderboardEntry]
)

/**
 * One cell of the Data Quality tag-severity heatmap: how many labels of a given type carry a given tag at a given
 * severity. Severity is bucketed to the canonical 1–3 scale (#3306).
 */
case class TagSeverityCount(labelType: String, tag: String, severity: Int, count: Int)

@ImplementedBy(classOf[AdminServiceImpl])
trait AdminService {
  def updateTeamVisibility(teamId: Int, visible: Boolean): Future[Int]
  def updateTeamStatus(teamId: Int, open: Boolean): Future[Int]
  def getValidationCountsByUser: Future[Seq[(String, (String, Int, Int))]]
  def selectMissionCountsPerUser: Future[Seq[(String, String, Int)]]
  def getLabelCountsByUser: Future[Seq[(String, String, Int)]]
  def getAuditCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getLabelCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getValidationCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getActivityByDay: Future[Seq[ActivityDayRecord]]
  def getTagCounts: Future[Seq[TagCount]]
  def getTagSeverityCounts: Future[Seq[TagSeverityCount]]
  def getSignInCounts: Future[Seq[(String, String, Int)]]
  def getAuditedStreetsWithTimestamps: Future[Seq[AuditedStreetWithTimestamp]]
  def findAuditTask(taskId: Int): Future[Option[AuditTask]]
  def getAuditInteractionsWithLabels(auditTaskId: Int): Future[Seq[InteractionWithLabel]]
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData]
  def getCoverageData: Future[CoverageData]
  def getNumUsersContributed: Future[Seq[UserCount]]
  def getContributionTimeStats: Future[Seq[ContributionTimeStat]]
  def getLabelCountStats: Future[Seq[LabelCount]]
  def getValidationCountStats: Future[Seq[ValidationCount]]
  def getRecentExploreAndValidateComments: Future[Seq[GenericComment]]
  def getRecentActivity(n: Int): Future[Seq[RecentActivityItem]]
  def getContributorLeaderboards(n: Int): Future[ContributorLeaderboards]
  def getUserStatsForAdminPage: Future[Seq[UserStatsForAdminPage]]
  def streetDistanceCompletionRateByDate: Future[Seq[(OffsetDateTime, Double)]]
  def updateUserStatTable(cutoffTime: OffsetDateTime): Future[Int]
  def getApiAnalytics(excludeApiDocs: Boolean, days: Int): Future[(Seq[ApiEndpointCount], Seq[ApiDailyCount], Long, Seq[ApiFormatCount])]
  def getApiAnalyticsBySource(days: Int): Future[ApiAnalyticsBySourceData]
}

@Singleton
class AdminServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    userStatTable: UserStatTable,
    userCurrentRegionTable: UserCurrentRegionTable,
    missionTable: MissionTable,
    auditTaskTable: AuditTaskTable,
    auditTaskInteractionTable: AuditTaskInteractionTable,
    auditTaskCommentTable: AuditTaskCommentTable,
    validationTaskCommentTable: ValidationTaskCommentTable,
    streetService: StreetService,
    streetEdgeTable: StreetEdgeTable,
    labelTable: LabelTable,
    labelValidationTable: LabelValidationTable,
    userTeamTable: UserTeamTable,
    webpageActivityTable: WebpageActivityTable,
    teamTable: TeamTable,
    implicit val ec: ExecutionContext,
    cpuEc: CpuIntensiveExecutionContext
) extends AdminService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def updateTeamVisibility(teamId: Int, visible: Boolean): Future[Int] =
    db.run(teamTable.updateVisibility(teamId, visible))
  def updateTeamStatus(teamId: Int, open: Boolean): Future[Int] = db.run(teamTable.updateStatus(teamId, open))
  def getValidationCountsByUser: Future[Seq[(String, (String, Int, Int))]] =
    db.run(labelValidationTable.getValidationCountsByUser)
  def selectMissionCountsPerUser: Future[Seq[(String, String, Int)]] = db.run(missionTable.selectMissionCountsPerUser)
  def getLabelCountsByUser: Future[Seq[(String, String, Int)]]       = db.run(labelTable.getLabelCountsByUser)
  def getAuditCountsByDate: Future[Seq[(OffsetDateTime, Int)]]       = db.run(auditTaskTable.getAuditCountsByDate)
  def getLabelCountsByDate: Future[Seq[(OffsetDateTime, Int)]]       = db.run(labelTable.getLabelCountsByDate)
  def getValidationCountsByDate: Future[Seq[(OffsetDateTime, Int)]]  = db.run(labelValidationTable.getValidationsByDate)

  /**
   * Assembles the unified daily activity time series for the admin Activity page.
   *
   * Each underlying by-date query runs as its own parallel db round-trip, then the results are merged on calendar date
   * so the page can be driven from a single fetch (mirroring how Coverage is driven by one endpoint). Only days that
   * appear in at least one series are emitted; the client zero-fills the gaps.
   *
   * @return Activity records sorted ascending by date.
   */
  def getActivityByDay: Future[Seq[ActivityDayRecord]] = {
    val labelsFut      = db.run(labelTable.getLabelCountsByDate)
    val validationsFut = db.run(labelValidationTable.getValidationsByDate)
    val auditsFut      = db.run(auditTaskTable.getAuditCountsByDate)
    val missionsFut    = db.run(missionTable.getMissionCountsByDate)
    val signinsFut     = db.run(webpageActivityTable.getSignInCountsByDate)
    val activeFut      = db.run(webpageActivityTable.getActiveUserCountsByDate)
    val newUsersFut    = db.run(webpageActivityTable.getNewUserCountsByDate)

    for {
      labels      <- labelsFut
      validations <- validationsFut
      audits      <- auditsFut
      missions    <- missionsFut
      signins     <- signinsFut
      active      <- activeFut
      newUsers    <- newUsersFut
    } yield {
      def toDayMap(rows: Seq[(OffsetDateTime, Int)]): Map[LocalDate, Int] =
        rows.map(r => r._1.toLocalDate -> r._2).toMap
      // The anon-split series carry an isAnonymous flag; partition into two single-valued maps keyed by day.
      def splitMap(rows: Seq[(OffsetDateTime, Boolean, Int)], anon: Boolean): Map[LocalDate, Int] =
        rows.filter(_._2 == anon).map(r => r._1.toLocalDate -> r._3).toMap

      val labelMap       = toDayMap(labels)
      val validationMap  = toDayMap(validations)
      val auditMap       = toDayMap(audits)
      val missionMap     = toDayMap(missions)
      val newUserMap     = toDayMap(newUsers)
      val signinRegMap   = splitMap(signins, anon = false)
      val signinAnonMap  = splitMap(signins, anon = true)
      val activeRegMap   = splitMap(active, anon = false)
      val activeAnonMap  = splitMap(active, anon = true)

      val allDates: Seq[LocalDate] = (labelMap.keySet ++ validationMap.keySet ++ auditMap.keySet ++ missionMap.keySet ++
        newUserMap.keySet ++ signinRegMap.keySet ++ signinAnonMap.keySet ++ activeRegMap.keySet ++
        activeAnonMap.keySet).toSeq.sorted

      allDates.map { d =>
        ActivityDayRecord(
          date = d,
          labels = labelMap.getOrElse(d, 0),
          validations = validationMap.getOrElse(d, 0),
          audits = auditMap.getOrElse(d, 0),
          missions = missionMap.getOrElse(d, 0),
          signinsRegistered = signinRegMap.getOrElse(d, 0),
          signinsAnon = signinAnonMap.getOrElse(d, 0),
          activeRegistered = activeRegMap.getOrElse(d, 0),
          activeAnon = activeAnonMap.getOrElse(d, 0),
          newUsers = newUserMap.getOrElse(d, 0)
        )
      }
    }
  }

  def getTagCounts: Future[Seq[TagCount]]                            = db.run(labelTable.getTagCounts)

  /**
   * Tag-severity counts for the Data Quality heatmap, with severity bucketed to the canonical 1–3 scale (legacy
   * out-of-range ratings are clamped into the nearest bucket and re-summed).
   */
  def getTagSeverityCounts: Future[Seq[TagSeverityCount]] = {
    db.run(labelTable.getTagSeverityCounts).map { rows =>
      rows
        .collect { case (labelType, tag, Some(sev), count) => (labelType, tag, math.min(3, math.max(1, sev)), count) }
        .groupBy { case (labelType, tag, severity, _) => (labelType, tag, severity) }
        .map { case ((labelType, tag, severity), group) => TagSeverityCount(labelType, tag, severity, group.map(_._4).sum) }
        .toSeq
    }
  }
  def getSignInCounts: Future[Seq[(String, String, Int)]]            = db.run(webpageActivityTable.getSignInCounts)
  def getAuditedStreetsWithTimestamps: Future[Seq[AuditedStreetWithTimestamp]] =
    db.run(auditTaskTable.getAuditedStreetsWithTimestamps)
  def findAuditTask(taskId: Int): Future[Option[AuditTask]] = db.run(auditTaskTable.find(taskId))
  def getAuditInteractionsWithLabels(auditTaskId: Int): Future[Seq[InteractionWithLabel]] =
    db.run(auditTaskInteractionTable.getAuditInteractionsWithLabels(auditTaskId))

  /**
   * Gets the additional data to show on the admin view of a user's dashboard.
   * @param userId ID of the user whose data we're getting.
   */
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData] = {
    db.run(for {
      currRegion: Option[Region]              <- userCurrentRegionTable.getCurrentRegion(userId)
      completedAudits: Int                    <- auditTaskTable.countCompletedAuditsForUser(userId)
      hoursWorked: Double                     <- auditTaskInteractionTable.getHoursAuditingAndValidating(userId)
      existingStats: Option[UserStat]         <- userStatTable.getStatsFromUserId(userId)
      // Insert a user_stat if the user hasn't visited this server before, allowing this page to load.
      userStats: UserStat <- existingStats match {
        case Some(stats) => DBIO.successful(stats)
        case None        =>
          userStatTable.insert(userId).flatMap(_ => userStatTable.getStatsFromUserId(userId).map(_.get))
      }
      completedMissions: Seq[RegionalMission] <- missionTable.selectCompletedRegionalMission(userId)
      comments: Seq[AuditTaskComment]         <- auditTaskCommentTable.all(userId)
    } yield {
      AdminUserProfileData(currRegion, completedAudits, hoursWorked, userStats, completedMissions, comments)
    })
  }

  def getCoverageData: Future[CoverageData] = {
    val ALL_ROLES = Seq("All", "Registered", "Anonymous", "Turker", "Researcher")
    db.run(for {
      totalStreetCount: Int                <- streetService.getStreetCountDBIO
      auditedStreetCount: Int              <- streetEdgeTable.countDistinctAuditedStreets()
      auditedStreetCountHQ: Int            <- streetEdgeTable.countDistinctAuditedStreets(highQualityOnly = true)
      auditCountByRole: Map[String, Int]   <- streetEdgeTable.countDistinctAuditedStreetsByRole()
      auditCountByRoleHQ: Map[String, Int] <- streetEdgeTable.countDistinctAuditedStreetsByRole(highQualityOnly = true)
      auditCountAllTime: Int               <- auditTaskTable.countCompletedAudits()
      auditCountPastWeek: Int              <- auditTaskTable.countCompletedAudits(TimeInterval.Week)
      auditCountToday: Int                 <- auditTaskTable.countCompletedAudits(TimeInterval.Today)
      totalStreetDist: Double              <- streetService.getTotalStreetDistanceDBIO
      auditedDist: Double                  <- streetEdgeTable.auditedStreetDistance()
      auditedDistHQ: Double                <- streetEdgeTable.auditedStreetDistance(highQualityOnly = true)
      auditedDistByRole: Map[String, Double]   <- streetEdgeTable.auditedStreetDistanceByRole()
      auditedDistByRoleHQ: Map[String, Double] <- streetEdgeTable.auditedStreetDistanceByRole(highQualityOnly = true)
      auditedDistAllTime: Double               <- streetEdgeTable.auditedStreetDistanceOverTime()
      auditedDistPastWeek: Double              <- streetEdgeTable.auditedStreetDistanceOverTime(TimeInterval.Week)
      auditedDistToday: Double                 <- streetEdgeTable.auditedStreetDistanceOverTime(TimeInterval.Today)
    } yield {
      // Make sure that each role has a value in all maps, default to 0.
      val fullAuditCountByRole: Map[String, Int] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedStreetCount else auditCountByRole.getOrElse(role, 0))
      }.toMap
      val fullAuditCountByRoleHQ: Map[String, Int] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedStreetCountHQ else auditCountByRoleHQ.getOrElse(role, 0))
      }.toMap
      val fullAuditedDistByRole: Map[String, Double] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedDist else auditedDistByRole.getOrElse(role, 0d)) * METERS_TO_MILES
      }.toMap
      val fullAuditedDistByRoleHQ: Map[String, Double] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedDistHQ else auditedDistByRoleHQ.getOrElse(role, 0d)) * METERS_TO_MILES
      }.toMap

      CoverageData(
        StreetCountsData(
          totalStreetCount,
          fullAuditCountByRole,
          fullAuditCountByRoleHQ,
          Map(
            TimeInterval.AllTime -> auditCountAllTime,
            TimeInterval.Week    -> auditCountPastWeek,
            TimeInterval.Today   -> auditCountToday
          )
        ),
        StreetDistanceData(
          totalStreetDist * METERS_TO_MILES,
          fullAuditedDistByRole,
          fullAuditedDistByRoleHQ,
          Map(
            TimeInterval.AllTime -> auditedDistAllTime * METERS_TO_MILES,
            TimeInterval.Week    -> auditedDistPastWeek * METERS_TO_MILES,
            TimeInterval.Today   -> auditedDistToday * METERS_TO_MILES
          )
        )
      )
    })
  }

  /**
   * Gets the number of users who contributed data to Project Sidewalk under various groupings/filters for Admin page.
   */
  def getNumUsersContributed: Future[Seq[UserCount]] = {
    // Start by querying all the data we need from the db in parallel.
    db.run(
      DBIO
        .sequence(
          Seq(
            userStatTable.countAllUsersContributed().map(Seq(_)),
            userStatTable.countAllUsersContributed(taskCompletedOnly = true).map(Seq(_)),
            userStatTable.countAllUsersContributed(highQualityOnly = true).map(Seq(_)),
            userStatTable.countAllUsersContributed(taskCompletedOnly = true, highQualityOnly = true).map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Week).map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Week, taskCompletedOnly = true).map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Week, highQualityOnly = true).map(Seq(_)),
            userStatTable
              .countAllUsersContributed(TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = true)
              .map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Today).map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Today, taskCompletedOnly = true).map(Seq(_)),
            userStatTable.countAllUsersContributed(TimeInterval.Today, highQualityOnly = true).map(Seq(_)),
            userStatTable
              .countAllUsersContributed(TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = true)
              .map(Seq(_)),
            userStatTable.countExploreUsersContributed(),
            userStatTable.countExploreUsersContributed(taskCompletedOnly = true),
            userStatTable.countExploreUsersContributed(TimeInterval.Week),
            userStatTable.countExploreUsersContributed(TimeInterval.Week, taskCompletedOnly = true),
            userStatTable.countExploreUsersContributed(TimeInterval.Today),
            userStatTable.countExploreUsersContributed(TimeInterval.Today, taskCompletedOnly = true),
            userStatTable.countValidateUsersContributed(),
            userStatTable.countValidateUsersContributed(labelValidated = true),
            userStatTable.countValidateUsersContributed(TimeInterval.Week),
            userStatTable.countValidateUsersContributed(TimeInterval.Week, labelValidated = true),
            userStatTable.countValidateUsersContributed(TimeInterval.Today),
            userStatTable.countValidateUsersContributed(TimeInterval.Today, labelValidated = true)
          )
        )
        .map(_.flatten)
    ).map { userCounts: Seq[UserCount] =>
      // For separated Explore and Validate users, sum all roles to create entries for "all".
      val exploreCounts  = userCounts.filter(uc => uc.toolUsed == "explore")
      val validateCounts = userCounts.filter(uc => uc.toolUsed == "validate")
      // format: off
      userCounts ++ Seq(
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.AllTime, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.AllTime, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Today && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Today, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Today && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Week && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Week, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Week && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.AllTime, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.AllTime, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Today && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Today, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Today && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Week && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Week, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Week && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = false)
      )
      // format: on
    }(cpuEc)
  }

  /**
   * Gets the total/average contribution time across of Project Sidewalk users for the Admin page.
   */
  def getContributionTimeStats: Future[Seq[ContributionTimeStat]] = {
    // Query all the data we need from the db in parallel.
    db.run(
      DBIO.sequence(
        Seq(
          auditTaskInteractionTable.calculateTimeExploring(),
          auditTaskInteractionTable.calculateTimeExploring(TimeInterval.Week),
          auditTaskInteractionTable.calculateTimeExploring(TimeInterval.Today),
          auditTaskInteractionTable.calculateTimeValidating(),
          auditTaskInteractionTable.calculateTimeValidating(TimeInterval.Week),
          auditTaskInteractionTable.calculateTimeValidating(TimeInterval.Today),
          auditTaskInteractionTable.calculateMedianExploringTime(),
          auditTaskInteractionTable.calculateMedianExploringTime(TimeInterval.Week),
          auditTaskInteractionTable.calculateMedianExploringTime(TimeInterval.Today)
        )
      )
    )
  }

  /**
   * Gets the number of labels added in Project Sidewalk grouped by label type and time interval for Admin page.
   */
  def getLabelCountStats: Future[Seq[LabelCount]] = {
    // Query all the data we need from the db in parallel.
    db.run(
      DBIO.sequence(
        Seq(
          labelTable.countLabelsByType(),
          labelTable.countLabelsByType(TimeInterval.Week),
          labelTable.countLabelsByType(TimeInterval.Today)
        )
      )
    ).map(_.flatten)
  }

  /**
   * Gets the number of Project Sidewalk validations grouped by label type, result, and time interval for Admin page.
   */
  def getValidationCountStats: Future[Seq[ValidationCount]] = {
    // Query all the data we need from the db in parallel.
    db.run(
      DBIO.sequence(
        Seq(
          labelValidationTable.countValidationsByResultAndLabelType(),
          labelValidationTable.countValidationsByResultAndLabelType(TimeInterval.Week),
          labelValidationTable.countValidationsByResultAndLabelType(TimeInterval.Today)
        )
      )
    ).map(_.flatten)
  }

  /**
   * Gets the 100 most recent comments made through either the Explore or (any) Validate page.
   */
  def getRecentExploreAndValidateComments: Future[Seq[GenericComment]] = {
    db.run(for {
      exploreComments  <- auditTaskCommentTable.getRecentExploreComments(100)
      validateComments <- validationTaskCommentTable.getRecentValidateComments(100)
    } yield {
      (exploreComments ++ validateComments).sortBy(_.timestamp).reverse.take(100)
    })
  }

  /**
   * Assembles the recent-activity stream for the admin Activity page: the latest labels, validations, and comments,
   * interleaved by recency.
   *
   * Each source is queried for its own `n` most-recent rows in parallel, then the union is re-sorted by timestamp and
   * trimmed to `n` so the result is the true `n` most-recent contributions across all three kinds.
   *
   * @param n Number of stream items to return.
   * @return Recent activity items, most recent first.
   */
  def getRecentActivity(n: Int): Future[Seq[RecentActivityItem]] = {
    val labelsFut   = db.run(labelTable.getRecentLabels(n))
    val valsFut     = db.run(labelValidationTable.getRecentValidations(n))
    val commentsFut = getRecentExploreAndValidateComments
    for {
      labels   <- labelsFut
      vals     <- valsFut
      comments <- commentsFut
    } yield {
      val labelItems = labels.map { case (labelId, labelType, username, ts) =>
        RecentActivityItem("label", username, ts, Some(labelId), Some(labelType), None, None)
      }
      val validationItems = vals.map { case (labelId, labelType, username, result, ts) =>
        RecentActivityItem("validation", username, ts, Some(labelId), Some(labelType), Some(result.toString), None)
      }
      val commentItems = comments.map { c =>
        RecentActivityItem("comment", c.username, c.timestamp, c.labelId, None, None, Some(c.comment))
      }
      (labelItems ++ validationItems ++ commentItems).sortBy(_.timestamp).reverse.take(n)
    }
  }

  /**
   * Assembles the Contributors page's two leaderboards: the top `n` labelers (by label count) and top `n` validators
   * (by validations performed), each enriched with the breakdowns that surface behavior patterns.
   *
   * Ranking and the base per-user fields come from the existing admin user-stats; the per-user breakdowns (label-type
   * mix, severity distribution, validation-result split) are then queried only for the ranked users, so those joins
   * stay scoped to ~`n` ids rather than the whole user base.
   *
   * @param n Number of rows per leaderboard.
   * @return The two assembled leaderboards.
   */
  def getContributorLeaderboards(n: Int): Future[ContributorLeaderboards] = {
    getUserStatsForAdminPage.flatMap { stats =>
      val topLabelers   = stats.filter(_.labels > 0).sortBy(-_.labels).take(n)
      val topValidators = stats.filter(_.othersValidated > 0).sortBy(-_.othersValidated).take(n)
      val labelerIds    = topLabelers.map(_.userId)
      val validatorIds  = topValidators.map(_.userId)

      val typeCountsFut = db.run(labelTable.getLabelTypeCountsForUsers(labelerIds))
      val sevCountsFut  = db.run(labelTable.getSeverityCountsForUsers(labelerIds))
      val valCountsFut  = db.run(labelValidationTable.getValidationResultCountsForUsers(validatorIds))

      for {
        typeCounts <- typeCountsFut
        sevCounts  <- sevCountsFut
        valCounts  <- valCountsFut
      } yield {
        // Group each breakdown by user, sorting type counts by frequency (desc) and severities by rating (asc).
        val typesByUser: Map[String, Seq[(String, Int)]] =
          typeCounts.groupBy(_._1).map { case (u, rows) => u -> rows.map(r => (r._2, r._3)).sortBy(-_._2) }
        val sevByUser: Map[String, Seq[(Int, Int)]] =
          sevCounts.collect { case (u, Some(s), c) => (u, s, c) }
            .groupBy(_._1)
            .map { case (u, rows) => u -> rows.map(r => (r._2, r._3)).sortBy(_._1) }
        val resultsByUser: Map[String, Seq[(ValidationOption.Value, Int)]] =
          valCounts.groupBy(_._1).map { case (u, rows) => u -> rows.map(r => (r._2, r._3)) }

        val labelers = topLabelers.map { u =>
          LabelerLeaderboardEntry(
            u.userId, u.username, u.role, u.labels, u.ownValidated, u.ownValidatedAgreedPct, u.highQuality,
            typesByUser.getOrElse(u.userId, Seq.empty), sevByUser.getOrElse(u.userId, Seq.empty)
          )
        }
        val validators = topValidators.map { u =>
          val counts                          = resultsByUser.getOrElse(u.userId, Seq.empty)
          def of(result: ValidationOption.Value) = counts.find(_._1 == result).map(_._2).getOrElse(0)
          ValidatorLeaderboardEntry(u.userId, u.username, u.role, u.othersValidated,
            of(ValidationOption.Agree), of(ValidationOption.Disagree), of(ValidationOption.Unsure),
            u.othersValidatedAgreedPct)
        }
        ContributorLeaderboards(labelers, validators)
      }
    }
  }

  /**
   * Gets metadata for each user that we use on the admin page.
   */
  def getUserStatsForAdminPage: Future[Seq[UserStatsForAdminPage]] = {
    // We run different queries for each bit of metadata that we need. We run each query and convert them to Scala maps
    // with the user_id as the key. We then query for all the users in the `user` table and for each user, we look up
    // the user's metadata in each of the maps from those 6 queries. This simulates a left join across the six
    // sub-queries. We are using Scala Map objects instead of Slick b/c Slick didn't create very efficient queries for
    // this use-case (at least in the old version of Slick that we are no longer using).
    // TODO try to rewrite this to use Slick instead of Scala maps.
    db.run(for {
      // Map(user_id: String -> team: String).
      userTeams: Map[String, String] <- userTeamTable.getUserIdsWithTeamNames.map(_.toMap)
      // Map(user_id: String -> signup_time: Option[Timestamp]).
      signUpTimes: Map[String, Option[OffsetDateTime]] <- webpageActivityTable.getSignUpTimes.map(_.toMap)
      // Map(user_id: String -> (most_recent_sign_in_time: Option[Timestamp], sign_in_count: Int)).
      signInTimesAndCounts: Map[String, (Int, Option[OffsetDateTime])] <- webpageActivityTable.getSignInTimesAndCounts
        .map(_.toMap)
      // Map(user_id: String -> label_count: Int).
      labelCounts: Map[String, Int] <- labelTable.countLabelsByUser.map(_.toMap)
      // Map(user_id: String -> (role: String, total: Int, agreed: Int, disagreed: Int, unsure: Int)).
      validatedCounts: Map[String, (String, Int, Int)] <- labelValidationTable.getValidationCountsByUser.map(_.toMap)
      // Map(user_id: String -> (count: Int, agreed: Int, disagreed: Int)).
      othersValidatedCounts: Map[String, (Int, Int)] <- labelValidationTable.getValidatedCountsPerUser.map(_.toMap)
      // Map(user_id: String -> high_quality: Boolean).
      userHighQuality: Map[String, Boolean] <- userStatTable.getUserQuality.map(_.toMap)
      users: Seq[SidewalkUserWithRole]      <- userStatTable.usersMinusAnonUsersWithNoLabelsAndNoValidations
    } yield {
      // Now left join them all together and put into UserStatsForAdminPage objects.
      users.map { user =>
        val ownValidatedCounts = validatedCounts.getOrElse(user.userId, ("", 0, 0))
        val ownValidatedTotal  = ownValidatedCounts._2
        val ownValidatedAgreed = ownValidatedCounts._3

        val otherValidatedCounts = othersValidatedCounts.getOrElse(user.userId, (0, 0))
        val otherValidatedTotal  = otherValidatedCounts._1
        val otherValidatedAgreed = otherValidatedCounts._2

        val ownValidatedAgreedPct =
          if (ownValidatedTotal == 0) 0d
          else ownValidatedAgreed * 1.0 / ownValidatedTotal

        val otherValidatedAgreedPct =
          if (otherValidatedTotal == 0) 0d
          else otherValidatedAgreed * 1.0 / otherValidatedTotal

        UserStatsForAdminPage(
          userId = user.userId,
          username = user.username,
          email = user.email,
          role = user.role,
          team = userTeams.get(user.userId),
          signUpTime = signUpTimes.get(user.userId).flatten,
          lastSignInTime = signInTimesAndCounts.get(user.userId).flatMap(_._2),
          signInCount = signInTimesAndCounts.get(user.userId).map(_._1).getOrElse(0),
          labels = labelCounts.getOrElse(user.userId, 0),
          ownValidated = ownValidatedTotal,
          ownValidatedAgreedPct = ownValidatedAgreedPct,
          othersValidated = otherValidatedTotal,
          othersValidatedAgreedPct = otherValidatedAgreedPct,
          highQuality = userHighQuality.getOrElse(user.userId, true)
        )
      }
    })
  }

  /**
   * Gets the street distance completion rate by date. This is the cumulative distance of all streets audited.
   */
  def streetDistanceCompletionRateByDate: Future[Seq[(OffsetDateTime, Double)]] = {
    db.run(for {
      distancesByDate: Seq[(OffsetDateTime, Double)] <- streetEdgeTable.streetDistanceCompletionRateByDate
      totalDist: Double                              <- streetService.getTotalStreetDistanceDBIO
    } yield {
      // Get the cumulative distance over time.
      val cumDistsPerDay: Seq[(OffsetDateTime, Double)] =
        distancesByDate.map { var dist = 0.0; pair => { dist += pair._2; (pair._1, dist) } }

      // Calculate the completion percentage for each day.
      cumDistsPerDay.map(pair => (pair._1, (100.0 * pair._2 / totalDist)))
    })
  }

  /**
   * Calls functions to update all columns in user_stat table. Only updates users who have audited since cutoff time.
   * @param cutoffTime Only update users who have done any auditing since this cutoff time
   * @return The number of users whose stats were updated
   */
  def updateUserStatTable(cutoffTime: OffsetDateTime): Future[Int] = {
    db.run(
      for {
        _ad         <- userStatTable.updateAuditedDistance(cutoffTime)
        _lpm        <- userStatTable.updateLabelsPerMeter(cutoffTime)
        _a          <- userStatTable.updateAccuracy(Seq())
        rowsUpdated <- userStatTable.updateHighQuality(cutoffTime)
      } yield rowsUpdated
    )
  }

  /**
   * Returns aggregated usage analytics for the v3 public API from the webpage_activity log.
   *
   * @param excludeApiDocs If true, filters out requests that include `source=apiDocs` in the query string.
   * @param days           Number of past days to include; 0 means all time.
   * @return A tuple of (endpoint counts, daily counts, unique IP count, format counts).
   */
  def getApiAnalytics(
      excludeApiDocs: Boolean,
      days: Int
  ): Future[(Seq[ApiEndpointCount], Seq[ApiDailyCount], Long, Seq[ApiFormatCount])] = {
    db.run(for {
      endpointCounts <- webpageActivityTable.getApiEndpointCounts(excludeApiDocs, days)
      dailyCounts    <- webpageActivityTable.getApiDailyCounts(excludeApiDocs, days)
      uniqueIps      <- webpageActivityTable.getApiUniqueIpCount(excludeApiDocs, days)
      formatCounts   <- webpageActivityTable.getApiFormatCounts(excludeApiDocs, days)
    } yield (endpointCounts, dailyCounts, uniqueIps, formatCounts))
  }

  def getApiAnalyticsBySource(days: Int): Future[ApiAnalyticsBySourceData] = {
    db.run(for {
      endpointCounts <- webpageActivityTable.getApiEndpointCountsBySource(days)
      dailyCounts    <- webpageActivityTable.getApiDailyCountsBySource(days)
      formatCounts   <- webpageActivityTable.getApiFormatCountsBySource(days)
      ipCounts       <- webpageActivityTable.getApiUniqueIpCountsBySource(days)
      totalUniqueIps <- webpageActivityTable.getApiUniqueIpCount(excludeApiDocs = false, days)
      lastApiCall    <- webpageActivityTable.getLastApiCallDate
    } yield ApiAnalyticsBySourceData(endpointCounts, dailyCounts, formatCounts, ipCounts, totalUniqueIps, lastApiCall))
  }
}
