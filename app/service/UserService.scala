package service

import models.user.{LeaderboardStat, Organization, UserOrgTable, UserStatTable}

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.audit.{AuditTaskInteractionTable, AuditTaskTable}
import models.label.{LabelTable, LabelValidationTable}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.DBIO

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getDistanceAudited(userId: String): Future[Float]
  def countLabelsFromUser(userId: String): Future[Int]
  def getUserAccuracy(userId: String): Future[Option[Float]]
  def getUserTeam(userId: String): Future[Option[Organization]]
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, userIdForTeam: Option[String] = None): Future[Seq[LeaderboardStat]]
  def getHoursAuditingAndValidating(userId: String): Future[Float]
}

@Singleton
class UserServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                userStatTable: UserStatTable,
                                labelTable: LabelTable,
                                labelValidationTable: LabelValidationTable,
                                auditTaskTable: AuditTaskTable,
                                auditTaskInteractionTable: AuditTaskInteractionTable,
                                streetService: StreetService,
                                userOrgTable: UserOrgTable,
                                implicit val ec: ExecutionContext
                               ) extends UserService with HasDatabaseConfigProvider[MyPostgresProfile] {

  def getDistanceAudited(userId: String): Future[Float] = {
    db.run(auditTaskTable.getDistanceAudited(userId))
  }

  def countLabelsFromUser(userId: String): Future[Int] = {
    db.run(labelTable.countLabelsFromUser(userId))
  }

  def getUserAccuracy(userId: String): Future[Option[Float]] = {
    db.run(labelValidationTable.getUserAccuracy(userId))
  }

  def getUserTeam(userId: String): Future[Option[Organization]] = {
    db.run(userOrgTable.getTeam(userId))
  }

  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, userIdForTeam: Option[String] = None): Future[Seq[LeaderboardStat]] = {
    db.run(for {
      // If we are only showing the leaderboard for the user's team, get the teamId.
      teamId: Option[Int] <- userIdForTeam match {
        case Some(userId) => userOrgTable.getOrgId(userId)
        case None => DBIO.successful(None)
      }
      streetDist: Float <- streetService.getTotalStreetDistanceDBIO
      stats: Seq[LeaderboardStat] <- userStatTable.getLeaderboardStats(n, timePeriod, byOrg, teamId, streetDist)
    } yield stats)
  }

  def getHoursAuditingAndValidating(userId: String): Future[Float] = {
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))
  }
}
