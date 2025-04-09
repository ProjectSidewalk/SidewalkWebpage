package service

import com.google.inject.ImplementedBy
import models.audit._
import models.label.{LabelCount, LabelTable}
import models.mission.{MissionTable, RegionalMission}
import models.region.Region
import models.street.StreetEdgeTable
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile
import models.validation.{LabelValidationTable, ValidationCount, ValidationTaskCommentTable}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval.TimeInterval
import slick.dbio.DBIO

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

object TimeInterval extends Enumeration {
  type TimeInterval = Value
  val AllTime = Value("all_time")
  val Week = Value("week")
  val Today = Value("today")
}

case class StreetCountsData(total: Int, audited: Map[String, Int], auditedHighQualityOnly: Map[String, Int],
                            withOverlap: Map[TimeInterval, Float])
case class StreetDistanceData(total: Float, audited: Map[String, Float], auditedHighQualityOnly: Map[String, Float],
                              withOverlap: Map[TimeInterval, Float])
case class CoverageData(streetCounts: StreetCountsData, streetDistance: StreetDistanceData)

@ImplementedBy(classOf[AdminServiceImpl])
trait AdminService {
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData]
  def getCoverageData: Future[CoverageData]
  def getNumUsersContributed: Future[Seq[UserCount]]
  def getContributionTimeStats: Future[Seq[ContributionTimeStat]]
  def getLabelCountStats: Future[Seq[LabelCount]]
  def getValidationCountStats: Future[Seq[ValidationCount]]
  def getRecentExploreAndValidateComments: Future[Seq[GenericComment]]
}

