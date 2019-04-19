package models.mission

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import models.region._
import models.user.{RoleTable, UserRoleTable}
import models.label.{LabelTable, LabelTypeTable}
import models.region.RegionPropertyTable
import play.api.Logger
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.collection.immutable
import scala.slick.lifted.{ForeignKeyQuery, QueryBase}
import scala.slick.jdbc.GetResult

case class RegionalMission(missionId: Int, missionType: String, regionId: Option[Int], regionName: Option[String],
                           distanceMeters: Option[Float], labelsValidated: Option[Int])

case class AuditMission(userId: String, username: String, missionId: Int, completed: Boolean, missionStart: Timestamp,
                        missionEnd: Timestamp, neighborhood: Option[String], labelId: Option[Int], labelType: Option[String])

case class Mission(missionId: Int, missionTypeId: Int, userId: String, missionStart: Timestamp, missionEnd: Timestamp,
                   completed: Boolean, pay: Double, paid: Boolean, distanceMeters: Option[Float],
                   distanceProgress: Option[Float], regionId: Option[Int], labelsValidated: Option[Int],
                   labelsProgress: Option[Int], labelTypeId: Option[Int], skipped: Boolean) {

  def toJSON: JsObject = {
    Json.obj(
      "mission_id" -> missionId,
      "mission_type" -> MissionTypeTable.missionTypeIdToMissionType(missionTypeId),
      "user_id" -> userId,
      "mission_start" -> missionStart,
      "mission_end" -> missionEnd,
      "completed" -> completed,
      "pay" -> pay,
      "paid" -> paid,
      "distance_meters" -> distanceMeters,
      "distance_progress" -> distanceProgress,
      "region_id" -> regionId,
      "labels_validated" -> labelsValidated,
      "labels_progress" -> labelsProgress,
      "label_type_id" -> labelTypeId,
      "skipped" -> skipped
    )
  }
}

class MissionTable(tag: Tag) extends Table[Mission](tag, Some("sidewalk"), "mission") {
  def missionId: Column[Int] = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def missionTypeId: Column[Int] = column[Int]("mission_type_id", O.NotNull)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def missionStart: Column[Timestamp] = column[Timestamp]("mission_start", O.NotNull)
  def missionEnd: Column[Timestamp] = column[Timestamp]("mission_end", O.NotNull)
  def completed: Column[Boolean] = column[Boolean]("completed", O.NotNull)
  def pay: Column[Double] = column[Double]("pay", O.NotNull)
  def paid: Column[Boolean] = column[Boolean]("paid", O.NotNull)
  def distanceMeters: Column[Option[Float]] = column[Option[Float]]("distance_meters", O.Nullable)
  def distanceProgress: Column[Option[Float]] = column[Option[Float]]("distance_progress", O.Nullable)
  def regionId: Column[Option[Int]] = column[Option[Int]]("region_id", O.Nullable)
  def labelsValidated: Column[Option[Int]] = column[Option[Int]]("labels_validated", O.Nullable)
  def labelsProgress: Column[Option[Int]] = column[Option[Int]]("labels_progress", O.Nullable)
  def labelTypeId: Column[Option[Int]] = column[Option[Int]]("label_type_id", O.Nullable)
  def skipped: Column[Boolean] = column[Boolean]("skipped", O.NotNull)

  def * = (missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters, distanceProgress, regionId, labelsValidated, labelsProgress, labelTypeId, skipped) <> ((Mission.apply _).tupled, Mission.unapply)

