package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskComment, AuditTaskInteractionTable, AuditTaskTable}
import models.label.{LabelLocation, LabelTable}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.street.StreetEdge
import models.user._
import models.userdashboard.{Trophy, TrophyTable}
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile
import models.utils.ProfanityGuard
import models.validation.LabelValidationTable
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.Messages
import slick.dbio.DBIO

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, OffsetDateTime, ZoneId}
import java.util.Locale
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

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

case class AdminUserProfileData(
    currentRegion: Option[Region],
    numCompletedAudits: Int,
    hoursWorked: Double,
    userStats: UserStat,
    completedMissions: Seq[RegionalMission],
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

  /** Label types shown in the per-type accuracy bars (the ones with canonical `--color-label-*` colors), in order. */
  private val PrimaryLabelTypes: Seq[String] =
    Seq("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal")

  /**
   * Minimum validated labels of a type before it's eligible to be flagged as the user's "weakest" (avoids flagging a
   * type off one or two validations). Public because the dashboard copy states the rule — source of truth for the UI.
   */
  val MinValidatedForWeakest: Int = 5

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
  def getActivityStreak(userId: String, locale: Locale = Locale.ENGLISH): Future[StreakStats]
  def getAccuracyByType(userId: String): Future[Seq[AccuracyByType]]
  def getTrophies(userId: String, cityName: String, messages: Messages): Future[Seq[Trophy]]
  def getHoursAuditingAndValidating(userId: String): Future[Double]
  def getAuditedStreets(userId: String): Future[Seq[StreetEdge]]
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
    implicit val ec: ExecutionContext
) extends UserService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

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
      val auditedDistance: Double = {
        if (metricSystem) auditedDistanceMeters / 1000d
        else auditedDistanceMeters * METERS_TO_MILES
      }
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
   * Validates and applies a username change (#4373), enforcing the same rules the Settings UI advertises.
   *
   * Rejects (returns `Left(messageKey)`) empty/too-short/too-long names, disallowed characters, profanity, and names
   * already taken by another user. A no-op change to the user's current name is allowed. Usernames are display-only
   * (everything keys on user_id), so no downstream references need updating.
   *
   * @param userId      The user changing their name.
   * @param newUsername The requested new username (leading/trailing whitespace is trimmed).
   * @return `Right(trimmedUsername)` on success, or `Left(i18nKey)` if rejected — the caller localizes the key.
   */
  def changeUsername(userId: String, newUsername: String): Future[Either[String, String]] = {
    val name = newUsername.trim
    if (name.length < 3 || name.length > 30) Future.successful(Left("dashboard.settings.username.error.length"))
    else if (!name.matches("^[A-Za-z0-9_-]+$"))
      Future.successful(Left("dashboard.settings.username.error.charset"))
    else if (!ProfanityGuard.isClean(name))
      Future.successful(Left("dashboard.settings.username.error.allowed"))
    else
      sidewalkUserTable.findByUsername(name).flatMap {
        case Some(existing) if existing.userId != userId =>
          Future.successful(Left("dashboard.settings.username.error.taken"))
        case _ => db.run(sidewalkUserTable.updateUsername(userId, name)).map(_ => Right(name))
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
    val medals          = Map(1 -> "🥇", 2 -> "🥈", 3 -> "🥉")
    val weekOfFmt       = DateTimeFormatter.ofPattern("MMM d, yyyy", messages.lang.toLocale)
    for {
      cityPioneer    <- cityPioneerF
      regionPioneers <- regionPioneersF
      champions      <- championsF
      weekly         <- weeklyF
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
      cityTrophy ++ regionPioneerTrophies ++ championTrophies ++ weeklyTrophies
    }
  }

  def getHoursAuditingAndValidating(userId: String): Future[Double] =
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))

  def getAuditedStreets(userId: String): Future[Seq[StreetEdge]] = db.run(auditTaskTable.getAuditedStreets(userId))

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
