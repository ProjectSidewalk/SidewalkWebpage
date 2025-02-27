package models.mission

import com.google.inject.ImplementedBy

import java.time.OffsetDateTime
import java.util.UUID
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit.{AuditTask, AuditTaskTable}
import models.mission.MissionTable.{labelmapValidationMissionLength, normalValidationMissionLength}
import models.mission.MissionTypeTable.missionTypeToId
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.region._
import models.user.{RoleTable, RoleTableDef, SidewalkUserTableDef, UserCurrentRegionTable, UserRoleTable, UserRoleTableDef}
import models.utils.MyPostgresProfile
import play.api.Logger

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionalMission(missionId: Int, missionType: String, regionId: Option[Int], regionName: Option[String],
                           distanceMeters: Option[Float], labelsValidated: Option[Int])

case class MissionSetProgress(missionType: String, numComplete: Int)

case class Mission(missionId: Int, missionTypeId: Int, userId: String, missionStart: OffsetDateTime,
                   missionEnd: OffsetDateTime, completed: Boolean, pay: Double, paid: Boolean,
                   distanceMeters: Option[Float], distanceProgress: Option[Float], regionId: Option[Int],
                   labelsValidated: Option[Int], labelsProgress: Option[Int], labelTypeId: Option[Int],
                   skipped: Boolean, currentAuditTaskId: Option[Int])

class MissionTableDef(tag: Tag) extends Table[Mission](tag, "mission") {
  def missionId: Rep[Int] = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def missionTypeId: Rep[Int] = column[Int]("mission_type_id")
  def userId: Rep[String] = column[String]("user_id")
  def missionStart: Rep[OffsetDateTime] = column[OffsetDateTime]("mission_start")
  def missionEnd: Rep[OffsetDateTime] = column[OffsetDateTime]("mission_end")
  def completed: Rep[Boolean] = column[Boolean]("completed")
  def pay: Rep[Double] = column[Double]("pay")
  def paid: Rep[Boolean] = column[Boolean]("paid")
  def distanceMeters: Rep[Option[Float]] = column[Option[Float]]("distance_meters")
  def distanceProgress: Rep[Option[Float]] = column[Option[Float]]("distance_progress")
  def regionId: Rep[Option[Int]] = column[Option[Int]]("region_id")
  def labelsValidated: Rep[Option[Int]] = column[Option[Int]]("labels_validated")
  def labelsProgress: Rep[Option[Int]] = column[Option[Int]]("labels_progress")
  def labelTypeId: Rep[Option[Int]] = column[Option[Int]]("label_type_id")
  def skipped: Rep[Boolean] = column[Boolean]("skipped")
  def currentAuditTaskId: Rep[Option[Int]] = column[Option[Int]]("current_audit_task_id")

  def * = (missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters, distanceProgress, regionId, labelsValidated, labelsProgress, labelTypeId, skipped, currentAuditTaskId) <> ((Mission.apply _).tupled, Mission.unapply)

//  def missionType: ForeignKeyQuery[MissionTypeTable, MissionType] =
//    foreignKey("mission_mission_type_id_fkey", missionTypeId, TableQuery[MissionTypeTableDef])(_.missionTypeId)
//
//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("mission_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//
//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
//
//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("mission_current_audit_task_id_fkey", currentAuditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object MissionTable {
  // Distances for first few missions: 250 ft, 250 ft, then 500 ft for all remaining.
  val distancesForFirstAuditMissions: List[Float] = List(76.2F, 76.2F)
  val distanceForLaterMissions: Float = 152.4F // 500 ft

  // Number of labels for each type of validation mission
  val normalValidationMissionLength: Int = 10
  val labelmapValidationMissionLength: Int = 1

  val validationMissionLabelsToRetrieve: Int = 10

  val defaultAuditMissionSetProgress: MissionSetProgress = MissionSetProgress("audit", 0)
  val defaultValidationMissionSetProgress: MissionSetProgress = MissionSetProgress("validation", 0)
}

@ImplementedBy(classOf[MissionTable])
trait MissionTableRepository {
  def getCurrentValidationMission(userId: String, labelTypeId: Int, missionType: String): DBIO[Option[Mission]]
  def getNextValidationMissionLength(userId: String, missionType: String): Int
  def createNextValidationMission(userId: String, pay: Double, labelsToValidate: Int, labelTypeId: Int, missionType: String) : DBIO[Mission]
  def updateComplete(missionId: Int): DBIO[Int]
  def updateSkipped(missionId: Int): DBIO[Int]
  def updateValidationProgress(missionId: Int, labelsProgress: Int): DBIO[Int]
}

