package service

import com.google.inject.ImplementedBy
import models.audit._
import models.label.{LabelAiAssessmentTable, LabelCount, LabelTable, TagCount}
import models.mission.{MissionTable, RegionalMission}
import models.pano.PanoSource.PanoSource
import models.region.Region
import models.street.StreetEdgeTable
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.{
  ApiDailySourceCount,
  ApiEndpointSourceCount,
  ApiFormatSourceCount,
  ApiSourceIpCount,
  FunnelStat,
  FunnelStatTable,
  MyPostgresProfile,
  WebpageActivityTable
}
import models.validation.{LabelValidationTable, ValidationCount, ValidationOption, ValidationTaskCommentTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
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
 * The pano + point-of-view metadata needed to build a preview-image URL for one label (a saved crop or a Street View
 * Static thumbnail). Carried alongside a recent-activity item so the admin Activity feed can show a thumbnail.
 */
case class LabelThumbnailMeta(panoId: String, panoSource: PanoSource, heading: Double, pitch: Double, zoom: Double)

/**
 * A compact "who is this contributor" summary for annotating a recent-activity item: their role plus how much they've
 * contributed overall. Lets the admin Activity feed say a bit about each person, not just the single action shown.
 *
 * @param role        The user's role (e.g. "Registered", "Researcher", "Anonymous").
 * @param labels      Total labels they've placed (same base as the Contributors page, so the numbers agree).
 * @param validations Total validations they've performed.
 */
case class UserSummary(role: String, labels: Int, validations: Int)

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

/**
 * One label-type row of the Humans-vs-AI labeler comparison: for a given author group, how many labels of this type
 * were placed, how many have a validation verdict, and how many were judged correct.
 */
case class HumanAiTypeStat(labelType: String, count: Int, validated: Int, correct: Int)

/**
 * The labeler-lens stats for one author group (human or AI): totals plus the per-type and per-severity breakdowns the
 * page uses to compare what each group labels and how its labels hold up under validation.
 *
 * @param group          "human" or "ai".
 * @param severityCounts Per-severity counts on the canonical 1–3 scale (raw legacy ratings are clamped into it).
 */
case class HumanAiLabelerStats(
    group: String,
    total: Int,
    validated: Int,
    correct: Int,
    typeStats: Seq[HumanAiTypeStat],
    severityCounts: Seq[(Int, Int)]
)

/** The validator-lens stats for one validator group: total validations plus the agree/disagree/unsure verdict mix. */
case class HumanAiValidatorStats(group: String, total: Int, agree: Int, disagree: Int, unsure: Int)

/**
 * The tagger lens: the AI tagger's activity (labels assessed, mean confidence, tag distribution) alongside the human
 * tag distribution as a baseline. There is no per-group split here because humans tag inline while the AI tagger runs
 * as a separate pass — the comparison is AI's tag mix vs humans' tag mix, not two symmetric groups.
 */
case class HumanAiTaggerStats(
    labelsAssessed: Int,
    avgConfidence: Option[Double],
    aiTags: Seq[(String, Int)],
    humanTags: Seq[(String, Int)]
)

/**
 * Everything the Humans-vs-AI dashboard page needs, assembled in one payload. `labelers` and `validators` each hold
 * the human group then the AI group (the AI group is present but all-zero on deployments without AI activity).
 */
case class HumanVsAiStats(
    labelers: Seq[HumanAiLabelerStats],
    validators: Seq[HumanAiValidatorStats],
    tagger: HumanAiTaggerStats
)

/**
 * One headline number per dashboard lens, assembled for the Overview landing page so it can render a scannable set of
 * cards that route into the detailed pages without re-fetching each page's full payload. Every KPI carries the
 * denominator the card needs (e.g. audited *and* total distance, AI *and* human counts) so percentages can show their N.
 *
 * @param totalDistanceMi    Total street distance (miles), matching the legacy admin coverage metric.
 * @param auditedDistanceMi  Audited street distance (miles); the card's coverage % is this over the total.
 * @param totalLabels        All labels placed (includes tutorial labels, matching the by-type admin count).
 * @param labelsPastWeek     Labels placed in the last 7 days — the Activity pulse.
 * @param contributors       Distinct users who have contributed any labels or validations.
 * @param aiLabels           Labels placed by the AI labeler (human + ai sum to the labeler total).
 * @param aiValidations      Validations performed by the AI validator.
 * @param aiAssessments      Labels assessed by the AI tagger (0 where `label_ai_assessment` is absent/empty).
 * @param apiCallsExternal   External (non-docs) v3 API calls in the trailing `apiWindowDays`.
 * @param lastActivity       The single most recent contribution across labels/validations/comments, if any.
 */
case class OverviewSummary(
    totalStreets: Int,
    auditedStreets: Int,
    totalDistanceMi: Double,
    auditedDistanceMi: Double,
    totalLabels: Int,
    totalValidations: Int,
    labelsPastWeek: Int,
    validationsPastWeek: Int,
    auditsPastWeek: Int,
    contributors: Int,
    humanLabels: Int,
    aiLabels: Int,
    humanValidations: Int,
    aiValidations: Int,
    aiAssessments: Int,
    apiCallsExternal: Long,
    apiUniqueClients: Long,
    apiWindowDays: Int,
    labelsAwaitingValidation: Int,
    lowQualityUsers: Int,
    lastActivity: Option[RecentActivityItem]
)

/** The batched-query portion of the Overview snapshot, before the reused AI/recent-activity reads are folded in. */
private case class OverviewCore(
    totalStreets: Int,
    auditedStreets: Int,
    totalDistanceMi: Double,
    auditedDistanceMi: Double,
    totalLabels: Int,
    totalValidations: Int,
    labelsPastWeek: Int,
    validationsPastWeek: Int,
    auditsPastWeek: Int,
    contributors: Int,
    apiCallsExternal: Long,
    apiUniqueClients: Long,
    labelsAwaitingValidation: Int,
    lowQualityUsers: Int
)

@ImplementedBy(classOf[AdminServiceImpl])
trait AdminService {
  def updateTeamVisibility(teamId: Int, visible: Boolean): Future[Int]
  def updateTeamStatus(teamId: Int, open: Boolean): Future[Int]
  def getAuditCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getLabelCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getValidationCountsByDate: Future[Seq[(OffsetDateTime, Int)]]
  def getActivityByDay: Future[Seq[ActivityDayRecord]]
  def getTagCounts: Future[Seq[TagCount]]
  def getTagSeverityCounts: Future[Seq[TagSeverityCount]]
  def getAuditedStreetsWithTimestamps: Future[Seq[AuditedStreetWithTimestamp]]
  def findAuditTask(taskId: Int): Future[Option[AuditTask]]
  def getAuditInteractionsWithLabels(auditTaskId: Int): Future[Seq[InteractionWithLabel]]
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData]
  def getContributionTimeStats: Future[Seq[ContributionTimeStat]]
  def getRecentExploreAndValidateComments: Future[Seq[GenericComment]]
  def getRecentActivity(n: Int): Future[Seq[RecentActivityItem]]
  def getLabelThumbnailMeta(labelIds: Seq[Int]): Future[Map[Int, LabelThumbnailMeta]]
  def getUserSummaries(usernames: Seq[String]): Future[Map[String, UserSummary]]
  def getContributorLeaderboards(n: Int): Future[ContributorLeaderboards]
  def getHumanVsAiStats: Future[HumanVsAiStats]
  def getOverviewSummary: Future[OverviewSummary]
  def getUserStatsForAdminPage: Future[Seq[UserStatsForAdminPage]]
  def updateUserStatTable(cutoffTime: OffsetDateTime): Future[Int]

  /**
   * Recomputes this deployment's engagement funnels (#288) for all three windows and replaces the local `funnel_stat`.
   *
   * Each deployment precomputes only its own city's funnels; the cross-city Across Cities page reads every schema's
   * `funnel_stat`. Runs nightly via `FunnelStatActor` and on demand via `/adminapi/updateFunnelStats`.
   *
   * @return The number of rows written to `funnel_stat`.
   */
  def updateFunnelStatTable(): Future[Int]
  def getApiAnalyticsBySource(days: Int): Future[ApiAnalyticsBySourceData]
}

