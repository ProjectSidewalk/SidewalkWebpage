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

case class UserProfileData(userId: String, userTeam: Option[Team], allTeams: Seq[Team], missionCount: Int,
                           auditedDistance: Float, labelCount: Int, validationCount: Int, accuracy: Option[Float])
case class AdminUserProfileData(currentRegion: Option[Region], numCompletedAudits: Int, hoursWorked: Float,
                                completedMissions: Seq[RegionalMission], exploreComments: Seq[AuditTaskComment])

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getUserProfileData(userId: String, metricSystem: Boolean): Future[UserProfileData]
  def getDistanceAudited(userId: String): Future[Float]
  def countLabelsFromUser(userId: String): Future[Int]
  def getUserAccuracy(userId: String): Future[Option[Float]]
  def getUserTeam(userId: String): Future[Option[Team]]
  def setUserTeam(userId: String, newTeamId: Int): Future[Int]
  def getAllTeams: Future[Seq[Team]]
  def getAllOpenTeams: Future[Seq[Team]]
  def createTeam(name: String, description: String): Future[Int]
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byTeam: Boolean = false, userIdForTeam: Option[String] = None): Future[Seq[LeaderboardStat]]
  def getHoursAuditingAndValidating(userId: String): Future[Float]
  def getAuditedStreets(userId: String): Future[Seq[StreetEdge]]
  def getLabelLocations(userId: String, regionId: Option[Int] = None): Future[Seq[LabelLocation]]
  def updateTaskFlag(auditTaskId: Int, flag: String, state: Boolean): Future[Int]
  def updateTaskFlagsBeforeDate(userId: String, date: OffsetDateTime, flag: String, state: Boolean): Future[Int]
}

@Singleton
class UserServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
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
                               ) extends UserService with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Gets the data to show on a user's dashboard.
   * @param userId ID of the user whose data we're getting.
   * @param metricSystem Whether to return distance in metric units.
   */
  def getUserProfileData(userId: String, metricSystem: Boolean): Future[UserProfileData] = {
    db.run(for {
      userTeam: Option[Team] <- userTeamTable.getTeam(userId)
      teams: Seq[Team] <- teamTable.getAllTeams
      missionCount: Int <- missionTable.countCompletedMissions(userId, includeOnboarding = true, includeSkipped = false)
      auditedDistanceMeters: Float <- auditTaskTable.getDistanceAudited(userId)
      labelCount: Int <- labelTable.countLabelsFromUser(userId)
      valCount: Int <- labelValidationTable.countValidations(userId)
      accuracy: Option[Float] <- labelValidationTable.getUserAccuracy(userId)
    } yield {
      val auditedDistance: Float = {
        if (metricSystem) auditedDistanceMeters / 1000F
        else auditedDistanceMeters * METERS_TO_MILES
      }
      UserProfileData(userId, userTeam, teams, missionCount, auditedDistance, labelCount, valCount, accuracy)
    })
  }

  def getDistanceAudited(userId: String): Future[Float] = db.run(auditTaskTable.getDistanceAudited(userId))

  def countLabelsFromUser(userId: String): Future[Int] = db.run(labelTable.countLabelsFromUser(userId))

  def getUserAccuracy(userId: String): Future[Option[Float]] = db.run(labelValidationTable.getUserAccuracy(userId))

  def getUserTeam(userId: String): Future[Option[Team]] = db.run(userTeamTable.getTeam(userId))

  def setUserTeam(userId: String, newTeamId: Int): Future[Int] = {
    val updateTeamAction = userTeamTable.getTeam(userId).flatMap {
      case Some(team) if team.teamId != newTeamId =>
        userTeamTable.remove(userId, team.teamId)
          .flatMap(_ => userTeamTable.save(userId, newTeamId))
      case None => userTeamTable.save(userId, newTeamId)
      case _ => DBIO.successful(0)
    }
    db.run(updateTeamAction)
  }

  def getAllTeams: Future[Seq[Team]] = db.run(teamTable.getAllTeams)

  def getAllOpenTeams: Future[Seq[Team]] = db.run(teamTable.getAllOpenTeams)

  def createTeam(name: String, description: String): Future[Int] = db.run(teamTable.insert(name, description))

  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byTeam: Boolean = false, userIdForTeam: Option[String] = None): Future[Seq[LeaderboardStat]] = {
    db.run(for {
      // If we are only showing the leaderboard for the user's team, get the teamId.
      teamId: Option[Int] <- userIdForTeam match {
        case Some(userId) => userTeamTable.getTeam(userId).map(_.map(_.teamId))
        case None => DBIO.successful(None)
      }
      streetDist: Float <- streetService.getTotalStreetDistanceDBIO
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