@Singleton
class AdminServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                 userStatTable: UserStatTable,
                                 userCurrentRegionTable: UserCurrentRegionTable,
                                 missionTable: MissionTable,
                                 auditTaskTable: AuditTaskTable,
                                 auditTaskInteractionTable: AuditTaskInteractionTable,
                                 auditTaskCommentTable: AuditTaskCommentTable,
                                 validationTaskCommentTable: ValidationTaskCommentTable,
                                 streetService: StreetService,
                                 streetEdgeTable: StreetEdgeTable,
                                 labelTable: LabelTable,
                                 labelValidationTable: LabelValidationTable,
                                 implicit val ec: ExecutionContext
                                ) extends AdminService with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Gets the additional data to show on the admin view of a user's dashboard.
   * @param userId ID of the user whose data we're getting.
   */
  def getAdminUserProfileData(userId: String): Future[AdminUserProfileData] = {
    db.run(for {
      currRegion: Option[Region] <- userCurrentRegionTable.getCurrentRegion(userId)
      completedAudits: Int <- auditTaskTable.countCompletedAuditsForUser(userId)
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
      auditCountAllTime: Int <- auditTaskTable.countCompletedAudits()
      auditCountPastWeek: Int <- auditTaskTable.countCompletedAudits(TimeInterval.Week)
      auditCountToday: Int <- auditTaskTable.countCompletedAudits(TimeInterval.Today)
      totalStreetDist: Float <- streetService.getTotalStreetDistanceDBIO
      auditedDist: Float <- streetEdgeTable.auditedStreetDistance()
      auditedDistHQ: Float <- streetEdgeTable.auditedStreetDistance(highQualityOnly = true)
      auditedDistByRole: Map[String, Float] <- streetEdgeTable.auditedStreetDistanceByRole()
      auditedDistByRoleHQ: Map[String, Float] <- streetEdgeTable.auditedStreetDistanceByRole(highQualityOnly = true)
      auditedDistAllTime: Float <- streetEdgeTable.auditedStreetDistanceOverTime()
      auditedDistPastWeek: Float <- streetEdgeTable.auditedStreetDistanceOverTime(TimeInterval.Week)
      auditedDistToday: Float <- streetEdgeTable.auditedStreetDistanceOverTime(TimeInterval.Today)
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
        StreetCountsData(totalStreetCount, fullAuditCountByRole, fullAuditCountByRoleHQ,
          Map(TimeInterval.AllTime -> auditCountAllTime,
            TimeInterval.Week -> auditCountPastWeek,
            TimeInterval.Today -> auditCountToday
          )
        ),
        StreetDistanceData(totalStreetDist * METERS_TO_MILES, fullAuditedDistByRole, fullAuditedDistByRoleHQ,
          Map(TimeInterval.AllTime -> auditedDistAllTime * METERS_TO_MILES,
            TimeInterval.Week -> auditedDistPastWeek * METERS_TO_MILES,
            TimeInterval.Today -> auditedDistToday * METERS_TO_MILES
          )
        )
      )
    })
  }

  /**
   * Gets the number of users who contributed data to Project Sidewalk under various groupings/filters for Admin page.
   */
  def getNumUsersContributed: Future[Seq[UserCount]] = {
    // Start by querying all the data we need from the db in parallel.
    db.run(DBIO.sequence(Seq(
      userStatTable.countAllUsersContributed().map(Seq(_)),
      userStatTable.countAllUsersContributed(taskCompletedOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(highQualityOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(taskCompletedOnly = true, highQualityOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Week).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Week, taskCompletedOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Week, highQualityOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Today).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Today, taskCompletedOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Today, highQualityOnly = true).map(Seq(_)),
      userStatTable.countAllUsersContributed(TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = true).map(Seq(_)),
      userStatTable.countExploreUsersContributed(),
      userStatTable.countExploreUsersContributed(taskCompletedOnly = true),
      userStatTable.countExploreUsersContributed(TimeInterval.Week),
      userStatTable.countExploreUsersContributed(TimeInterval.Week, taskCompletedOnly = true),
      userStatTable.countExploreUsersContributed(TimeInterval.Today),
      userStatTable.countExploreUsersContributed(TimeInterval.Today, taskCompletedOnly = true),
      userStatTable.countValidateUsersContributed(),
      userStatTable.countValidateUsersContributed(labelValidated = true),
      userStatTable.countValidateUsersContributed(TimeInterval.Week),
      userStatTable.countValidateUsersContributed(TimeInterval.Week, labelValidated = true),
      userStatTable.countValidateUsersContributed(TimeInterval.Today),
      userStatTable.countValidateUsersContributed(TimeInterval.Today, labelValidated = true)
    )).map(_.flatten)).map { userCounts: Seq[UserCount] =>
      // For separated Explore and Validate users, sum all roles to create entries for "all".
      val exploreCounts = userCounts.filter(uc => uc.toolUsed == "explore")
      val validateCounts = userCounts.filter(uc => uc.toolUsed == "validate")
      userCounts ++ Seq(
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.AllTime, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.AllTime, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Today && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Today, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Today && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Week && !uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Week, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(exploreCounts.filter(uc => uc.timeInterval == TimeInterval.Week && uc.taskCompletedOnly).map(_.count).sum,
          "explore", "all", TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.AllTime, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.AllTime && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.AllTime, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Today && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Today, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Today && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Today, taskCompletedOnly = true, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Week && !uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Week, taskCompletedOnly = false, highQualityOnly = false),
        UserCount(validateCounts.filter(uc => uc.timeInterval == TimeInterval.Week && uc.taskCompletedOnly).map(_.count).sum,
          "validate", "all", TimeInterval.Week, taskCompletedOnly = true, highQualityOnly = false)
      )
    }
  }

  /**
   * Gets the total/average contribution time across of Project Sidewalk users for the Admin page.
   */
  def getContributionTimeStats: Future[Seq[ContributionTimeStat]] = {
    // Query all the data we need from the db in parallel.
    db.run(DBIO.sequence(Seq(
      auditTaskInteractionTable.calculateTimeExploring(),
      auditTaskInteractionTable.calculateTimeExploring(TimeInterval.Week),
      auditTaskInteractionTable.calculateTimeExploring(TimeInterval.Today),
      auditTaskInteractionTable.calculateTimeValidating(),
      auditTaskInteractionTable.calculateTimeValidating(TimeInterval.Week),
      auditTaskInteractionTable.calculateTimeValidating(TimeInterval.Today),
      auditTaskInteractionTable.calculateMedianExploringTime(),
      auditTaskInteractionTable.calculateMedianExploringTime(TimeInterval.Week),
      auditTaskInteractionTable.calculateMedianExploringTime(TimeInterval.Today)
    )))
  }

  /**
   * Gets the number of labels added in Project Sidewalk grouped by label type and time interval for Admin page.
   */
  def getLabelCountStats: Future[Seq[LabelCount]] = {
    // Query all the data we need from the db in parallel.
    db.run(DBIO.sequence(Seq(
      labelTable.countLabelsByType(),
      labelTable.countLabelsByType(TimeInterval.Week),
      labelTable.countLabelsByType(TimeInterval.Today)
    ))).map(_.flatten)
  }

  /**
   * Gets the number of Project Sidewalk validations grouped by label type, result, and time interval for Admin page.
   */
  def getValidationCountStats: Future[Seq[ValidationCount]] = {
    // Query all the data we need from the db in parallel.
    db.run(DBIO.sequence(Seq(
      labelValidationTable.countValidationsByResultAndLabelType(),
      labelValidationTable.countValidationsByResultAndLabelType(TimeInterval.Week),
      labelValidationTable.countValidationsByResultAndLabelType(TimeInterval.Today)
    ))).map(_.flatten)
  }


  /**
   * Gets the 100 most recent comments made through either the Explore or (any) Validate page.
   */
  def getRecentExploreAndValidateComments: Future[Seq[GenericComment]] = {
    db.run(for {
      exploreComments <- auditTaskCommentTable.getRecentExploreComments(100)
      validateComments <- validationTaskCommentTable.getRecentValidateComments(100)
    } yield {
      (exploreComments ++ validateComments).sortBy(_.timestamp).reverse.take(100)
    })
  }
}
