package models.mission

import com.google.inject.ImplementedBy
import models.mission.MissionTable.{labelmapValidationMissionLength, normalValidationMissionLength}
import models.audit.AuditTaskTableDef
import models.label.LabelTypeTableDef
import models.region.RegionTableDef
import models.user.{RoleTableDef, SidewalkUserTableDef, UserRoleTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.Logger
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionalMission(
    missionId: Int,
    missionType: String,
    regionId: Option[Int],
    regionName: Option[String],
    distanceMeters: Option[Double],
    labelsValidated: Option[Int],
    missionEnd: OffsetDateTime
)

case class Mission(
    missionId: Int,
    missionType: MissionType.Value,
    userId: String,
    missionStart: OffsetDateTime,
    missionEnd: OffsetDateTime,
    completed: Boolean,
    pay: Double,
    paid: Boolean,
    distanceMeters: Option[Double],
    distanceProgress: Option[Double],
    regionId: Option[Int],
    labelsValidated: Option[Int],
    labelsProgress: Option[Int],
    labelTypeId: Option[Int],
    skipped: Boolean,
    currentAuditTaskId: Option[Int]
)

class MissionTableDef(tag: Tag) extends Table[Mission](tag, "mission") {
  def missionId: Rep[Int]                   = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def missionType: Rep[MissionType.Value]   = column[MissionType.Value]("mission_type")
  def userId: Rep[String]                   = column[String]("user_id")
  def missionStart: Rep[OffsetDateTime]     = column[OffsetDateTime]("mission_start")
  def missionEnd: Rep[OffsetDateTime]       = column[OffsetDateTime]("mission_end")
  def completed: Rep[Boolean]               = column[Boolean]("completed")
  def pay: Rep[Double]                      = column[Double]("pay")
  def paid: Rep[Boolean]                    = column[Boolean]("paid")
  def distanceMeters: Rep[Option[Double]]   = column[Option[Double]]("distance_meters")
  def distanceProgress: Rep[Option[Double]] = column[Option[Double]]("distance_progress")
  def regionId: Rep[Option[Int]]            = column[Option[Int]]("region_id")
  def labelsValidated: Rep[Option[Int]]     = column[Option[Int]]("labels_validated")
  def labelsProgress: Rep[Option[Int]]      = column[Option[Int]]("labels_progress")
  def labelTypeId: Rep[Option[Int]]         = column[Option[Int]]("label_type_id")
  def skipped: Rep[Boolean]                 = column[Boolean]("skipped")
  def currentAuditTaskId: Rep[Option[Int]]  = column[Option[Int]]("current_audit_task_id")

  def * = (missionId, missionType, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters,
    distanceProgress, regionId, labelsValidated, labelsProgress, labelTypeId, skipped, currentAuditTaskId) <> (
    (Mission.apply _).tupled,
    Mission.unapply
  )

  def user      = foreignKey("mission_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def region    = foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId.?)
  def labelType =
    foreignKey("mission_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId.?)
  def currentAuditTask =
    foreignKey("mission_current_audit_task_id_fkey", currentAuditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId.?)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object MissionTable {
  // Distances for first few missions: 250 ft, 250 ft, then 500 ft for all remaining.
  val distancesForFirstAuditMissions: Seq[Double] = Seq(76.2d, 76.2d)
  val distanceForLaterMissions: Double            = 152.4d // 500 ft

  // Number of labels for each type of validation mission
  val normalValidationMissionLength: Int   = 10
  val labelmapValidationMissionLength: Int = 1

  val validationMissionLabelsToRetrieve: Int = 10
}

@ImplementedBy(classOf[MissionTable])
trait MissionTableRepository {}

@Singleton
class MissionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends MissionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

  val missions  = TableQuery[MissionTableDef]
  val users     = TableQuery[SidewalkUserTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roles     = TableQuery[RoleTableDef]
  val regions   = TableQuery[RegionTableDef]

  val auditMissions = missions.filter(_.missionType === MissionType.Audit)

  /**
   * Count the number of missions completed by a user.
   * @param includeOnboarding should any onboarding missions be included in this count
   */
  def countCompletedMissions(userId: String, includeOnboarding: Boolean, includeSkipped: Boolean): DBIO[Int] = {
    completedMissionsQuery(userId, includeOnboarding, includeSkipped).length.result
  }

  /**
   * Count number of missions of the given type completed by the given user.
   */
  def countCompletedMissions(userId: String, missionType: MissionType.Value): DBIO[Int] = {
    missions.filter(m => m.missionType === missionType && m.userId === userId && m.completed).length.result
  }

  /**
   * Check if the user has completed onboarding.
   */
  def hasCompletedAuditOnboarding(userId: String): DBIO[Boolean] = {
    completedMissionsQuery(userId, includeOnboarding = true, includeSkipped = true)
      .filter(_.missionType === MissionType.AuditOnboarding)
      .exists
      .result
  }

  /**
   * Checks if the specified mission is an onboarding mission.
   */
  def isOnboardingMission(missionId: Int): DBIO[Boolean] = {
    missions.filter(_.missionId === missionId).map(_.missionType).result.head.map(MissionType.onboardingTypes.contains)
  }

  /**
   * Get a list of all the missions completed by the user.
   * @param userId User's userId
   * @param includeOnboarding should any onboarding missions be included
   * @param includeSkipped should any skipped missions be included
   */
  def completedMissionsQuery(
      userId: String,
      includeOnboarding: Boolean,
      includeSkipped: Boolean
  ): Query[MissionTableDef, Mission, Seq] = {
    val _m1 = missions.filter(m => m.userId === userId && m.completed)
    val _m2 = if (includeOnboarding) _m1 else _m1.filterNot(_.missionType inSet MissionType.onboardingTypes)
    val _m3 = if (includeSkipped) _m2 else _m2.filterNot(_.skipped)
    _m3
  }

  /**
   * Get the user's incomplete audit mission in the region if there is one.
   *
   * Filters by mission type so that non-audit incomplete missions (e.g. a never-completed exploreAddress mission,
   * which has region_id = NULL anyway) can't be resumed as a regular audit mission.
   */
  def getCurrentMissionInRegion(userId: String, regionId: Int): DBIO[Option[Mission]] = {
    missions
      .filter(m =>
        m.userId === userId && m.regionId === regionId && !m.completed
          && m.missionType === MissionType.Audit
      )
      .result
      .headOption
  }

  /**
   * Returns the mission with the provided ID, if it exists.
   */
  def getMission(missionId: Int): DBIO[Option[Mission]] = {
    missions.filter(m => m.missionId === missionId).result.headOption
  }

  /**
   * Get the AI validation mission ID for the given label type.
   * @param labelTypeId the label type ID for which to get the AI validation mission ID
   * @return DBIO[Int] - the mission ID for the AI validation mission of the given label type
   */
  def getAiValidateMissionId(labelTypeId: Int): DBIO[Int] = {
    missions
      .filter(m => m.labelTypeId === labelTypeId && m.missionType === MissionType.AiValidation)
      .map(_.missionId)
      .result
      .head
  }

  def getCurrentValidationMission(
      userId: String,
      labelTypeId: Int,
      missionType: MissionType.Value
  ): DBIO[Option[Mission]] = {
    missions
      .filter(m =>
        m.userId === userId
          && m.missionType === missionType
          && m.labelTypeId === labelTypeId
          && !m.completed
      )
      .result
      .headOption
  }

  /**
   * Get the user's incomplete auditOnboarding mission if there is one.
   */
  def getIncompleteAuditOnboardingMission(userId: String): DBIO[Option[Mission]] = {
    missions
      .filter(m => m.userId === userId && m.missionType === MissionType.AuditOnboarding && !m.completed)
      .result
      .headOption
  }

  /**
   * Get the user's incomplete exploreAddress mission if there is one.
   *
   * A user has at most one: every address-drop-in session (#4451) resumes it, and it is never marked complete.
   * Sorted newest-first so that if the at-most-one invariant is ever violated (e.g. manual DB edits), we resume the
   * most recent mission rather than a stale one.
   */
  def getIncompleteExploreAddressMission(userId: String): DBIO[Option[Mission]] = {
    missions
      .filter(m => m.userId === userId && m.missionType === MissionType.ExploreAddress && !m.completed)
      .sortBy(_.missionId.desc)
      .result
      .headOption
  }

  /**
   * Get the list of the completed audit missions in the given region for the given user.
   * @param userId User's ID
   * @param regionId region Id
   */
  def selectCompletedExploreMissions(userId: String, regionId: Int): DBIO[Seq[Mission]] = {
    auditMissions.filter(m => m.completed === true && m.regionId === regionId && m.userId === userId).result
  }

  /**
   * Select missions with neighborhood names.
   */
  def selectCompletedRegionalMission(userId: String): DBIO[Seq[RegionalMission]] = {
    // Exclude exploreAddress missions: they never complete and have no region/distance, so they'd render as noise
    // rows (type 'exploreAddress', Region N/A, Distance 0.0) on the admin user-profile mission table (#4451).
    val userMissions =
      missions.filter(m => m.userId === userId && m.missionType =!= MissionType.ExploreAddress)

    val missionsWithRegionName = for {
      (m, r) <- userMissions.joinLeft(regions).on(_.regionId === _.regionId)
    } yield (m.missionId, m.missionType, m.regionId, r.map(_.name), m.distanceMeters, m.labelsValidated, m.missionEnd)

    missionsWithRegionName
      .sortBy(m => (m._3, m._1))
      .result
      .map(_.map(m => RegionalMission(m._1, m._2.toString, m._3, m._4, m._5, m._6, m._7)))
  }

  /**
   * Daily count of completed real missions, bucketed by `mission_end`.
   *
   * Counts only completed, non-skipped missions and excludes both onboarding tutorial types (they aren't real
   * contribution activity).
   *
   * @return DBIO[Seq[(day, count)]] — `day` is `mission_end` truncated to the day; sorted ascending.
   */
  def getMissionCountsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    val completedMissions = for {
      _mission <- missions if _mission.completed && !_mission.skipped
      if !(_mission.missionType inSet MissionType.onboardingTypes)
    } yield _mission.missionEnd.trunc("day")

    completedMissions.groupBy(x => x).map { case (day, group) => (day, group.length) }.sortBy(_._1).result
  }

  /**
   * Get the number of labels validated in a validation mission. Depends on type of validation mission.
   * @param missionType    Name of the validation mission type
   * @return               {validation: 10, labelmapValidation: 1}
   */
  def getNextValidationMissionLength(missionType: MissionType.Value): Int = {
    missionType match {
      case MissionType.Validation         => normalValidationMissionLength
      case MissionType.LabelmapValidation => labelmapValidationMissionLength
      case other => throw new IllegalArgumentException(s"Not a validation mission type: $other")
    }
  }

  /**
   * Creates a new audit mission entry in mission table for the specified user/region id.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   */
  def createNextAuditMission(userId: String, distance: Double, regionId: Int): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val newMission          = Mission(0, MissionType.Audit, userId, now, now, completed = false, 0d, paid = false,
      Some(distance), Some(0d), Some(regionId), None, None, None, skipped = false, None)
    (missions returning missions) += newMission
  }

  /**
   * Creates and returns a new validation mission.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   *
   * @param userId             User ID
   * @param labelsToValidate   Number of labels in this mission
   * @param labelTypeId        Type of labels featured in this mission {1: cr, 2: mcr, 3: obs, 4: sfcp, 7: no sdwlk}
   * @param missionType        Type of validation mission {validation, labelmapValidation}
   */
  def createNextValidationMission(
      userId: String,
      labelsToValidate: Int,
      labelTypeId: Int,
      missionType: MissionType.Value
  ): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val newMission = Mission(0, missionType, userId, now, now, completed = false, 0d, paid = false, None, None, None,
      Some(labelsToValidate), Some(0.0.toInt), Some(labelTypeId), skipped = false, None)
    (missions returning missions) += newMission
  }

  /**
   * Creates a new exploreAddress mission entry in the mission table for the specified user (#4451).
   *
   * No distance target and no region: the mission is a free-exploration container that is never completed, so a
   * region_id would let getCurrentMissionInRegion-style queries mistake it for a resumable audit mission.
   */
  def createExploreAddressMission(userId: String): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val newMission = Mission(0, MissionType.ExploreAddress, userId, now, now, completed = false, 0d, paid = false, None,
      None, None, None, None, None, skipped = false, None)
    (missions returning missions) += newMission
  }

  /**
   * Creates a new auditOnboarding mission entry in the mission table for the specified user.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   */
  def createAuditOnboardingMission(userId: String): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val newMiss = Mission(0, MissionType.AuditOnboarding, userId, now, now, completed = false, 0d, paid = false, None,
      None, None, None, None, None, skipped = false, None)
    (missions returning missions) += newMiss
  }

  /**
   * Get mission_type for a given mission_id.
   */
  def getMissionType(missionId: Int): DBIO[Option[MissionType.Value]] = {
    missions.filter(_.missionId === missionId).map(_.missionType).result.headOption
  }

  /**
   * Marks the specified mission as complete, filling in mission_end timestamp.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   *
   * @return Int number of rows updated (should always be 1).
   */
  def updateComplete(missionId: Int): DBIO[Int] = {
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield (m.completed, m.missionEnd)
    missionToUpdate.update((true, OffsetDateTime.now)).map { rowsUpdated =>
      if (rowsUpdated == 0) logger.error("Tried to mark a mission as complete, but no mission exists with that ID.")
      rowsUpdated
    }
  }

  /**
   * Marks the specified mission as skipped.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   */
  def updateSkipped(missionId: Int): DBIO[Int] = {
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield m.skipped
    missionToUpdate.update(true).map { rowsUpdated =>
      if (rowsUpdated == 0) logger.error("Tried to mark a mission as skipped, but no mission exists with that ID.")
      rowsUpdated
    }
  }

  /**
   * Updates the distance_progress column of a mission.
   * TODO this isn't a simple CRUD operation, so it should probably go in a Service file.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   *
   * @return Int number of rows updated (should always be 1 if successful, 0 otherwise).
   */
  def updateExploreProgress(missionId: Int, distanceProgress: Double, auditTaskId: Option[Int]): DBIO[Int] = {
    val now: OffsetDateTime = OffsetDateTime.now
    missions
      .filter(_.missionId === missionId)
      .map(_.distanceMeters)
      .result
      .flatMap { missionList: Seq[Option[Double]] =>
        missionList.head match {
          case Some(missionDistance) =>
            val missionToUpdate = for {
              m <- missions if m.missionId === missionId
            } yield (m.distanceProgress, m.missionEnd, m.currentAuditTaskId)

            if (~=(distanceProgress, missionDistance, precision = 0.00001d)) {
              missionToUpdate.update((Some(missionDistance), now, auditTaskId))
            } else if (distanceProgress < missionDistance) {
              missionToUpdate.update((Some(distanceProgress), now, auditTaskId))
            } else {
              logger.error("Trying to update mission progress with distance greater than total mission distance.")
              missionToUpdate.update((Some(missionDistance), now, auditTaskId))
            }
          case _ => DBIO.successful(0)
        }
      }
      .transactionally
  }

  /**
   * Updates the current_audit_task_id column of a mission directly.
   *
   * Needed for exploreAddress missions (#4451): updateExploreProgress silently skips the current_audit_task_id write
   * when distance_meters IS NULL, and these missions have no distance target.
   */
  def updateCurrentAuditTaskId(missionId: Int, auditTaskId: Option[Int]): DBIO[Int] = {
    missions
      .filter(_.missionId === missionId)
      .map(m => (m.currentAuditTaskId, m.missionEnd))
      .update((auditTaskId, OffsetDateTime.now))
  }

  /**
   * Updates the labels_validated column of a mission.
   *
   * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
   */
  def updateValidationProgress(missionId: Int, labelsProgress: Int): DBIO[Int] = {
    val now: OffsetDateTime = OffsetDateTime.now

    for {
      missionLabels <- missions.filter(_.missionId === missionId).map(_.labelsValidated).result.headOption
      updateResult  <- missions
        .filter(_.missionId === missionId)
        .map(m => (m.labelsProgress, m.missionEnd))
        .update(
          (
            Some(missionLabels match {
              case Some(Some(ml)) => math.min(labelsProgress, ml)
              case _              => labelsProgress
            }),
            now
          )
        )
    } yield updateResult
  }

  // Approximate equality check for Doubles
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Double, y: Double, precision: Double): Boolean = { // Approximate equality check for Doubles
    val diff: Double = x - y
    if (diff.abs < precision) true else false
  }
}
