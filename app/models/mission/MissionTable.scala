package models.mission

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import models.region._
import models.user.{RoleTable, UserRoleTable}
import play.api.Logger
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.GetResult

case class RegionalMission(missionId: Int, missionType: String, regionId: Option[Int], regionName: Option[String],
                           distanceMeters: Option[Float], labelsValidated: Option[Int])

case class Mission(missionId: Int, missionTypeId: Int, userId: String, missionStart: Timestamp, missionEnd: Timestamp,
                   completed: Boolean, pay: Double, paid: Boolean, distanceMeters: Option[Float],
                   distanceProgress: Option[Float], regionId: Option[Int], labelsValidated: Option[Int],
                   labelsProgress: Option[Int]) {

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
      "labels_progress" -> labelsProgress
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

  def * = (missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters, distanceProgress, regionId, labelsValidated, labelsProgress) <> ((Mission.apply _).tupled, Mission.unapply)

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

  // Distances for first few missions: 500ft, 500ft, 1000ft, 1000ft, then 1/4 mile for all remaining. This is just a
  // temporary setup for that sake of testing the new missions infrastructure.
  val distancesForFirstAuditMissions: List[Float] = List(152.4F, 152.4F, 304.8F, 304.8F)
  val distanceForLaterMissions: Float = 402.336F // 1/4 mile


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
    Mission(missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters,
            distanceProgress, regionId, labelsValidated, labelsProgress)
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
    * Creates a new audit mission entry in mission table for the specified user/region id.
    *
    * TODO look at all instances of this to check that payment is being filled correctly for turkers.
    *
    * @param userId
    * @param regionId
    * @param pay
    * @return
    */
  def createNextAuditMission(userId: UUID, pay: Double, distance: Float, regionId: Int): Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("audit")
    val newMission = Mission(0, missionTypeId, userId.toString, now, now, false, pay, false, Some(distance), Some(0.0.toFloat), Some(regionId), None, None)
    val missionId: Int = (missions returning missions.map(_.missionId)) += newMission
    missions.filter(_.missionId === missionId).list.head
  }

  /**
    * Creates a new auditOnboarding mission entry in the mission table for the specified user.
    *
    * TODO look at all instances of this to check that payment is being filled correctly for turkers.
    *
    * @param userId
    * @param pay
    * @return
    */
  def createAuditOnboardingMission(userId: UUID, pay: Double): Mission = db.withSession { implicit session =>
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionTypeId: Int = MissionTypeTable.missionTypeToId("auditOnboarding")
    val newMiss = Mission(0, missionTypeId, userId.toString, now, now, false, pay, false, None, None, None, None, None)
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
    * Updates the distance_progress column of a mission.
    *
    * @param missionId
    * @param distanceProgress
    * @return Int number of rows updated (should always be 1).
    */
  def updateAuditProgress(missionId: Int, distanceProgress: Float): Int = db.withSession { implicit session =>
    // TODO maybe deal with empty list and null distanceMeters column.
    val missionDistance: Float = missions.filter(_.missionId === missionId).map(_.distanceMeters).list.head.get
    val distToUpdate = for { m <- missions if m.missionId === missionId } yield m.distanceProgress

    if (~=(distanceProgress, missionDistance, precision = 0.00001F)) {
      distToUpdate.update(Some(missionDistance))
    } else if (distanceProgress < missionDistance) {
      distToUpdate.update(Some(distanceProgress))
    } else {
      Logger.error("Trying to update mission progress with distance greater than total mission distance.")
      distToUpdate.update(Some(missionDistance))
    }
  }

  // Approximate equality check for Floats
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Float, y: Float, precision: Float): Boolean = { // Approximate equality check for Floats
    val diff: Float = x - y
    if (diff.abs < precision) true else false
  }
}
