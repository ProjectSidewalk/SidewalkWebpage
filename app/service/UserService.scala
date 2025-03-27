package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskInteractionTable, AuditTaskTable}
import models.label.{LabelLocation, LabelTable}
import models.mission.MissionTable
import models.street.StreetEdge
import models.user._
import models.utils.MyPostgresProfile
import models.validation.LabelValidationTable
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.DBIO

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getDistanceAudited(userId: String): Future[Float]
  def countLabelsFromUser(userId: String): Future[Int]
  def countCompletedMissions(userId: String, includeOnboarding: Boolean, includeSkipped: Boolean): Future[Int]
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

  def getDistanceAudited(userId: String): Future[Float] = {
    db.run(auditTaskTable.getDistanceAudited(userId))
  }

  def countLabelsFromUser(userId: String): Future[Int] = {
    db.run(labelTable.countLabelsFromUser(userId))
  }

  def countCompletedMissions(userId: String, includeOnboarding: Boolean, includeSkipped: Boolean): Future[Int] = {
    db.run(missionTable.countCompletedMissions(userId, includeOnboarding, includeSkipped))
  }

  def getUserAccuracy(userId: String): Future[Option[Float]] = {
    db.run(labelValidationTable.getUserAccuracy(userId))
  }

  def getUserTeam(userId: String): Future[Option[Team]] = {
    db.run(userTeamTable.getTeam(userId))
  }

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

  def getAllTeams: Future[Seq[Team]] = {
    db.run(teamTable.getAllTeams)
  }

  def getAllOpenTeams: Future[Seq[Team]] = {
    db.run(teamTable.getAllOpenTeams)
  }

  def createTeam(name: String, description: String): Future[Int] = {
    db.run(teamTable.insert(name, description))
  }

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

  def getHoursAuditingAndValidating(userId: String): Future[Float] = {
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))
  }

  def getAuditedStreets(userId: String): Future[Seq[StreetEdge]] = {
    db.run(auditTaskTable.getAuditedStreets(userId))
  }

  def getLabelLocations(userId: String, regionId: Option[Int] = None): Future[Seq[LabelLocation]] = {
    db.run(labelTable.getLabelLocations(userId, regionId))
  }
}
