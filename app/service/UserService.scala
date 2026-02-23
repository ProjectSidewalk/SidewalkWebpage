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

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

case class UserProfileData(
    userId: String,
    userTeam: Option[Team],
    allTeams: Seq[Team],
    missionCount: Int,
    auditedDistance: Float,
    labelCount: Int,
    validationCount: Int,
    accuracy: Option[Float]
)
case class AdminUserProfileData(
    currentRegion: Option[Region],
    numCompletedAudits: Int,
    hoursWorked: Float,
    userStats: UserStat,
    completedMissions: Seq[RegionalMission],
    exploreComments: Seq[AuditTaskComment]
)

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getUserProfileData(userId: String, metricSystem: Boolean): Future[UserProfileData]
  def getDistanceAudited(userId: String): Future[Float]
  def countLabelsFromUser(userId: String): Future[Int]
  def getUserAccuracy(userId: String): Future[Option[Float]]

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
  def getHoursAuditingAndValidating(userId: String): Future[Float]
  def getAuditedStreets(userId: String): Future[Seq[StreetEdge]]
  def getLabelLocations(userId: String, regionId: Option[Int] = None): Future[Seq[LabelLocation]]
  def updateTaskFlag(auditTaskId: Int, flag: String, state: Boolean): Future[Int]
  def updateTaskFlagsBeforeDate(userId: String, date: OffsetDateTime, flag: String, state: Boolean): Future[Int]
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
      auditedDistanceMeters: Float <- auditTaskTable.getDistanceAudited(userId)
      labelCount: Int              <- labelTable.countLabelsFromUser(userId)
      valCount: Int                <- labelValidationTable.countValidations(userId)
      accuracy: Option[Float]      <- labelValidationTable.getUserAccuracy(userId)
    } yield {
      val auditedDistance: Float = {
        if (metricSystem) auditedDistanceMeters / 1000f
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

  def getDistanceAudited(userId: String): Future[Float] = db.run(auditTaskTable.getDistanceAudited(userId))

  def countLabelsFromUser(userId: String): Future[Int] = db.run(labelTable.countLabelsFromUser(userId))

  def getUserAccuracy(userId: String): Future[Option[Float]] = db.run(labelValidationTable.getUserAccuracy(userId))

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
      streetDist: Float           <- streetService.getTotalStreetDistanceDBIO
      stats: Seq[LeaderboardStat] <- userStatTable.getLeaderboardStats(n, timePeriod, byTeam, teamId, streetDist)
    } yield stats)
  }

  def getHoursAuditingAndValidating(userId: String): Future[Float] =
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
}
