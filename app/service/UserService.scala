package service

import models.user.{LeaderboardStat, UserStatTable}

import scala.concurrent.Future
import javax.inject._
import com.google.inject.ImplementedBy
import models.audit.{AuditTaskInteractionTable, AuditTaskTable}
import models.label.{LabelTable, LabelValidationTable}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

@ImplementedBy(classOf[UserServiceImpl])
trait UserService {
  def getDistanceAudited(userId: String): Future[Float]
  def countLabelsFromUser(userId: String): Future[Int]
  def getUserAccuracy(userId: String): Future[Option[Float]]
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]]
  def getHoursAuditingAndValidating(userId: String): Future[Float]
}

@Singleton
class UserServiceImpl @Inject()(
                                 protected val dbConfigProvider: DatabaseConfigProvider,
                                 userStatTable: UserStatTable,
                                 labelTable: LabelTable,
                                 labelValidationTable: LabelValidationTable,
                                 auditTaskTable: AuditTaskTable,
                                 auditTaskInteractionTable: AuditTaskInteractionTable
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

  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]] = {
    userStatTable.getLeaderboardStats(n, timePeriod, byOrg, orgId)
  }

  def getHoursAuditingAndValidating(userId: String): Future[Float] = {
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))
  }
}