  def missionType: ForeignKeyQuery[MissionTypeTable, MissionType] =
    foreignKey("mission_mission_type_id_fkey", missionTypeId, TableQuery[MissionTypeTable])(_.missionTypeId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("mission_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

object MissionTable {
  val db = play.api.db.slick.DB
  val missions = TableQuery[MissionTable]
  val missionTypes = TableQuery[MissionTypeTable]

  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  val labels = TableQuery[LabelTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]

  // Distances for first few missions: 500 ft, 500 ft, 750 ft, then 1,000 ft for all remaining.
  val distancesForFirstAuditMissions: List[Float] = List(152.4F, 152.4F, 228.6F)
  val distanceForLaterMissions: Float = 304.8F // 1,000 ft

  // Number of labels for validation mission
  val validationMissionLabelCount: Int = 10

  implicit val missionConverter = GetResult[Mission](r => {
    val missionId: Int = r.nextInt
    val missionTypeId: Int = r.nextInt
    val userId: String = r.nextString
    val missionStart: Timestamp = r.nextTimestamp
    val missionEnd: Timestamp = r.nextTimestamp
    val completed: Boolean = r.nextBoolean
    val pay: Double = r.nextDouble
    val paid: Boolean = r.nextBoolean
    val distanceMeters: Option[Float] = r.nextFloatOption
    val distanceProgress: Option[Float] = r.nextFloatOption
    val regionId: Option[Int] = r.nextIntOption
    val labelsValidated: Option[Int] = r.nextIntOption
    val labelsProgress: Option[Int] = r.nextIntOption
    val labelTypeId: Option[Int] = r.nextIntOption
    val skipped: Boolean = r.nextBoolean
    Mission(missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters,
            distanceProgress, regionId, labelsValidated, labelsProgress, labelTypeId, skipped)
  })


  /**
    * Count the number of missions completed by a user.
    *
    * @param userId
    * @param includeOnboarding should any onboarding missions be included in this count
    * @return
    */
  def countCompletedMissionsByUserId(userId: UUID, includeOnboarding: Boolean): Int = db.withTransaction { implicit session =>
    selectCompletedMissionsByAUser(userId, includeOnboarding).size
  }

  /**
    * Returns true if the user has an amt_assignment and have completed a mission during it, false o/w.
    *
    * @param username
    * @return
    */
  def hasCompletedMissionInThisAmtAssignment(username: String): Boolean = db.withSession { implicit session =>
    val asmt: Option[AMTAssignment] = AMTAssignmentTable.getMostRecentAssignment(username)
    if (asmt.isEmpty) {
      false
    } else {
      missions.filterNot(_.missionTypeId inSet MissionTypeTable.onboardingTypeIds)
        .filter(m => m.missionEnd > asmt.get.assignmentStart && m.missionEnd < asmt.get.assignmentEnd && m.completed)
        .list.nonEmpty
    }
  }

  /**
    * Checks whether a particular missionId belongs to a particular userId.
    * @param userId
    * @param missionId
    * @return true if the mission belongs to the user, false otherwise
    */
  def userOwnsMission(userId: UUID, missionId: Int): Boolean = db.withSession{ implicit session =>
    missions.filter(m => m.userId === userId.toString && m.missionId === missionId).list.nonEmpty
  }

  /**
    * Check if the user has completed onboarding.
    *
    * @param userId
    * @return
    */
  def hasCompletedAuditOnboarding(userId: UUID): Boolean = db.withSession { implicit session =>
    selectCompletedMissionsByAUser(userId, includeOnboarding = true)
      .exists(_.missionTypeId == MissionTypeTable.missionTypeToId("auditOnboarding"))
  }

  /**
    * Checks if the specified mission is an onboarding mission.
    *
    * @param missionId
    * @return
    */
  def isOnboardingMission(missionId: Int): Boolean = db.withSession { implicit session =>
    MissionTypeTable.onboardingTypeIds.contains(missions.filter(_.missionId === missionId).map(_.missionTypeId).list.head)
  }

  /**
    * Checks if the specified mission is a CV ground truth mission.
    *
    * @param missionId
    * @return
    */
  def isCVGroundTruthMission(missionId: Int): Boolean = db.withSession { implicit session =>
    MissionTypeTable.missionTypeToId("cvGroundTruth") == missions.filter(_.missionId === missionId).map(_.missionTypeId).list.head
  }

  /**
    * Get a list of all the missions completed by the user.
    *
    * @param userId User's UUID
    * @param includeOnboarding should any onboarding missions be included
    * @return
    */
  def selectCompletedMissionsByAUser(userId: UUID, includeOnboarding: Boolean): List[Mission] = db.withSession { implicit session =>
    val _missions = if (includeOnboarding) {
      missions.filter(m => m.userId === userId.toString && m.completed)
    } else {
      missions.filter(m => m.userId === userId.toString && m.completed)
        .filterNot(_.missionTypeId inSet MissionTypeTable.onboardingTypeIds)
    }

    _missions.list.groupBy(_.missionId).map(_._2.head).toList
  }

  /**
    * Get the user's incomplete mission in the region if there is one.
    *
    * @param userId
    * @param regionId
    * @return
    */
  def getCurrentMissionInRegion(userId: UUID, regionId: Int): Option[Mission] = db.withSession { implicit session =>
    missions.filter(m => m.userId === userId.toString && m.regionId === regionId && !m.completed).list.headOption
  }

  /**
    * Returns the mission with the provided ID, if it exists.
    * @param missionId
    * @return
    */
  def getMissionById(missionId: Int): Option[Mission] = db.withSession { implicit session =>
    missions.filter(m => m.missionId === missionId).list.headOption
  }

  def getCurrentValidationMission(userId: UUID, labelTypeId: Int): Option[Mission] = db.withSession { implicit session =>
    val validationMissionId : Int = missionTypes.filter(_.missionType === "validation").map(_.missionTypeId).list.head
    missions.filter(m =>
      m.userId === userId.toString
        && m.missionTypeId === validationMissionId
        && m.labelTypeId === labelTypeId
        && !m.completed
    ).list.headOption
  }

  /**
    * Gets the list of in progress validation missions from a user
    * @param userId               User ID
    * @param currentLabelTypeId   Label Type ID
    * @return                     List of validation missions available
    */
  def getInProgressValidationMissions(userId: UUID, currentLabelTypeId: Option[Int]): List[Int] = db.withSession { implicit session =>
    val validationMissionId : Int = missionTypes.filter(_.missionType === "validation").map(_.missionTypeId).list.head
    missions.filter(m =>
      m.userId === userId.toString
        && m.missionTypeId === validationMissionId
        && !m.completed && !m.labelTypeId.isEmpty
        && m.labelTypeId =!= currentLabelTypeId.getOrElse(0)
    ).map(_.labelTypeId.get).list
  }

  /**
    * Returns the first CV ground truth audit mission that is not yet complete for the provided mission.
    * @param userId a user id
    * @return an incomplete CV ground truth audit mission
    */
  def getIncompleteCVGroundTruthMission(userId: UUID): Option[Mission] = db.withSession { implicit session =>
    val cvGroundTruthId: Int = missionTypes.filter(_.missionType === "cvGroundTruth").map(_.missionTypeId).list.head
    missions.filter(m => m.userId === userId.toString && m.missionTypeId === cvGroundTruthId && !m.completed)
      .sortBy(_.missionId).list.headOption
  }

  /**
    * Get the user's incomplete auditOnboarding mission if there is one.
    * @param userId
    * @return
    */
  def getIncompleteAuditOnboardingMission(userId: UUID): Option[Mission] = db.withSession { implicit session =>
    val tutorialId: Int = missionTypes.filter(_.missionType === "auditOnboarding").map(_.missionTypeId).list.head
    missions.filter(m => m.userId === userId.toString && m.missionTypeId === tutorialId && !m.completed).list.headOption
  }

  /**
    * Get the list of the completed audit missions in the given region for the given user.
    *
    * @param userId User's UUID
    * @param regionId region Id
    * @param includeOnboarding should region-less onboarding mission be included if complete
    * @return
    */
  def selectCompletedAuditMissionsByAUser(userId: UUID, regionId: Int, includeOnboarding: Boolean): List[Mission] = db.withSession { implicit session =>
    val auditMissionTypes: List[String] = if (includeOnboarding) List("audit", "auditOnboarding") else List("audit")
    val auditMissionTypeIds: List[Int] = missionTypes.filter(_.missionType inSet auditMissionTypes).map(_.missionTypeId).list
    missions.filter(m => m.userId === userId.toString
                      && (m.missionTypeId inSet auditMissionTypeIds)
                      && (m.regionId === regionId || m.regionId.isEmpty)
                      && m.completed === true).list
  }

  /**
    * Select missions with neighborhood names.
    *
    * @param userId
    * @return
    */
  def selectCompletedRegionalMission(userId: UUID): List[RegionalMission] = db.withSession { implicit session =>
    val userMissions = missions.filter(_.userId === userId.toString)

    val missionsWithRegionName = for {
      (_m, _rp) <- userMissions.leftJoin(RegionPropertyTable.neighborhoodNames).on(_.regionId === _.regionId)
    } yield (_m.missionId, _m.missionTypeId, _m.regionId, _rp.value.?, _m.distanceMeters, _m.labelsValidated)

    val regionalMissions: List[RegionalMission] = missionsWithRegionName.list.map(m =>
      RegionalMission(m._1, MissionTypeTable.missionTypeIdToMissionType(m._2), m._3, m._4, m._5, m._6)
    )

    regionalMissions.sortBy(rm => (rm.regionId, rm.missionId))
  }

  /**
    * Return a list of missions for a specific user
    *
    * @param userId User id
    * @return
    */
  def selectMissions(userId: UUID): List[AuditMission] = db.withSession { implicit session =>
    // gets all the missions that correspond to the user
    val userMissions = for {
      _users <- users if _users.userId === userId.toString
      _missions <- missions if _missions.skipped === false && _missions.userId === _users.userId
      _missionTypes <- missionTypes if _missions.missionTypeId === _missionTypes.missionTypeId &&
                                       (_missionTypes.missionType === "audit" ||
                                       _missionTypes.missionType === "auditOnboarding")
    } yield (_users.userId, _users.username, _missions.missionId, _missions.completed, _missions.missionStart, _missions.missionEnd, _missions.regionId)

    // gets all the labels for all the missions but maintains missions that have no labels
    val userMissionLabels = for {
      (_userMissions, _labels) <- userMissions.leftJoin(labels).on(_._3 === _.missionId)
    } yield (_userMissions._1, _userMissions._2, _userMissions._3, _userMissions._4, _userMissions._5, _userMissions._6, _userMissions._7, _labels.labelId.?, _labels.labelTypeId.?)

    // changes the id of each label to a string representing its label type
    val missionsWithLabels = for {
      (_userMissionLabels, _labelTypes) <- userMissionLabels.leftJoin(labelTypes).on(_._9 === _.labelTypeId)
    } yield (_userMissionLabels._1, _userMissionLabels._2, _userMissionLabels._3, _userMissionLabels._4, _userMissionLabels._5, _userMissionLabels._6, _userMissionLabels._7, _userMissionLabels._8, _labelTypes.labelType.?)

    // changes the region id to the name of the neighborhood
    val missionsWithNeighborhoods = for {
      (_missionsWithLabels, _regionProperties) <- missionsWithLabels.leftJoin(regionProperties).on(_._7 === _.regionId)
    } yield (_missionsWithLabels._1, _missionsWithLabels._2, _missionsWithLabels._3, _missionsWithLabels._4, _missionsWithLabels._5, _missionsWithLabels._6, _regionProperties.value.?, _missionsWithLabels._8, _missionsWithLabels._9)

    // formats the finalized JSON object using the format in the MissionFormat class
    missionsWithNeighborhoods.list.map(x => AuditMission.tupled(x))
  }

  /**
    * Returns all the missions.
    *
    * @return A list of Mission objects.
    */
  def selectMissions: List[Mission] = db.withSession { implicit session =>
    missions.list
  }

  /**
    * Select mission counts by user.
    *
    * @return List[(user_id, role, count)]
    */
  def selectMissionCountsPerUser: List[(String, String, Int)] = db.withSession { implicit session =>
    val userMissions = for {
      _user <- users if _user.username =!= "anonymous"
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roles if _userRole.roleId === _role.roleId
      _mission <- missions if _user.userId === _mission.userId
      _missionType <- missionTypes if _mission.missionTypeId === _missionType.missionTypeId
      if _missionType.missionType =!= "auditOnboarding"
    } yield (_user.userId, _role.role, _mission.missionId)

    // Count missions per user by grouping by (user_id, role).
    userMissions.groupBy(m => (m._1, m._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.list
  }

  /**
    * Counts up total reward earned from completed missions for the user.
    *
    * @param userId
    * @return
    */
  def totalRewardEarned(userId: UUID): Double = db.withSession { implicit session =>
    missions.filter(m => m.userId === userId.toString && m.completed).map(_.pay).sum.run.getOrElse(0.0D)
  }

  /**
    * Provides functionality for accessing mission table while a user is auditing while preventing race conditions.
    *
    * The mission table functionality that is required while a user is auditing is all wrapped up into this function in
    * a synchronized block to prevent race conditions that were happening otherwise. Functionality includes retrieving
    * partially completed missions, updating the progress of a mission, marking a mission as complete, and creating a
    * new mission. These all work for both "audit" and "auditOnboarding" missions.
    *
    * @param actions List containing one or more of "updateProgress", "updateComplete", or "getMission"; required.
    * @param userId Always required.
    * @param regionId Only required if actions contains "getMission".
    * @param payPerMeter Only required if actions contains "getMissions" and retakingTutorial is false.
    * @param tutorialPay Only required if actions contains "getMissions".
    * @param retakingTutorial Only required if actions contains "getMissions".
    * @param missionId Only required if actions contains "updateProgress" or "updateComplete".
    * @param distanceProgress Only required if actions contains "updateProgress".
    * @return
    */
  def queryMissionTable(actions: List[String], userId: UUID, regionId: Option[Int], payPerMeter: Option[Double],
                        tutorialPay: Option[Double], retakingTutorial: Option[Boolean], missionId: Option[Int],
                        distanceProgress: Option[Float], skipped: Option[Boolean]): Option[Mission] = db.withSession { implicit session =>
    this.synchronized {
      if (actions.contains("updateProgress")) {
        updateAuditProgress(missionId.get, distanceProgress.get)
      }
      if (actions.contains("updateComplete")) {
        updateComplete(missionId.get)
        if (skipped.getOrElse(false)) {
          updateSkipped(missionId.get)
        }
      }
      if (actions.contains("getMission")) {
        // If they still need to do tutorial or are retaking it.
        if (!hasCompletedAuditOnboarding(userId) || retakingTutorial.get) {
          // If there is already an incomplete tutorial mission in the table then grab it, o/w make a new one.
          getIncompleteAuditOnboardingMission(userId) match {
            case Some(incompleteOnboardingMission) => Some(incompleteOnboardingMission)
            case _ => Some(createAuditOnboardingMission(userId, tutorialPay.get))
          }
        } else {
          // Non-tutorial mission: if there is an incomplete one in the table then grab it, o/w make a new one.
          getCurrentMissionInRegion(userId, regionId.get) match {
            case Some(incompleteMission) =>
              Some(incompleteMission)
            case _ =>
              val nextMissionDistance: Float = getNextAuditMissionDistance(userId, regionId.get)
              if (nextMissionDistance > 0) {
                val pay: Double = nextMissionDistance.toDouble * payPerMeter.get
                Some(createNextAuditMission(userId, pay, nextMissionDistance, regionId.get))
              } else {
                None
              }
          }
        }
      } else {
        None // If we are not trying to get a mission, return None
      }
    }
  }

  /**
    * Provides functionality for accessing the mission table while the user is validating.
    * @param actions            List of actions to perform.
    * @param userId             User ID
    * @param payPerLabel        Amount of money users receive per label validated (not fully implemented feature)
    * @param tutorialPay        Amount of money users when completing onboarding tutorial (not implemented -- exists in case there is any onboarding)
    * @param retakingTutorial   Indicates whether the user is retaking the turoial (not implemented -- tutorial doesn't exist).
    * @param missionId          Mission ID of the current mission.
    * @param labelsProgress     Numbers of labels that have been validated
    * @param labelTypeId        Label Type ID of the next mission to be validated
    * @param skipped            Indicates whether this mission has been skipped (not fully implemented)
    */
  def queryMissionTableValidationMissions(actions: List[String], userId: UUID, payPerLabel: Option[Double],
                                          tutorialPay: Option[Double], retakingTutorial: Option[Boolean],
                                          missionId: Option[Int], labelsProgress: Option[Int], labelTypeId: Option[Int],
                                          skipped: Option[Boolean]): Option[Mission] = db.withSession {implicit session =>
    this.synchronized {
      if (actions.contains("updateProgress")) {
        updateValidationProgress(missionId.get, labelsProgress.get)
      }

      if (actions.contains("updateComplete")) {
        updateComplete(missionId.get)
        if (skipped.getOrElse(false)) {
          updateSkipped(missionId.get)
        }
      }

      if (actions.contains("getValidationMission") && labelTypeId.nonEmpty) {
        // Create or retrieve a mission with the passed in label type id
        getCurrentValidationMission(userId, labelTypeId.get) match {
          case Some(incompleteMission) =>
            Some(incompleteMission)
          case _ =>
            val labelsToValidate: Int = getNextValidationMissionLabelCount(userId)
            val pay: Double = labelsToValidate.toDouble * payPerLabel.get
            Some(createNextValidationMission(userId, pay, labelsToValidate, labelTypeId.get))
        }
      } else {
        None // If we are not trying to get a mission, return None
      }
    }
  }

  /**
    * Marks the given mission as complete and gets another mission in the given region if possible.
    *
    * @param userId
    * @param regionId
    * @param payPerMeter
    * @param missionId
    * @return
    */
  def updateCompleteAndGetNextMission(userId: UUID, regionId: Int, payPerMeter: Double, missionId: Int, skipped: Boolean): Option[Mission] = {
    val actions: List[String] = List("updateComplete", "getMission")
    queryMissionTable(actions, userId, Some(regionId), Some(payPerMeter), None, Some(false), Some(missionId), None, Some(skipped))
  }

  /**
    * Updates the given mission's progress, marks as complete and gets another mission in the given region if possible.
    *
    * @param userId
    * @param regionId
    * @param payPerMeter
    * @param missionId
    * @param distanceProgress
    * @return
    */
  def updateCompleteAndGetNextMission(userId: UUID, regionId: Int, payPerMeter: Double, missionId: Int, distanceProgress: Float, skipped: Boolean): Option[Mission] = {
    val actions: List[String] = List("updateProgress", "updateComplete", "getMission")
    queryMissionTable(actions, userId, Some(regionId), Some(payPerMeter), None, Some(false), Some(missionId), Some(distanceProgress), Some(skipped))
  }

  def updateCompleteAndGetNextValidationMission(userId: UUID, payPerLabel: Double, missionId: Int, labelsProgress: Int, labelTypeId: Option[Int], skipped: Boolean): Option[Mission] = {
    val actions: List[String] = List("updateProgress", "updateComplete", "getValidationMission")
    queryMissionTableValidationMissions(actions, userId, Some(payPerLabel), None, Some(false), Some(missionId), Some(labelsProgress), labelTypeId, Some(skipped))
  }

  /**
    * Updates the distance_progress column of a mission using the helper method to prevent race conditions.
    *
    * @param userId
    * @param missionId
    * @param distanceProgress
    * @return
    */
   def updateAuditProgressOnly(userId: UUID, missionId: Int, distanceProgress: Float): Option[Mission] = {
     val actions: List[String] = List("updateProgress")
     queryMissionTable(actions, userId, None, None, None, None, Some(missionId), Some(distanceProgress), None)
   }

  def updateValidationProgressOnly(userId: UUID, missionId: Int, labelsProgress: Int): Option[Mission] = {
    val actions: List[String] = List("updateProgress")
    queryMissionTableValidationMissions(actions, userId, None, None, None, Some(missionId), Some(labelsProgress), None, None)
  }

  /**
    * Gets auditOnboarding mission the user started in the region if one exists, o/w makes a new mission.
    *
    * @param userId
    * @param tutorialPay
    * @return
    */
   def resumeOrCreateNewAuditOnboardingMission(userId: UUID, tutorialPay: Double): Option[Mission] = {
     val actions: List[String] = List("getMission")
     queryMissionTable(actions, userId, None, None, Some(tutorialPay), Some(true), None, None, None)
   }

  /**
    * Gets mission the user started in the region if one exists, o/w makes a new mission; may create a tutorial mission.
    *
    * @param userId
    * @param regionId
    * @param payPerMeter
    * @param tutorialPay
    * @return
    */
   def resumeOrCreateNewAuditMission(userId: UUID, regionId: Int, payPerMeter: Double, tutorialPay: Double): Option[Mission] = {
     val actions: List[String] = List("getMission")
     queryMissionTable(actions, userId, Some(regionId), Some(payPerMeter), Some(tutorialPay), Some(false), None, None, None)
   }

  def resumeOrCreateNewValidationMission(userId: UUID, payPerLabel: Double, tutorialPay: Double, labelTypeId: Int): Option[Mission] = {
    val actions: List[String] = List("getValidationMission")
    queryMissionTableValidationMissions(actions, userId, Some(payPerLabel), Some(tutorialPay), Some(false), None, None, Some(labelTypeId), None)
  }

  /**
    * Get the suggested distance in meters for the next mission this user does in this region.
    *
    * @param userId
    * @param regionId
    * @return
    */
  def getNextAuditMissionDistance(userId: UUID, regionId: Int): Float = {
    val distRemaining: Float = AuditTaskTable.getUnauditedDistance(userId, regionId)
    val completedInRegion: Int = selectCompletedAuditMissionsByAUser(userId, regionId, includeOnboarding = false).length
    val naiveMissionDist: Float =
      if (completedInRegion >= distancesForFirstAuditMissions.length) distanceForLaterMissions
      else                                                            distancesForFirstAuditMissions(completedInRegion)
    math.min(distRemaining, naiveMissionDist)
  }

  /**
    * Gets the number of labels to be validated for a new mission. Currently returns 10 labels.
    * @param userId UserID of user requesting more labels.
    * @return 10
    */
  def getNextValidationMissionLabelCount(userId: UUID): Int = {
    validationMissionLabelCount
  }

  /**
    * Creates a new audit mission entry in mission table for the specified user/region id.
    *
    * @param userId
    * @param regionId
    * @param pay
    * @return
    */
  def createNextAuditMission(userId: UUID, pay: Double, distance: Float, regionId: Int): Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("audit")
    val newMission = Mission(0, missionTypeId, userId.toString, now, now, false, pay, false, Some(distance), Some(0.0.toFloat), Some(regionId), None, None, None, false)
    val missionId: Int = (missions returning missions.map(_.missionId)) += newMission
    missions.filter(_.missionId === missionId).list.head
  }

  /**
    * Creates and returns a new validation mission
    * @param userId     User ID
    * @param pay        Amount user is paid per label
    * @param labelsToValidate   Number of labels in this mission
    * @param labelType  Type of labels featured in this mission
    * @return
    */
  def createNextValidationMission(userId: UUID, pay: Double, labelsToValidate: Int, labelTypeId: Int) : Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("validation")
    val newMission = Mission(0, missionTypeId, userId.toString, now, now, false, pay, false, None, None, None, Some(labelsToValidate), Some(0.0.toInt), Some(labelTypeId), false)
    val missionId: Int = (missions returning missions.map(_.missionId)) += newMission
    missions.filter(_.missionId === missionId).list.head
  }

  /**
    * Creates and returns a new CV ground truth audit mission for a user.
    * @param userId user creating a new CV ground truth audit mission
    * @return
    */
  def createNextCVGroundtruthMission(userId: UUID) : Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("cvGroundTruth")
    val newMission: Mission = Mission(0, missionTypeId, userId.toString, now, now, false, 0, false, None, None, None, None, None, None, false)
    val missionId: Int = (missions returning missions.map(_.missionId)) += newMission
    missions.filter(_.missionId === missionId).list.head
  }

  /**
    * Creates a new auditOnboarding mission entry in the mission table for the specified user.
    *
    * @param userId
    * @param pay
    * @return
    */
  def createAuditOnboardingMission(userId: UUID, pay: Double): Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val mTypeId: Int = MissionTypeTable.missionTypeToId("auditOnboarding")
    val newMiss = Mission(0, mTypeId, userId.toString, now, now, false, pay, false, None, None, None, None, None, None, false)
    val missionId: Int = (missions returning missions.map(_.missionId)) += newMiss
    missions.filter(_.missionId === missionId).list.head
  }

  /**
    * Marks the specified mission as complete, filling in mission_end timestamp.
    *
    * @param missionId
    * @return Int number of rows updated (should always be 1).
    */
  def updateComplete(missionId: Int): Int = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield (m.completed, m.missionEnd)
    val rowsUpdated: Int = missionToUpdate.update((true, now))
    if (rowsUpdated == 0) Logger.error("Tried to mark a mission as complete, but no mission exists with that ID.")
    rowsUpdated
  }

