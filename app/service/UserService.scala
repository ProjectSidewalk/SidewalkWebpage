package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskComment, AuditTaskInteractionTable, AuditTaskTable}
import models.label.{LabelLocation, LabelTable}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.street.StreetEdge
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile
import models.validation.LabelValidationTable
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
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

  /**
   * Computes streak stats and the heatmap grid from a user's per-day activity counts. Pure (no I/O) so it's easy to
   * test and reason about.
   *
   * @param counts Map of active calendar day (US/Pacific) to that day's contribution count.
   * @param today  Today's date in US/Pacific (passed in so the logic is deterministic/testable).
   * @return       Current/longest/total streak plus heatmap cells in column-major order.
   */
  def computeStreakStats(counts: Map[LocalDate, Int], today: LocalDate): StreakStats = {
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
    val fmt                            = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.ENGLISH)
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
        val word = if (c == 1) "contribution" else "contributions"
        Some(StreakCell(intensity, s"$c $word on ${cellDate.format(fmt)}"))
      }
    }

    StreakStats(current, longest, dates.size, cells)
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
  def getUserTeam(userId: String): Future[Option[Team]]
  def setUserTeam(userId: String, newTeamId: Int): Future[Int]
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
  def getActivityStreak(userId: String): Future[StreakStats]
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

  def getActivityStreak(userId: String): Future[StreakStats] = {
    db.run(userStatTable.getActivityDayCounts(userId)).map { rows =>
      val counts = rows.map { case (day, count) => LocalDate.parse(day) -> count }.toMap
      UserService.computeStreakStats(counts, LocalDate.now(ZoneId.of("US/Pacific")))
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