@Singleton
class AdminServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    userStatTable: UserStatTable,
    sidewalkUserTable: SidewalkUserTable,
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
    labelAiAssessmentTable: LabelAiAssessmentTable,
    userTeamTable: UserTeamTable,
    webpageActivityTable: WebpageActivityTable,
    teamTable: TeamTable,
    funnelStatTable: FunnelStatTable,
    configService: ConfigService,
    implicit val ec: ExecutionContext
) extends AdminService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  // Trailing window for the Overview page's API-usage KPI; matches the API Analytics page's default range.
  private val OverviewApiWindowDays: Int = 30

  def updateTeamVisibility(teamId: Int, visible: Boolean): Future[Int] =
    db.run(teamTable.updateVisibility(teamId, visible))
  def updateTeamStatus(teamId: Int, open: Boolean): Future[Int]     = db.run(teamTable.updateStatus(teamId, open))
  def getAuditCountsByDate: Future[Seq[(OffsetDateTime, Int)]]      = db.run(auditTaskTable.getAuditCountsByDate)
  def getLabelCountsByDate: Future[Seq[(OffsetDateTime, Int)]]      = db.run(labelTable.getLabelCountsByDate)
  def getValidationCountsByDate: Future[Seq[(OffsetDateTime, Int)]] = db.run(labelValidationTable.getValidationsByDate)

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

      val labelMap      = toDayMap(labels)
      val validationMap = toDayMap(validations)
      val auditMap      = toDayMap(audits)
      val missionMap    = toDayMap(missions)
      val newUserMap    = toDayMap(newUsers)
      val signinRegMap  = splitMap(signins, anon = false)
      val signinAnonMap = splitMap(signins, anon = true)
      val activeRegMap  = splitMap(active, anon = false)
      val activeAnonMap = splitMap(active, anon = true)

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

  def getTagCounts: Future[Seq[TagCount]] = db.run(labelTable.getTagCounts)

  /**
   * Tag-severity counts for the Data Quality heatmap, with severity bucketed to the canonical 1–3 scale (legacy
   * out-of-range ratings are clamped into the nearest bucket and re-summed).
   */
  def getTagSeverityCounts: Future[Seq[TagSeverityCount]] = {
    db.run(labelTable.getTagSeverityCounts).map { rows =>
      rows
        .collect { case (labelType, tag, Some(sev), count) => (labelType, tag, math.min(3, math.max(1, sev)), count) }
        .groupBy { case (labelType, tag, severity, _) => (labelType, tag, severity) }
        .map { case ((labelType, tag, severity), group) =>
          TagSeverityCount(labelType, tag, severity, group.map(_._4).sum)
        }
        .toSeq
    }
  }
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
      currRegion: Option[Region]      <- userCurrentRegionTable.getCurrentRegion(userId)
      completedAudits: Int            <- auditTaskTable.countCompletedAuditsForUser(userId)
      hoursWorked: Double             <- auditTaskInteractionTable.getHoursAuditingAndValidating(userId)
      existingStats: Option[UserStat] <- userStatTable.getStatsFromUserId(userId)
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
   * Fetches the pano/POV metadata for a batch of labels, keyed by label id, so the caller can build a preview-image
   * URL for each. Returns an empty map for an empty input (no query run).
   *
   * @param labelIds Label ids to fetch metadata for (typically a recent-activity batch).
   * @return Map of label id to its thumbnail metadata; ids without point/pano rows are simply absent.
   */
  def getLabelThumbnailMeta(labelIds: Seq[Int]): Future[Map[Int, LabelThumbnailMeta]] = {
    if (labelIds.isEmpty) Future.successful(Map.empty)
    else
      db.run(labelTable.getPanoMetadataForLabels(labelIds)).map { rows =>
        rows.map { case (id, panoId, source, heading, pitch, zoom) =>
          id -> LabelThumbnailMeta(panoId, source, heading, pitch, zoom)
        }.toMap
      }
  }

  /**
   * Fetches a compact contribution summary (role, total labels, total validations) for a batch of users, keyed by
   * username, so a list can annotate who each person is. Resolves the usernames to ids/roles, then counts labels and
   * validations only for those ids. Returns an empty map for empty input (no query run).
   *
   * @param usernames Usernames to summarize (typically a recent-activity batch; duplicates are fine).
   * @return Map of username to its summary; usernames that don't resolve to a user are absent.
   */
  def getUserSummaries(usernames: Seq[String]): Future[Map[String, UserSummary]] = {
    val distinct = usernames.distinct
    if (distinct.isEmpty) Future.successful(Map.empty)
    else
      db.run(sidewalkUserTable.getUserIdAndRoleByUsernames(distinct)).flatMap { idRoles =>
        val userIds = idRoles.map(_._2)
        db.run(
          labelTable.countLabelsForUsers(userIds) zip labelValidationTable.getValidationResultCountsForUsers(userIds)
        ).map { case (labelCounts, valCounts) =>
          val labelByUser: Map[String, Int] = labelCounts.toMap
          // getValidationResultCountsForUsers is split by verdict; sum the verdicts for each user's validation total.
          val valByUser: Map[String, Int] =
            valCounts.groupBy(_._1).map { case (userId, rows) => userId -> rows.map(_._3).sum }
          idRoles.map { case (username, userId, role) =>
            username -> UserSummary(role, labelByUser.getOrElse(userId, 0), valByUser.getOrElse(userId, 0))
          }.toMap
        }
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
          sevCounts
            .collect { case (u, Some(s), c) => (u, s, c) }
            .groupBy(_._1)
            .map { case (u, rows) => u -> rows.map(r => (r._2, r._3)).sortBy(_._1) }
        val resultsByUser: Map[String, Seq[(ValidationOption.Value, Int)]] =
          valCounts.groupBy(_._1).map { case (u, rows) => u -> rows.map(r => (r._2, r._3)) }

        val labelers = topLabelers.map { u =>
          LabelerLeaderboardEntry(
            u.userId,
            u.username,
            u.role,
            u.labels,
            u.ownValidated,
            u.ownValidatedAgreedPct,
            u.highQuality,
            typesByUser.getOrElse(u.userId, Seq.empty),
            sevByUser.getOrElse(u.userId, Seq.empty)
          )
        }
        val validators = topValidators.map { u =>
          val counts                             = resultsByUser.getOrElse(u.userId, Seq.empty)
          def of(result: ValidationOption.Value) = counts.find(_._1 == result).map(_._2).getOrElse(0)
          ValidatorLeaderboardEntry(u.userId, u.username, u.role, u.othersValidated, of(ValidationOption.Agree),
            of(ValidationOption.Disagree), of(ValidationOption.Unsure), u.othersValidatedAgreedPct)
        }
        ContributorLeaderboards(labelers, validators)
      }
    }
  }

  /**
   * Assembles the Humans-vs-AI page's comparison across all three AI roles, in one payload: AI vs human as a labeler
   * (volume, type mix, severity, and acceptance rate when validated), as a validator (verdict mix), and as a tagger
   * (tag distribution + confidence vs the human tag baseline).
   *
   * The AI group is always present even when a deployment has no AI activity (it comes back all-zero), so the page can
   * render a consistent shape and show per-lens empty states. The tagger queries hit `label_ai_assessment`, which may
   * be absent in older schemas, so they degrade to empty rather than failing the whole call.
   *
   * @return The assembled comparison.
   */
  def getHumanVsAiStats: Future[HumanVsAiStats] = {
    val labelStatsFut    = db.run(labelTable.getLabelStatsByAuthorRole)
    val sevFut           = db.run(labelTable.getSeverityCountsByAuthorRole)
    val valFut           = db.run(labelValidationTable.getValidationCountsByValidatorRole)
    val humanTagsFut     = db.run(labelTable.getHumanTagCounts)
    val taggerSummaryFut =
      db.run(labelAiAssessmentTable.getAssessmentSummary).recover { case _ => (0, Option.empty[Double]) }
    val aiTagsFut = db.run(labelAiAssessmentTable.getAiTagCounts).recover { case _ => Seq.empty[(String, Int)] }

    for {
      labelStats    <- labelStatsFut
      sev           <- sevFut
      vals          <- valFut
      humanTags     <- humanTagsFut
      taggerSummary <- taggerSummaryFut
      aiTags        <- aiTagsFut
    } yield {
      // Clamp a raw rating into the canonical 1–3 severity scale; legacy dumps carry 1–5 values (#3306).
      def clampSeverity(s: Int): Int = math.max(1, math.min(3, s))

      def labelerGroup(isAi: Boolean, name: String): HumanAiLabelerStats = {
        val types = labelStats
          .collect {
            case (g, lt, total, validated, correct) if g == isAi => HumanAiTypeStat(lt, total, validated, correct)
          }
          .sortBy(-_.count)
        val severityCounts: Seq[(Int, Int)] = sev
          .collect { case (g, Some(s), c) if g == isAi => (clampSeverity(s), c) }
          .groupBy(_._1)
          .map { case (rating, rows) => (rating, rows.map(_._2).sum) }
          .toSeq
          .sortBy(_._1)
        HumanAiLabelerStats(
          name,
          types.map(_.count).sum,
          types.map(_.validated).sum,
          types.map(_.correct).sum,
          types,
          severityCounts
        )
      }

      def validatorGroup(isAi: Boolean, name: String): HumanAiValidatorStats = {
        def of(result: ValidationOption.Value): Int = vals.collect {
          case (g, r, c) if g == isAi && r == result => c
        }.sum
        val agree    = of(ValidationOption.Agree)
        val disagree = of(ValidationOption.Disagree)
        val unsure   = of(ValidationOption.Unsure)
        HumanAiValidatorStats(name, agree + disagree + unsure, agree, disagree, unsure)
      }

      val tagger = HumanAiTaggerStats(taggerSummary._1, taggerSummary._2, aiTags.sortBy(-_._2), humanTags.sortBy(-_._2))

      HumanVsAiStats(
        labelers = Seq(labelerGroup(isAi = false, "human"), labelerGroup(isAi = true, "ai")),
        validators = Seq(validatorGroup(isAi = false, "human"), validatorGroup(isAi = true, "ai")),
        tagger = tagger
      )
    }
  }

  /**
   * Assembles the Overview landing page's snapshot: one headline KPI cluster per dashboard lens, in a single light
   * payload. Deliberately reuses cheap existing aggregate queries rather than each page's full endpoint, so the landing
   * page loads fast and never duplicates a page's detailed viz. The AI share (Humans-vs-AI lens) reuses
   * `getHumanVsAiStats`, and the freshest single contribution reuses `getRecentActivity(1)`; the remaining counts run as
   * one batched DB action. All three kick off together and are combined when they complete.
   *
   * @return The assembled snapshot.
   */
  def getOverviewSummary: Future[OverviewSummary] = {
    // Kick the three independent reads off together so they run concurrently rather than in series.
    val hvaFut    = getHumanVsAiStats
    val recentFut = getRecentActivity(1)
    val coreFut   = db.run(for {
      totalStreets   <- streetService.getStreetCountDBIO
      auditedStreets <- streetEdgeTable.countDistinctAuditedStreets()
      totalDist      <- streetService.getTotalStreetDistanceDBIO
      auditedDist    <- streetEdgeTable.auditedStreetDistance()
      labelsAll      <- labelTable.countLabelsByType()
      labelsWeek     <- labelTable.countLabelsByType(TimeInterval.Week)
      valsAll        <- labelValidationTable.countValidationsByResultAndLabelType()
      valsWeek       <- labelValidationTable.countValidationsByResultAndLabelType(TimeInterval.Week)
      contributors   <- userStatTable.countAllUsersContributed()
      auditsWeek     <- auditTaskTable.countCompletedAudits(TimeInterval.Week)
      apiExternal    <- webpageActivityTable.getApiEndpointCounts(excludeApiDocs = true, OverviewApiWindowDays)
      apiClients     <- webpageActivityTable.getApiUniqueIpCount(excludeApiDocs = true, OverviewApiWindowDays)
      awaitingVal    <- labelTable.countLabelsAwaitingValidation
      lowQualityUsrs <- userStatTable.countLowQualityUsers
    } yield {
      // The by-type counts carry an "All" subtotal row; the validation counts carry a grand-total row keyed by the
      // "All"/None/"Both" subgroup. Pull those rather than re-summing so the totals match the detailed pages exactly.
      def labelTotal(counts: Seq[LabelCount]): Int    = counts.find(_.labelType == "All").map(_.count).getOrElse(0)
      def valTotal(counts: Seq[ValidationCount]): Int = counts
        .find(c => c.labelType == "All" && c.validationResult.isEmpty && c.validatorType == "Both")
        .map(_.count)
        .getOrElse(0)
      OverviewCore(
        totalStreets,
        auditedStreets,
        totalDist * METERS_TO_MILES,
        auditedDist * METERS_TO_MILES,
        labelTotal(labelsAll),
        valTotal(valsAll),
        labelTotal(labelsWeek),
        valTotal(valsWeek),
        auditsWeek,
        contributors.count,
        apiExternal.map(_.count).sum,
        apiClients,
        awaitingVal,
        lowQualityUsrs
      )
    })

    for {
      core   <- coreFut
      hva    <- hvaFut
      recent <- recentFut
    } yield {
      def labeler(group: String): Int   = hva.labelers.find(_.group == group).map(_.total).getOrElse(0)
      def validator(group: String): Int = hva.validators.find(_.group == group).map(_.total).getOrElse(0)
      OverviewSummary(
        totalStreets = core.totalStreets, auditedStreets = core.auditedStreets, totalDistanceMi = core.totalDistanceMi,
        auditedDistanceMi = core.auditedDistanceMi, totalLabels = core.totalLabels,
        totalValidations = core.totalValidations, labelsPastWeek = core.labelsPastWeek,
        validationsPastWeek = core.validationsPastWeek, auditsPastWeek = core.auditsPastWeek,
        contributors = core.contributors, humanLabels = labeler("human"), aiLabels = labeler("ai"),
        humanValidations = validator("human"), aiValidations = validator("ai"),
        aiAssessments = hva.tagger.labelsAssessed, apiCallsExternal = core.apiCallsExternal,
        apiUniqueClients = core.apiUniqueClients, apiWindowDays = OverviewApiWindowDays,
        labelsAwaitingValidation = core.labelsAwaitingValidation, lowQualityUsers = core.lowQualityUsers,
        lastActivity = recent.headOption
      )
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
      // Map(user_id: String -> (high_quality: Boolean, high_quality_manual: Option[Boolean])).
      userHighQuality: Map[String, (Boolean, Option[Boolean])] <- userStatTable.getUserQuality
        .map(_.map(t => t._1 -> (t._2, t._3)).toMap)
      users: Seq[SidewalkUserWithRole] <- userStatTable.usersMinusAnonUsersWithNoLabelsAndNoValidations
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
          highQuality = userHighQuality.get(user.userId).map(_._1).getOrElse(true),
          highQualityManual = userHighQuality.get(user.userId).flatMap(_._2)
        )
      }
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

  // The three funnel windows the page offers, as (stored key, trailing days); None days = all-time. Kept here next to
  // the recompute so the precomputed set and the read path (ConfigService.getCityFunnels) agree on the window keys.
  private val funnelWindows: Seq[(String, Option[Int])] = Seq("30d" -> Some(30), "90d" -> Some(90), "all" -> None)

  def updateFunnelStatTable(): Future[Int] = {
    val schema     = configService.getCitySchema(configService.getCityId)
    val computedAt = OffsetDateTime.now()
    // For each window, compute both the mapping and contribution funnels, tagging each row with its funnel type.
    val perWindow: Seq[DBIO[Seq[FunnelStat]]] = funnelWindows.map { case (windowKey, windowDays) =>
      for {
        mapping <- funnelStatTable.computeMappingFunnelBySchema(schema, windowDays)
        contrib <- funnelStatTable.computeContributionFunnelBySchema(schema, windowDays)
      } yield {
        mapping.map(seg => FunnelStat("mapping", windowKey, seg.segment, seg.steps, computedAt)) ++
          contrib.map(seg => FunnelStat("contribution", windowKey, seg.segment, seg.steps, computedAt))
      }
    }
    // Compute all windows, then atomically replace the table. replaceAll is itself transactional, so the reads plus the
    // wholesale swap are all the consistency this precompute needs. Then drop the cached funnel reads so the fresh rows
    // show on the next page load rather than after the 10-minute TTL.
    db.run(DBIO.sequence(perWindow).flatMap(rows => funnelStatTable.replaceAll(rows.flatten)))
      .flatMap(rowsWritten => configService.invalidateFunnelCaches().map(_ => rowsWritten))
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
