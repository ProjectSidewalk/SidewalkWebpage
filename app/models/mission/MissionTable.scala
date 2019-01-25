package models.mission

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.audit.AuditTaskTable
import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.utils.MyPostgresDriver.api._
import models.region._
import models.user.{ RoleTable, UserRoleTable }
import play.api.Logger
import play.api.libs.json.{ JsObject, Json }
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile

import scala.concurrent.{ Await, Future }
import slick.jdbc.GetResult

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.Duration

case class RegionalMission(missionId: Int, missionType: String, regionId: Option[Int], regionName: Option[String],
  distanceMeters: Option[Float], labelsValidated: Option[Int])

case class Mission(missionId: Int, missionTypeId: Int, userId: String, missionStart: Timestamp, missionEnd: Timestamp,
  completed: Boolean, pay: Double, paid: Boolean, distanceMeters: Option[Float],
  distanceProgress: Option[Float], regionId: Option[Int], labelsValidated: Option[Int],
  labelsProgress: Option[Int], skipped: Boolean) {

  def toJSON: JsObject = {
    val missionType = Await.result(MissionTypeTable.missionTypeIdToMissionType(missionTypeId), Duration.Inf) //FIXME
    Json.obj(
      "mission_id" -> missionId,
      "mission_type" -> missionType,
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
      "skipped" -> skipped)
  }
}

class MissionTable(tag: Tag) extends Table[Mission](tag, Some("sidewalk"), "mission") {
  def missionId: Rep[Int] = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def missionTypeId: Rep[Int] = column[Int]("mission_type_id")
  def userId: Rep[String] = column[String]("user_id")
  def missionStart: Rep[Timestamp] = column[Timestamp]("mission_start")
  def missionEnd: Rep[Timestamp] = column[Timestamp]("mission_end")
  def completed: Rep[Boolean] = column[Boolean]("completed")
  def pay: Rep[Double] = column[Double]("pay")
  def paid: Rep[Boolean] = column[Boolean]("paid")
  def distanceMeters: Rep[Option[Float]] = column[Option[Float]]("distance_meters")
  def distanceProgress: Rep[Option[Float]] = column[Option[Float]]("distance_progress")
  def regionId: Rep[Option[Int]] = column[Option[Int]]("region_id")
  def labelsValidated: Rep[Option[Int]] = column[Option[Int]]("labels_validated")
  def labelsProgress: Rep[Option[Int]] = column[Option[Int]]("labels_progress")
  def skipped: Rep[Boolean] = column[Boolean]("skipped")

  def * = (missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters, distanceProgress, regionId, labelsValidated, labelsProgress, skipped) <> ((Mission.apply _).tupled, Mission.unapply)

  def missionType = foreignKey("mission_mission_type_id_fkey", missionTypeId, TableQuery[MissionTypeTable])(_.missionTypeId)

