package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskComment, AuditTaskCommentTable, AuditTaskInteractionTable, AuditTaskTable}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.user._
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[AdminServiceImpl])
trait AdminService {
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData]
}

@Singleton
class AdminServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                 userCurrentRegionTable: UserCurrentRegionTable,
                                 missionTable: MissionTable,
                                 auditTaskTable: AuditTaskTable,
                                 auditTaskInteractionTable: AuditTaskInteractionTable,
                                 auditTaskCommentTable: AuditTaskCommentTable,
                                 implicit val ec: ExecutionContext
                                ) extends AdminService with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Gets the additional data to show on the admin view of a user's dashboard.
   * @param userId ID of the user whose data we're getting.
   */
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData] = {
    db.run(for {
      currRegion: Option[Region] <- userCurrentRegionTable.getCurrentRegion(userId)
      completedAudits: Int <- auditTaskTable.countCompletedAudits(userId)
      hoursWorked: Float <- auditTaskInteractionTable.getHoursAuditingAndValidating(userId)
      completedMissions: Seq[RegionalMission] <- missionTable.selectCompletedRegionalMission(userId)
      comments: Seq[AuditTaskComment] <- auditTaskCommentTable.all(userId)
    } yield {
      AdminUserProfileData(currRegion, completedAudits, hoursWorked, completedMissions, comments)
    })
  }
}
