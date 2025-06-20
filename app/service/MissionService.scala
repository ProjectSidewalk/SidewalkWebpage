package service

import com.google.inject.ImplementedBy
import formats.json.ExploreFormats.AuditMissionProgress
import formats.json.ValidateFormats.ValidationMissionProgress
import models.audit.AuditTaskTable
import models.mission.MissionTable.{distanceForLaterMissions, distancesForFirstAuditMissions}
import models.mission.{Mission, MissionTable}
import models.user.SidewalkUserWithRole
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.Logger
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[MissionServiceImpl])
trait MissionService {
  def updateExploreProgressOnly(userId: String, missionId: Int, distanceProgress: Float, auditTaskId: Option[Int]): DBIO[Option[Mission]]
  def resumeOrCreateNewAuditOnboardingMission(userId: String): DBIO[Option[Mission]]
  def resumeOrCreateNewAuditMission(userId: String, regionId: Int): DBIO[Option[Mission]]
  def resumeOrCreateNewValidationMission(userId: String, missionType: String, labelTypeId: Int): Future[Option[Mission]]
  def updateCompleteAndGetNextValidationMission(userId: String, missionId: Int, missionType: String, labelsProgress: Int, labelTypeId: Option[Int], skipped: Boolean): Future[Option[Mission]]
  def updateValidationProgressOnly(userId: String, missionId: Int, labelsProgress: Int, labelsTotal: Int): Future[Option[Mission]]
  def updateMissionTableValidate(user: SidewalkUserWithRole, missionProgress: ValidationMissionProgress, nextMissionLabelTypeId: Option[Int]): Future[Option[Mission]]
  def updateMissionTableExplore(userId: String, regionId: Int, missionProgress: AuditMissionProgress): DBIO[Option[Mission]]
  def getUserMissionsInRegion(userId: String, regionId: Int): Future[Seq[Mission]]
}