  def user = foreignKey("mission_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def region = foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId.?)
}

object MissionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
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
    val skipped: Boolean = r.nextBoolean
    Mission(missionId, missionTypeId, userId, missionStart, missionEnd, completed, pay, paid, distanceMeters,
      distanceProgress, regionId, labelsValidated, labelsProgress, skipped)
  })

  /**
   * Count the number of missions completed by a user.
   *
   * @param userId
   * @param includeOnboarding should any onboarding missions be included in this count
   * @return
   */
  def countCompletedMissionsByUserId(userId: UUID, includeOnboarding: Boolean): Future[Int] =
    selectCompletedMissionsByAUser(userId, includeOnboarding).map(_.size)

  /**
   * Check if the user has completed onboarding.
   *
   * @param userId
   * @return
   */
  def hasCompletedAuditOnboarding(userId: UUID): Future[Boolean] = {
    for {
      missions <- selectCompletedMissionsByAUser(userId, includeOnboarding = true)
      missionTypeId <- MissionTypeTable.missionTypeToId("auditOnboarding")
    } yield {
      missions.exists(_.missionTypeId == missionTypeId)
    }
  }

  /**
   * Checks if the specified mission is an onboarding mission.
   *
   * @param missionId
   * @return
   */
  def isOnboardingMission(missionId: Int): Future[Boolean] = {
    db.run(
      missions.filter(_.missionId === missionId).map(_.missionTypeId).result.head).flatMap { missionTypeId =>
        MissionTypeTable.onboardingTypeIds.map(_.contains(missionTypeId))
      }
  }

  /**
   * Get a list of all the missions completed by the user.
   *
   * @param userId User's UUID
   * @param includeOnboarding should any onboarding missions be included
   * @return
   */
  def selectCompletedMissionsByAUser(userId: UUID, includeOnboarding: Boolean): Future[List[Mission]] = {
    MissionTypeTable.onboardingTypeIds.flatMap { onboardingTypeIds =>
      val _missions = if (includeOnboarding) {
        missions.filter(m => m.userId === userId.toString && m.completed)
      } else {
        missions.filter(m => m.userId === userId.toString && m.completed)
          .filterNot(_.missionTypeId inSet onboardingTypeIds)
      }
      db.run(
        _missions /*.groupBy(_.missionId).map(_._2.head)*/ .to[List].result)
    }
  }

  /**
   * Get the user's incomplete mission in the region if there is one.
   *
   * @param userId
   * @param regionId
   * @return
   */
  def getCurrentMissionInRegion(userId: UUID, regionId: Int): Future[Option[Mission]] = db.run(
    missions.filter(m => m.userId === userId.toString && m.regionId === regionId && !m.completed).result.headOption)

  /**
   * Get the user's incomplete auditOnboarding mission if there is one.
   * @param userId
   * @return
   */
  def getIncompleteAuditOnboardingMission(userId: UUID): Future[Option[Mission]] = {
    db.run(
      missionTypes.filter(_.missionType === "auditOnboarding").map(_.missionTypeId).result.head).flatMap { tutorialId =>
        db.run(
          missions.filter(m => m.userId === userId.toString && m.missionTypeId === tutorialId && !m.completed).result.headOption)
      }
  }

  /**
   * Get the list of the completed audit missions in the given region for the given user.
   *
   * @param userId User's UUID
   * @param regionId region Id
   * @param includeOnboarding should region-less onboarding mission be included if complete
   * @return
   */
  def selectCompletedAuditMissionsByAUser(userId: UUID, regionId: Int, includeOnboarding: Boolean): Future[List[Mission]] = {
    val auditMissionTypes: List[String] = if (includeOnboarding) List("audit", "auditOnboarding") else List("audit")
    db.run(
      missionTypes.filter(_.missionType inSet auditMissionTypes).map(_.missionTypeId).result).flatMap { auditMissionTypeIds =>
        db.run(
          missions.filter(m => m.userId === userId.toString
            && (m.missionTypeId inSet auditMissionTypeIds)
            && (m.regionId === regionId || m.regionId.isEmpty)
            && m.completed === true).to[List].result)
      }
  }

  /**
   * Select missions with neighborhood names.
   *
   * @param userId
   * @return
   */
  def selectCompletedRegionalMissions(userId: UUID): Future[List[RegionalMission]] = {
    db.run({
      val userMissions = missions.filter(_.userId === userId.toString)

      val missionsWithRegionName = for {
        (_m, _rp) <- userMissions.joinLeft(RegionPropertyTable.neighborhoodNames).on(_.regionId === _.regionId)
      } yield (_m.missionId, _m.missionTypeId, _m.regionId, _rp.map(_.value), _m.distanceMeters, _m.labelsValidated)

      missionsWithRegionName.to[List].result
    }).flatMap { missions =>
      val regionalMission = missions.map(m =>
        MissionTypeTable.missionTypeIdToMissionType(m._2).map { missionType =>
          RegionalMission(m._1, missionType, m._3, m._4, m._5, m._6)
        })
      Future.sequence(regionalMission)
        .map(_.sortBy(rm => (rm.regionId, rm.missionId)))
    }
  }

  /**
   * Returns all the missions.
   *
   * @return A list of Mission objects.
   */
  def selectMissions: Future[List[Mission]] = db.run(missions.to[List].result)

  /**
   * Select mission counts by user.
   *
   * @return List[(user_id, role, count)]
   */
  def selectMissionCountsPerUser: Future[List[(String, String, Int)]] = {
    val userMissions = for {
      _user <- users if _user.username =!= "anonymous"
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roles if _userRole.roleId === _role.roleId
      _mission <- missions if _user.userId === _mission.userId
      _missionType <- missionTypes if _mission.missionTypeId === _missionType.missionTypeId
      if _missionType.missionType =!= "auditOnboarding"
    } yield (_user.userId, _role.role, _mission.missionId)

    db.run(
      // Count missions per user by grouping by (user_id, role).
      userMissions.groupBy(m => (m._1, m._2)).map { case ((uId, role), group) => (uId, role, group.length) }.to[List].result)
  }

  /**
   * Counts up total reward earned from completed missions for the user.
   *
   * @param userId
   * @return
   */
  def totalRewardEarned(userId: UUID): Future[Double] = db.run(
    missions.filter(m => m.userId === userId.toString && m.completed).map(_.pay).sum.result).map(_.getOrElse(0.0D))

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
    distanceProgress: Option[Float], skipped: Option[Boolean]): Future[Option[Mission]] = {
    this.synchronized {
      var updateAuditProgressFuture: Future[Int] = Future.successful(0)
      var updateCompleteFuture: Future[Int] = Future.successful(0)
      var updateSkippedFuture: Future[Int] = Future.successful(0)

      if (actions.contains("updateProgress")) {
        updateAuditProgressFuture = updateAuditProgress(missionId.get, distanceProgress.get)
      }
      if (actions.contains("updateComplete")) {
        updateCompleteFuture = updateComplete(missionId.get)
        if (skipped.getOrElse(false)) {
          updateSkippedFuture = updateSkipped(missionId.get)
        }
      }

      (for {
        _ <- updateAuditProgressFuture
        _ <- updateCompleteFuture
        _ <- updateSkippedFuture
      } yield 1).flatMap { _ =>
        if (actions.contains("getMission")) {
          hasCompletedAuditOnboarding(userId).flatMap { hasCompletedAuditOnboarding =>
            // If they still need to do tutorial or are retaking it.
            if (!hasCompletedAuditOnboarding || retakingTutorial.get) {
              // If there is already an incomplete tutorial mission in the table then grab it, o/w make a new one.
              getIncompleteAuditOnboardingMission(userId).flatMap {
                case Some(incompleteOnboardingMission) =>
                  Future.successful(Some(incompleteOnboardingMission))
                case _ => createAuditOnboardingMission(userId, tutorialPay.get)
                  .map(Some(_))
              }
            } else {
              // Non-tutorial mission: if there is an incomplete one in the table then grab it, o/w make a new one.
              getCurrentMissionInRegion(userId, regionId.get).flatMap {
                case Some(incompleteMission) => Future.successful(Some(incompleteMission))
                case _ =>
                  getNextAuditMissionDistance(userId, regionId.get).flatMap { nextMissionDistance =>
                    if (nextMissionDistance > 0) {
                      val pay: Double = nextMissionDistance.toDouble * payPerMeter.get
                      createNextAuditMission(userId, pay, nextMissionDistance, regionId.get).map(Some(_))
                    } else {
                      Future.successful(None)
                    }
                  }
              }
            }
          }
        } else {
          Future.successful(None) // If we are not trying to get a mission, return None
        }
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
  def updateCompleteAndGetNextMission(userId: UUID, regionId: Int, payPerMeter: Double, missionId: Int, skipped: Boolean): Future[Option[Mission]] = {
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
  def updateCompleteAndGetNextMission(userId: UUID, regionId: Int, payPerMeter: Double, missionId: Int, distanceProgress: Float, skipped: Boolean): Future[Option[Mission]] = {
    val actions: List[String] = List("updateProgress", "updateComplete", "getMission")
    queryMissionTable(actions, userId, Some(regionId), Some(payPerMeter), None, Some(false), Some(missionId), Some(distanceProgress), Some(skipped))
  }

  /**
   * Updates the distance_progress column of a mission using the helper method to prevent race conditions.
   *
   * @param userId
   * @param missionId
   * @param distanceProgress
   * @return
   */
  def updateAuditProgressOnly(userId: UUID, missionId: Int, distanceProgress: Float): Future[Option[Mission]] = {
    val actions: List[String] = List("updateProgress")
    queryMissionTable(actions, userId, None, None, None, None, Some(missionId), Some(distanceProgress), None)
  }

  /**
   * Gets auditOnboarding mission the user started in the region if one exists, o/w makes a new mission.
   *
   * @param userId
   * @param tutorialPay
   * @return
   */
  def resumeOrCreateNewAuditOnboardingMission(userId: UUID, tutorialPay: Double): Future[Option[Mission]] = {
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
  def resumeOrCreateNewAuditMission(userId: UUID, regionId: Int, payPerMeter: Double, tutorialPay: Double): Future[Option[Mission]] = {
    val actions: List[String] = List("getMission")
    queryMissionTable(actions, userId, Some(regionId), Some(payPerMeter), Some(tutorialPay), Some(false), None, None, None)
  }

  /**
   * Get the suggested distance in meters for the next mission this user does in this region.
   *
   * @param userId
   * @param regionId
   * @return
   */
  def getNextAuditMissionDistance(userId: UUID, regionId: Int): Future[Float] = {
    for {
      distRemaining <- AuditTaskTable.getUnauditedDistance(userId, regionId)
      completedInRegion <- selectCompletedAuditMissionsByAUser(userId, regionId, includeOnboarding = false)
    } yield {
      val naiveMissionDist: Float =
        if (completedInRegion.length >= distancesForFirstAuditMissions.length) distanceForLaterMissions
        else distancesForFirstAuditMissions(completedInRegion.length)
      math.min(distRemaining.head /*FIXME*/ , naiveMissionDist)
    }
  }

  /**
   * Creates a new audit mission entry in mission table for the specified user/region id.
   *
   * @param userId
   * @param regionId
   * @param pay
   * @return
   */
  def createNextAuditMission(userId: UUID, pay: Double, distance: Float, regionId: Int): Future[Mission] = {
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    MissionTypeTable.missionTypeToId("audit").flatMap { missionTypeId =>
      val newMission = Mission(0, missionTypeId, userId.toString, now, now, false, pay, false, Some(distance), Some(0.0.toFloat), Some(regionId), None, None, false)
      db.run(
        ((missions returning missions.map(_.missionId)) += newMission).transactionally)
    }.flatMap { missionId =>
      db.run(
        missions.filter(_.missionId === missionId).result.head)
    }
  }

  /**
   * Creates a new auditOnboarding mission entry in the mission table for the specified user.
   *
   * @param userId
   * @param pay
   * @return
   */
  def createAuditOnboardingMission(userId: UUID, pay: Double): Future[Mission] = {
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    MissionTypeTable.missionTypeToId("auditOnboarding")
      .flatMap { mTypeId =>
        val newMiss = Mission(0, mTypeId, userId.toString, now, now, false, pay, false, None, None, None, None, None, false)
        db.run(
          ((missions returning missions.map(_.missionId)) += newMiss).transactionally)
      }.flatMap { missionId =>
        db.run(
          missions.filter(_.missionId === missionId).result.head)
      }
  }

  /**
   * Marks the specified mission as complete, filling in mission_end timestamp.
   *
   * @param missionId
   * @return Int number of rows updated (should always be 1).
   */
  def updateComplete(missionId: Int): Future[Int] = {
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    db.run({
      val missionToUpdate = for { m <- missions if m.missionId === missionId } yield (m.completed, m.missionEnd)
      missionToUpdate.update((true, now)).transactionally
    }).map { rowsUpdated =>
      if (rowsUpdated == 0)
        Logger.error("Tried to mark a mission as complete, but no mission exists with that ID.")
      rowsUpdated
    }
  }

  /**
   * Marks the specifed mission as skipped.
   *
   * @param missionId
   * @return
   */
  def updateSkipped(missionId: Int): Future[Int] = {
    db.run({
      val missionToUpdate = for { m <- missions if m.missionId === missionId } yield m.skipped
      missionToUpdate.update(true).transactionally
    }).map { rowsUpdated =>
      if (rowsUpdated == 0)
        Logger.error("Tried to mark a mission as skipped, but no mission exists with that ID.")
      rowsUpdated
    }
  }

  /**
   * Updates the distance_progress column of a mission.
   *
   * @param missionId
   * @param distanceProgress
   * @return Int number of rows updated (should always be 1).
   */
  def updateAuditProgress(missionId: Int, distanceProgress: Float): Future[Int] = {
    val now: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val missionToUpdate = for { m <- missions if m.missionId === missionId } yield (m.distanceProgress, m.missionEnd)

    // TODO maybe deal with empty list and null distanceMeters column.
    db.run(
      missions.filter(_.missionId === missionId).map(_.distanceMeters).result.head).flatMap { missionDistanceOpt =>
        val missionDistance = missionDistanceOpt.get
        db.run({
          if (~=(distanceProgress, missionDistance, precision = 0.00001F)) {
            missionToUpdate.update((Some(missionDistance), now))
          } else if (distanceProgress < missionDistance) {
            missionToUpdate.update((Some(distanceProgress), now))
          } else {
            Logger.error("Trying to update mission progress with distance greater than total mission distance.")
            missionToUpdate.update((Some(missionDistance), now))
          }
        }.transactionally)
      }
  }

  // Approximate equality check for Floats
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Float, y: Float, precision: Float): Boolean = { // Approximate equality check for Floats
    val diff: Float = x - y
    if (diff.abs < precision) true else false
  }
}