@Singleton
class MissionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends MissionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  private val logger = Logger(this.getClass)

  val missions = TableQuery[MissionTableDef]
  val missionTypes = TableQuery[MissionTypeTableDef]
  val users = TableQuery[SidewalkUserTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]

  val auditMissions = missions.filter(_.missionTypeId === MissionTypeTable.missionTypeToId("audit"))
//  val validationMissionTypeId: Int = {
//    missionTypes.filter(_.missionType === "validation").map(_.missionTypeId).first
//  }
//  val validationMissions = missions.filter(_.missionTypeId === validationMissionTypeId)


//  implicit val missionConverter = GetResult[Mission](r => {
//    val missionId: Int = r.nextInt
//    val missionTypeId: Int = r.nextInt
//    val userId: String = r.nextString
//    val missionStart: OffsetDateTime = OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC)
//    val missionEnd: OffsetDateTime = OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC)
//    val completed: Boolean = r.nextBoolean
//    val pay: Double = r.nextDouble
//    val paid: Boolean = r.nextBoolean
//    val distanceMeters: Option[Float] = r.nextFloatOption
//    val distanceProgress: Option[Float] = r.nextFloatOption
//    val regionId: Option[Int] = r.nextIntOption
//    val labelsValidated: Option[Int] = r.nextIntOption
//    val labelsProgress: Option[Int] = r.nextIntOption
//    val labelTypeId: Option[Int] = r.nextIntOption
//    val skipped: Boolean = r.nextBoolean
//    val currentAuditTaskId: Option[Int] = r.nextIntOption
//    Mission(missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters,
//            distanceProgress, regionId, labelsValidated, labelsProgress, labelTypeId, skipped, currentAuditTaskId)
//  })
//
//  /**
//    * Count the number of missions completed by a user.
//    *
//    * @param includeOnboarding should any onboarding missions be included in this count
//    * @return
//    */
//  def countCompletedMissions(userId: UUID, includeOnboarding: Boolean, includeSkipped: Boolean): Int = {
//    completedMissionsQuery(userId, includeOnboarding, includeSkipped).size
//  }

  /**
    * Count number of missions of the given type completed by the given user.
    */
  def countCompletedMissions(userId: String, missionType: String): DBIO[Int] = {
    (for {
      _missionType <- missionTypes
      _mission <- missions if _missionType.missionTypeId === _mission.missionTypeId
      if _missionType.missionType === missionType && _mission.userId === userId && _mission.completed === true
    } yield _mission.missionId).size.result
  }

//  /**
//    * Returns true if the user has an amt_assignment and has completed an audit mission during it, false o/w.
//    */
//  def hasCompletedAuditMissionInThisAmtAssignment(username: String): Boolean = {
//    val asmt: Option[AMTAssignment] = AMTAssignmentTable.getMostRecentAssignment(username)
//    if (asmt.isEmpty) {
//      false
//    } else {
//      missions.filter(m => m.missionTypeId === auditMissionTypeId
//        && m.missionEnd > asmt.get.assignmentStart
//        && m.missionEnd < asmt.get.assignmentEnd
//        && m.completed
//      ).list.nonEmpty
//    }
//  }

//  /**
//    * Returns Some(confirmationCode) if the worker finished an audit mission, None o/w.
//    */
//  def getMostRecentConfirmationCodeIfCompletedAuditMission(username: String): Option[String] = {
//    if (hasCompletedAuditMissionInThisAmtAssignment(username)) {
//      AMTAssignmentTable.getMostRecentConfirmationCode(username)
//    } else {
//      None
//    }
//  }

  /**
    * Check if the user has completed onboarding.
    */
  def hasCompletedAuditOnboarding(userId: String): DBIO[Boolean] = {
    completedMissionsQuery(userId, includeOnboarding = true, includeSkipped = true)
      .filter(_.missionTypeId === MissionTypeTable.missionTypeToId("auditOnboarding"))
      .exists.result
  }