@Singleton
class MissionServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                   missionTable: MissionTable,
                                   auditTaskTable: AuditTaskTable,
                                   implicit val ec: ExecutionContext
                                  ) extends MissionService with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)
  /**
   * Marks the given mission as complete and gets another mission in the given region if possible.
   */
  def updateCompleteAndGetNextMission(userId: String, regionId: Int, missionId: Int, skipped: Boolean): DBIO[Option[Mission]] = {
    val actions: Seq[String] = Seq("updateComplete", "getMission")
    queryMissionTableExploreMissions(actions, userId, Some(regionId), Some(false), Some(missionId), None, None, Some(skipped))
  }

  /**
   * Updates the given mission's progress, marks as complete and gets another mission in the given region if possible.
   */
  def updateCompleteAndGetNextMission(userId: String, regionId: Int, missionId: Int, distanceProgress: Float, auditTaskId: Option[Int], skipped: Boolean): DBIO[Option[Mission]] = {
    val actions: Seq[String] = Seq("updateProgress", "updateComplete", "getMission")
    queryMissionTableExploreMissions(actions, userId, Some(regionId), Some(false), Some(missionId), Some(distanceProgress), auditTaskId, Some(skipped))
  }

  /**
   * Updates the distance_progress column of a mission using the helper method to prevent race conditions.
   */
  def updateExploreProgressOnly(userId: String, missionId: Int, distanceProgress: Float, auditTaskId: Option[Int]): DBIO[Option[Mission]] = {
    val actions: Seq[String] = Seq("updateProgress")
    queryMissionTableExploreMissions(actions, userId, None, None, Some(missionId), Some(distanceProgress), auditTaskId, None)
   }

  /**
   * Gets auditOnboarding mission the user started in the region if one exists, o/w makes a new mission.
   */
  def resumeOrCreateNewAuditOnboardingMission(userId: String): DBIO[Option[Mission]] = {
    val actions: Seq[String] = Seq("getMission")
    queryMissionTableExploreMissions(actions, userId, None, Some(true), None, None, None, None)
  }

  /**
   * Gets mission the user started in the region if one exists, o/w makes a new mission; may create a tutorial mission.
   */
  def resumeOrCreateNewAuditMission(userId: String, regionId: Int): DBIO[Option[Mission]] = {
    val actions: Seq[String] = Seq("getMission")
    queryMissionTableExploreMissions(actions, userId, Some(regionId), Some(false), None, None, None, None)
  }

  /**
   * Provides functionality for accessing mission table while a user is auditing while preventing race conditions.
   *
   * TODO: This function used to be in a synchronized block to prevent race conditions. Since upgrading our back end
   *       libraries, we could likely get around this by just using transactions. Not sure if this method is still
   *       useful as a single point of entry for editing the mission table. Former description kept below.
   *
   * The mission table functionality that is required while a user is auditing is all wrapped up into this function in
   * a synchronized block to prevent race conditions that were happening otherwise. Functionality includes retrieving
   * partially completed missions, updating the progress of a mission, marking a mission as complete, and creating a
   * new mission. These all work for both "audit" and "auditOnboarding" missions.
   *
   * @param actions Seq containing one or more of "updateProgress", "updateComplete", or "getMission"; required.
   * @param userId Always required.
   * @param regionId Only required if actions contains "getMission".
   * @param retakingTutorial Only required if actions contains "getMissions".
   * @param missionId Only required if actions contains "updateProgress" or "updateComplete".
   * @param distanceProgress Only required if actions contains "updateProgress".
   */
  private def queryMissionTableExploreMissions(actions: Seq[String], userId: String, regionId: Option[Int],
                                               retakingTutorial: Option[Boolean], missionId: Option[Int],
                                               distanceProgress: Option[Float], auditTaskId: Option[Int],
                                               skipped: Option[Boolean]): DBIO[Option[Mission]] = {

    val updateProgressAction = if (actions.contains("updateProgress")) {
      missionTable.updateExploreProgress(missionId.get, distanceProgress.get, auditTaskId)
    } else {
      DBIO.successful(0)
    }

    val updateCompleteAction = if (actions.contains("updateComplete")) {
      val completeAction = missionTable.updateComplete(missionId.get)
      if (skipped.getOrElse(false)) {
        completeAction.flatMap(_ => missionTable.updateSkipped(missionId.get))
      } else {
        completeAction
      }
    } else {
      DBIO.successful(0)
    }

    val getMissionAction = if (actions.contains("getMission")) {
      missionTable.hasCompletedAuditOnboarding(userId).flatMap { completedOnboarding =>
        // If they still need to do tutorial or are retaking it.
        if (!completedOnboarding || retakingTutorial.get) {
          // If there is already an incomplete tutorial mission in the table then grab it, o/w make a new one.
          missionTable.getIncompleteAuditOnboardingMission(userId).flatMap {
            case Some(incompleteOnboardingMission) => DBIO.successful(Some(incompleteOnboardingMission))
            case _ => missionTable.createAuditOnboardingMission(userId).map(Some(_))
          }
        } else {
          // Non-tutorial mission: if there is an incomplete one in the table then grab it, o/w make a new one.
          missionTable.getCurrentMissionInRegion(userId, regionId.get).flatMap {
            case Some(incompleteMission) => DBIO.successful(Some(incompleteMission))
            case _ =>
              getNextAuditMissionDistance(userId, regionId.get).flatMap { nextMissionDistance =>
                if (nextMissionDistance > 0) {
                  missionTable.createNextAuditMission(userId, nextMissionDistance, regionId.get).map(Some(_))
                } else {
                  DBIO.successful(None)
                }
              }
          }
        }
      }
    } else {
      DBIO.successful(None) // If we are not trying to get a mission, return None.
    }

    val combinedAction = for {
      _ <- updateProgressAction
      _ <- updateCompleteAction
      result <- getMissionAction
    } yield result

    combinedAction.transactionally
  }

  /**
   * Get the suggested distance in meters for the next mission this user does in this region.
   */
  private def getNextAuditMissionDistance(userId: String, regionId: Int): DBIO[Float] = {
    for {
      distRemaining: Float <- auditTaskTable.getUnauditedDistance(userId, regionId)
      completedInRegion: Int <- missionTable.selectCompletedExploreMissions(userId, regionId).map(_.length)
    } yield {
      val naiveMissionDist: Float =
        if (completedInRegion >= distancesForFirstAuditMissions.length) distanceForLaterMissions
        else                                                            distancesForFirstAuditMissions(completedInRegion)
      math.min(distRemaining, naiveMissionDist)
    }
  }

  /**
   * Either resumes or creates a new validation mission.
   * @param userId       User ID
   * @param missionType  Name of the mission type of the current validation mission {validation, labelmapValidation}
   * @param labelTypeId  Label Type ID to be validated for the next mission {1: cr, 2: mcr, 3: obs in path, 4: sfcp, 7: no sdwlk}
   */
  def resumeOrCreateNewValidationMission(userId: String, missionType: String, labelTypeId: Int): Future[Option[Mission]] = {
    val actions: Seq[String] = Seq("getValidationMission")
    queryMissionTableValidationMissions(actions, userId, None, Some(missionType), None, Some(labelTypeId), None)
  }

  /**
   * Updates the current validation mission and returns a new validation mission.
   * @param userId           User ID of the current user
   * @param missionId        Mission ID for the current mission
   * @param missionType      Type of validation mission {validation, labelmapValidation}
   * @param labelsProgress   Number of labels the user validated
   * @param labelTypeId      ID of the label type that was validated during this mission.
   * @param skipped          Whether this mission was skipped (default: false)
   */
  def updateCompleteAndGetNextValidationMission(userId: String, missionId: Int, missionType: String, labelsProgress: Int, labelTypeId: Option[Int], skipped: Boolean): Future[Option[Mission]] = {
    val actions: Seq[String] = Seq("updateProgress", "updateComplete", "getValidationMission")
    queryMissionTableValidationMissions(actions, userId, Some(missionId), Some(missionType), Some(labelsProgress), labelTypeId, Some(skipped))
  }

  /**
   * Updates labels_progress column of a mission using the helper method to prevent race conditions.
   *
   * Also marks the mission as complete if the user has validated all the labels. Added this to try and prevent a bug
   * where missions would have 10 out of 10 labels validated but still be marked as incomplete.
   * https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3789
   */
  def updateValidationProgressOnly(userId: String, missionId: Int, labelsProgress: Int, labelsTotal: Int): Future[Option[Mission]] = {
    val actions: Seq[String] =
      if (labelsProgress >= labelsTotal) Seq("updateProgress", "updateComplete") else Seq("updateProgress")
    queryMissionTableValidationMissions(actions, userId, Some(missionId), None, Some(labelsProgress), None, None)
  }

  /**
   * Provides functionality for accessing the mission table while the user is validating.
   * @param actions            Seq of actions to perform.
   * @param userId             User ID
   * @param missionId          The mission ID to be updated.
   * @param missionType        Type of validation mission {validation, labelmapValidation}
   * @param labelsProgress     Numbers of labels that have been validated {1: cr, 2: mcr, 3: obs in path, 4: sfcp, 7: no sdwlk}
   * @param labelTypeId        Label Type ID to be validated for the next mission
   * @param skipped            Indicates whether this mission has been skipped (not fully implemented)
   */
  private def queryMissionTableValidationMissions(actions: Seq[String], userId: String,
                                                  missionId: Option[Int], missionType: Option[String],
                                                  labelsProgress: Option[Int], labelTypeId: Option[Int],
                                                  skipped: Option[Boolean]): Future[Option[Mission]] = {

    val updateProgressAction = if (actions.contains("updateProgress")) {
      (missionId, labelsProgress) match {
        case (Some(mid), Some(progress)) =>
          missionTable.updateValidationProgress(mid, progress)
        case _ => DBIO.successful(0)
      }
    } else {
      DBIO.successful(0)
    }

    val updateCompleteAction = if (actions.contains("updateComplete")) {
      val completeAction = missionTable.updateComplete(missionId.get)
      if (skipped.getOrElse(false)) {
        completeAction.flatMap(_ => missionTable.updateSkipped(missionId.get))
      } else {
        completeAction
      }
    } else {
      DBIO.successful(0)
    }

    // Create or retrieve a mission with the passed in label type id.
    val getMissionValidationAction = if (actions.contains("getValidationMission") && labelTypeId.nonEmpty && missionType.nonEmpty) {
      for {
        currentMission <- missionTable.getCurrentValidationMission(userId, labelTypeId.get, missionType.get)
        result <- currentMission match {
          case Some(mission) => DBIO.successful(Some(mission))
          case None =>
            val labelsToValidate: Int = missionTable.getNextValidationMissionLength(missionType.get)
            missionTable.createNextValidationMission(userId, labelsToValidate, labelTypeId.get, missionType.get).map(Some(_))
        }
      } yield result
    } else {
      DBIO.successful(None)
    }

    val combinedAction = for {
      _ <- updateProgressAction
      _ <- updateCompleteAction
      result <- getMissionValidationAction
    } yield result

    db.run(combinedAction.transactionally)
  }

  /**
   * Updates the MissionTable. If the current mission is completed, then retrieves a new mission.
   * @param user                     User ID
   * @param missionProgress          Metadata for this mission
   * @param nextMissionLabelTypeId   Label Type ID for the next mission
   */
  def updateMissionTableValidate(user: SidewalkUserWithRole, missionProgress: ValidationMissionProgress, nextMissionLabelTypeId: Option[Int]): Future[Option[Mission]] = {
    val missionId: Int = missionProgress.missionId
    val skipped: Boolean = missionProgress.skipped
    val userId: String = user.userId
    val labelsProgress: Int = missionProgress.labelsProgress

    if (missionProgress.completed) {
      updateCompleteAndGetNextValidationMission(userId, missionId, missionProgress.missionType, labelsProgress, nextMissionLabelTypeId, skipped)
    } else {
      updateValidationProgressOnly(userId, missionId, labelsProgress, missionProgress.labelsTotal)
    }
  }

  /**
   * Updates the progress of the audit mission in the database, creating a new mission if this one is complete.
   * @return Option[Mission] a new mission if the old one was completed, o/w None.
   */
  def updateMissionTableExplore(userId: String, regionId: Int, missionProgress: AuditMissionProgress): DBIO[Option[Mission]] = {
    val missionId: Int = missionProgress.missionId
    val skipped: Boolean = missionProgress.skipped

    missionTable.isOnboardingMission(missionId).flatMap { isOnboarding: Boolean =>
      if (isOnboarding) {
        if (missionProgress.completed) {
          updateCompleteAndGetNextMission(userId, regionId, missionId, skipped)
        } else DBIO.successful(None)
      } else {
        if (missionProgress.distanceProgress.isEmpty) logger.error("Received null distance progress for audit mission.")
        val distProgress: Float = missionProgress.distanceProgress.get
        val auditTaskId: Option[Int] = missionProgress.auditTaskId

        if (missionProgress.completed) {
          updateCompleteAndGetNextMission(userId, regionId, missionId, distProgress, auditTaskId, skipped)
        } else {
          updateExploreProgressOnly(userId, missionId, distProgress, auditTaskId)
        }
      }
    }
  }

  def getUserMissionsInRegion(userId: String, regionId: Int): Future[Seq[Mission]] = {
    db.run(missionTable.selectCompletedExploreMissions(userId, regionId))
  }
}