  /**
    * Marks the specifed mission as skipped.
    *
    * @param missionId
    * @return
    */
  def updateSkipped(missionId: Int): Int = db.withSession { implicit session =>
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield m.skipped
    val rowsUpdated: Int = missionToUpdate.update(true)
    if (rowsUpdated == 0) Logger.error("Tried to mark a mission as skipped, but no mission exists with that ID.")
    rowsUpdated
  }

  /**
    * Updates the distance_progress column of a mission.
    *
    * @param missionId
    * @param distanceProgress
    * @return Int number of rows updated (should always be 1 if successful, 0 otherwise).
    */
  def updateAuditProgress(missionId: Int, distanceProgress: Float): Int = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionList: List[Option[Float]] = missions.filter(_.missionId === missionId).map(_.distanceMeters).list

    (missionList, missionList.head) match {
      case (x :: _, Some(_)) =>
        val missionDistance: Float = missionList.head.get
        val missionToUpdate: Query[(Column[Option[Float]], Column[Timestamp]), (Option[Float], Timestamp), Seq] = for {
          m <- missions if m.missionId === missionId
        } yield (m.distanceProgress, m.missionEnd)

        if (~= (distanceProgress, missionDistance, precision = 0.00001F) ) {
          missionToUpdate.update ((Some (missionDistance), now) )
        } else if (distanceProgress < missionDistance) {
          missionToUpdate.update ((Some (distanceProgress), now) )
        } else {
          Logger.error ("Trying to update mission progress with distance greater than total mission distance.")
          missionToUpdate.update ((Some (missionDistance), now) )
        }
      case _ => 0
    }
  }

  def updateValidationProgress(missionId: Int, labelsProgress: Int): Int = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionLabels: Int = missions.filter(_.missionId === missionId).map(_.labelsValidated).list.head.get
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield (m.labelsProgress, m.missionEnd)

    if (labelsProgress <= missionLabels) {
      missionToUpdate.update((Some(labelsProgress), now))
    } else {
      Logger.error("[MissionTable] updateValidationProgress: Trying to update mission progress with labels greater than total mission labels.")
      missionToUpdate.update((Some(missionLabels), now))
    }
  }

  // Approximate equality check for Floats
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Float, y: Float, precision: Float): Boolean = { // Approximate equality check for Floats
    val diff: Float = x - y
    if (diff.abs < precision) true else false
  }
}