//  /**
//    * Checks if the specified mission is an onboarding mission.
//    */
//  def isOnboardingMission(missionId: Int): Boolean = {
//    MissionTypeTable.onboardingTypeIds.contains(missions.filter(_.missionId === missionId).map(_.missionTypeId).first)
//  }

  /**
    * Get a list of all the missions completed by the user.
    *
    * @param userId User's userId
    * @param includeOnboarding should any onboarding missions be included
    * @param includeSkipped should any skipped missions be included
    */
  def completedMissionsQuery(userId: String, includeOnboarding: Boolean, includeSkipped: Boolean): Query[MissionTableDef, Mission, Seq] = {
    val _m1 = missions.filter(m => m.userId === userId && m.completed)
    val _m2 = if (includeOnboarding) _m1 else _m1.filterNot(_.missionTypeId inSet MissionTypeTable.onboardingTypeIds)
    val _m3 = if (includeSkipped) _m2 else _m2.filterNot(_.skipped)
    _m3
  }

  /**
    * Get the user's incomplete mission in the region if there is one.
    */
  def getCurrentMissionInRegion(userId: String, regionId: Int): DBIO[Option[Mission]] = {
    missions.filter(m => m.userId === userId && m.regionId === regionId && !m.completed).result.headOption
  }

  /**
   * Returns the mission with the provided ID, if it exists.
   */
  def getMission(missionId: Int): DBIO[Option[Mission]] = {
    missions.filter(m => m.missionId === missionId).result.headOption
  }

  def getCurrentValidationMission(userId: String, labelTypeId: Int, missionType: String): DBIO[Option[Mission]] = {
    missions.filter(m =>
      m.userId === userId
        && m.missionTypeId === missionTypeToId(missionType)
        && m.labelTypeId === labelTypeId
        && !m.completed
    ).result.headOption
  }

  /**
    * Get the user's incomplete auditOnboarding mission if there is one.
    */
  def getIncompleteAuditOnboardingMission(userId: String): DBIO[Option[Mission]] = {
    missions.filter(m => m.userId === userId && m.missionTypeId === missionTypeToId("auditOnboarding") && !m.completed)
      .result.headOption
  }

  /**
    * Get the list of the completed audit missions in the given region for the given user.
    *
    * @param userId User's UUID
    * @param regionId region Id
    */
  def selectCompletedExploreMissions(userId: String, regionId: Int): DBIO[Seq[Mission]] = {
    auditMissions.filter(m => m.completed === true && m.regionId === regionId && m.userId === userId).result
  }

