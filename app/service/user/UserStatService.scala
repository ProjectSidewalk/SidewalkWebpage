package service.user

import models.user.{LeaderboardStat, UserStats}

import scala.concurrent.Future
import javax.inject._
import com.google.inject.ImplementedBy
import models.audit.AuditTaskInteractionTable
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

@ImplementedBy(classOf[UserStatServiceImpl])
trait UserStatService {
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]]
  def getHoursAuditingAndValidating(userId: String): Future[Float]
}

@Singleton
class UserStatServiceImpl @Inject()(
                                     protected val dbConfigProvider: DatabaseConfigProvider,
                                     userStats: UserStats,
                                     auditTaskInteractionTable: AuditTaskInteractionTable
                                   ) extends UserStatService with HasDatabaseConfigProvider[MyPostgresDriver] {

  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]] = {
    userStats.getLeaderboardStats(n, timePeriod, byOrg, orgId)
  }

  def getHoursAuditingAndValidating(userId: String): Future[Float] = {
    db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(userId))
  }
}
