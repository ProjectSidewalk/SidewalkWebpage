package service

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskComment, AuditTaskCommentTable, AuditTaskInteractionTable, AuditTaskTable}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.street.StreetEdgeTable
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.DBIO

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

case class StreetCountsData(total: Int, audited: Map[String, Int], auditedHighQualityOnly: Map[String, Int])
case class StreetDistanceData(total: Float, audited: Map[String, Float], auditedHighQualityOnly: Map[String, Float],
                              withOverlap: Map[String, Float])
case class CoverageData(streetCounts: StreetCountsData, streetDistance: StreetDistanceData)

@ImplementedBy(classOf[AdminServiceImpl])
trait AdminService {
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData]
  def getCoverageData: Future[CoverageData]
  def getNumUsersContributed: Future[Seq[UserCount]]
}

@Singleton
class AdminServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                 userStatTable: UserStatTable,
                                 userCurrentRegionTable: UserCurrentRegionTable,
                                 missionTable: MissionTable,
                                 auditTaskTable: AuditTaskTable,
                                 auditTaskInteractionTable: AuditTaskInteractionTable,
                                 auditTaskCommentTable: AuditTaskCommentTable,
                                 streetService: StreetService,
                                 streetEdgeTable: StreetEdgeTable,
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

  def getCoverageData: Future[CoverageData] = {
    val ALL_ROLES = Seq("All", "Registered", "Anonymous", "Turker", "Researcher")
    db.run(for {
      totalStreetCount: Int <- streetService.getStreetCountDBIO
      auditedStreetCount: Int <- streetEdgeTable.countDistinctAuditedStreets()
      auditedStreetCountHQ: Int <- streetEdgeTable.countDistinctAuditedStreets(highQualityOnly = true)
      auditCountByRole: Map[String, Int] <- streetEdgeTable.countDistinctAuditedStreetsByRole()
      auditCountByRoleHQ: Map[String, Int] <- streetEdgeTable.countDistinctAuditedStreetsByRole(highQualityOnly = true)
      totalStreetDist: Float <- streetService.getTotalStreetDistanceDBIO
      auditedDist: Float <- streetEdgeTable.auditedStreetDistance()
      auditedDistHQ: Float <- streetEdgeTable.auditedStreetDistance(highQualityOnly = true)
      auditedDistByRole: Map[String, Float] <- streetEdgeTable.auditedStreetDistanceByRole()
      auditedDistByRoleHQ: Map[String, Float] <- streetEdgeTable.auditedStreetDistanceByRole(highQualityOnly = true)
      auditedDistAllTime: Float <- streetEdgeTable.auditedStreetDistanceOverTime()
      auditedDistPastWeek: Float <- streetEdgeTable.auditedStreetDistanceOverTime("week")
      auditedDistToday: Float <- streetEdgeTable.auditedStreetDistanceOverTime("today")
    } yield {
      // Make sure that each role has a value in all maps, default to 0.
      val fullAuditCountByRole: Map[String, Int] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedStreetCount else auditCountByRole.getOrElse(role, 0))
      }.toMap
      val fullAuditCountByRoleHQ: Map[String, Int] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedStreetCountHQ else auditCountByRoleHQ.getOrElse(role, 0))
      }.toMap
      val fullAuditedDistByRole: Map[String, Float] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedDist else auditedDistByRole.getOrElse(role, 0F))  * METERS_TO_MILES
      }.toMap
      val fullAuditedDistByRoleHQ: Map[String, Float] = ALL_ROLES.map { role =>
        role -> (if (role == "All") auditedDistHQ else auditedDistByRoleHQ.getOrElse(role, 0F))  * METERS_TO_MILES
      }.toMap

      CoverageData(
        StreetCountsData(totalStreetCount, fullAuditCountByRole, fullAuditCountByRoleHQ),
        StreetDistanceData(totalStreetDist * METERS_TO_MILES, fullAuditedDistByRole, fullAuditedDistByRoleHQ,
          Map("all_time" -> auditedDistAllTime * METERS_TO_MILES,
            "week" -> auditedDistPastWeek * METERS_TO_MILES,
            "today" -> auditedDistToday * METERS_TO_MILES
          )
        )
      )
    })
  }

  def getNumUsersContributed: Future[Seq[UserCount]] = {
    db.run(DBIO.sequence(Seq(
      userStatTable.countAllUsersContributed(),
      userStatTable.countAllUsersContributed(taskCompletedOnly = true),
      userStatTable.countAllUsersContributed(highQualityOnly = true),
      userStatTable.countAllUsersContributed(taskCompletedOnly = true, highQualityOnly = true),
      userStatTable.countAllUsersContributed("week"),
      userStatTable.countAllUsersContributed("week", taskCompletedOnly = true),
      userStatTable.countAllUsersContributed("week", highQualityOnly = true),
      userStatTable.countAllUsersContributed("week", taskCompletedOnly = true, highQualityOnly = true),
      userStatTable.countAllUsersContributed("today"),
      userStatTable.countAllUsersContributed("today", taskCompletedOnly = true),
      userStatTable.countAllUsersContributed("today", highQualityOnly = true),
      userStatTable.countAllUsersContributed("today", taskCompletedOnly = true, highQualityOnly = true)
    )))
  }
}