//  /**
//    * Select missions with neighborhood names.
//    */
//  def selectCompletedRegionalMission(userId: UUID): List[RegionalMission] = {
//    val userMissions = missions.filter(_.userId === userId.toString)
//
//    val missionsWithRegionName = for {
//      (_m, _r) <- userMissions.joinLeft(RegionTable.regions).on(_.regionId === _.regionId)
//    } yield (_m.missionId, _m.missionTypeId, _m.regionId, _r.name.?, _m.distanceMeters, _m.labelsValidated)
//
//    val regionalMissions: List[RegionalMission] = missionsWithRegionName.list.map(m =>
//      RegionalMission(m._1, MissionTypeTable.missionTypeIdToMissionType(m._2), m._3, m._4, m._5, m._6)
//    )
//
//    regionalMissions.sortBy(rm => (rm.regionId, rm.missionId))
//  }
//
//  /**
//    * Select mission counts by user.
//    *
//    * @return List[(user_id, role, count)]
//    */
//  def selectMissionCountsPerUser: List[(String, String, Int)] = {
//    val userMissions = for {
//      _user <- users if _user.username =!= "anonymous"
//      _userRole <- userRoles if _user.userId === _userRole.userId
//      _role <- roles if _userRole.roleId === _role.roleId
//      _mission <- missions if _user.userId === _mission.userId
//      _missionType <- missionTypes if _mission.missionTypeId === _missionType.missionTypeId
//      if _missionType.missionType =!= "auditOnboarding"
//    } yield (_user.userId, _role.role, _mission.missionId)
//
//    // Count missions per user by grouping by (user_id, role).
//    userMissions.groupBy(m => (m._1, m._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.list
//  }
//
//  /**
//    * Counts up total reward earned from completed missions for the user.
//    */
//  def totalRewardEarned(userId: UUID): Double = {
//    missions.filter(m => m.userId === userId.toString && m.completed).map(_.pay).sum.run.getOrElse(0.0D)
//  }

  /**
    * Get the number of labels validated in a validation mission. Depends on type of validation mission.
    *
    * @param userId         UserID of user requesting more labels.
    * @param missionType    Name of the validation mission type
    * @return               {validation: 10, labelmapValidation: 1}
    */
  def getNextValidationMissionLength(userId: String, missionType: String): Int = {
    missionType match {
      case "validation" => normalValidationMissionLength
      case "labelmapValidation" =>  labelmapValidationMissionLength
    }
  }

  /**
    * Creates a new audit mission entry in mission table for the specified user/region id.
    *
    * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
    */
  def createNextAuditMission(userId: String, pay: Double, distance: Float, regionId: Int): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("audit")
    val newMission = Mission(0, missionTypeId, userId, now, now, false, pay, false, Some(distance), Some(0.0.toFloat), Some(regionId), None, None, None, false, None)
    (missions returning missions) += newMission
  }

  /**
    * Creates and returns a new validation mission.
    *
    * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
    *
    * @param userId             User ID
    * @param pay                Amount user is paid per label
    * @param labelsToValidate   Number of labels in this mission
    * @param labelTypeId        Type of labels featured in this mission {1: cr, 2: mcr, 3: obs in path, 4: sfcp, 7: no sdwlk}
    * @param missionType        Type of validation mission {validation, labelmapValidation}
    */
  def createNextValidationMission(userId: String, pay: Double, labelsToValidate: Int, labelTypeId: Int, missionType: String) : DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val missionTypeId: Int = MissionTypeTable.missionTypeToId(missionType)
    val newMission = Mission(0, missionTypeId, userId, now, now, false, pay, false, None, None, None, Some(labelsToValidate), Some(0.0.toInt), Some(labelTypeId), false, None)
    (missions returning missions) += newMission
  }

  /**
    * Creates a new auditOnboarding mission entry in the mission table for the specified user.
    *
    * NOTE only call from queryMissionTable or queryMissionTableValidationMissions funcs to prevent race conditions.
    */
  def createAuditOnboardingMission(userId: String, pay: Double): DBIO[Mission] = {
    val now: OffsetDateTime = OffsetDateTime.now
    val mTypeId: Int = MissionTypeTable.missionTypeToId("auditOnboarding")
    val newMiss = Mission(0, mTypeId, userId, now, now, false, pay, false, None, None, None, None, None, None, false, None)
    (missions returning missions) += newMiss
  }

//  /**
//   * Get mission_type for a given mission_id.
//   */
//  def getMissionType(missionId: Int): Option[String] = {
//    (for {
//      _mission <- missions if _mission.missionId === missionId
//      _missionType <- missionTypes if _mission.missionTypeId === _missionType.missionTypeId
//    } yield _missionType.missionType).firstOption
//  }

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
  def updateExploreProgress(missionId: Int, distanceProgress: Float, auditTaskId: Option[Int]): DBIO[Int] = {
    val now: OffsetDateTime = OffsetDateTime.now
    missions.filter(_.missionId === missionId).map(_.distanceMeters).result.flatMap { missionList =>
      (missionList, missionList.head) match {
        case (x :: _, Some(_)) =>
          val missionDistance: Float = missionList.head.get
          val missionToUpdate: Query[(Rep[Option[Float]], Rep[OffsetDateTime], Rep[Option[Int]]), (Option[Float], OffsetDateTime, Option[Int]), Seq] = for {
            m <- missions if m.missionId === missionId
          } yield (m.distanceProgress, m.missionEnd, m.currentAuditTaskId)

          if (~= (distanceProgress, missionDistance, precision = 0.00001F) ) {
            missionToUpdate.update((Some(missionDistance), now, auditTaskId))
          } else if (distanceProgress < missionDistance) {
            missionToUpdate.update((Some(distanceProgress), now, auditTaskId))
          } else {
            logger.error ("Trying to update mission progress with distance greater than total mission distance.")
            missionToUpdate.update((Some(missionDistance), now, auditTaskId))
          }
        case _ => DBIO.successful(0)
      }
    }
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
      updateResult <- missions.filter(_.missionId === missionId)
        .map(m => (m.labelsProgress, m.missionEnd))
        .update((Some(missionLabels match {
          case Some(Some(ml)) => math.min(labelsProgress, ml)
          case _ => labelsProgress
        }), now))
    } yield updateResult
  }

  // Approximate equality check for Floats
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Float, y: Float, precision: Float): Boolean = { // Approximate equality check for Floats
    val diff: Float = x - y
    if (diff.abs < precision) true else false
  }
}
