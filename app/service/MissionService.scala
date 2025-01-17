package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import play.api.cache._
import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTable}

import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresDriver.api._

@ImplementedBy(classOf[MissionServiceImpl])
trait MissionService {
  def resumeOrCreateNewValidationMission(userId: String, payPerLabel: Double, tutorialPay: Double, missionType: String, labelTypeId: Int): Future[Option[Mission]]
}

@Singleton
class MissionServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  missionTable: MissionTable,
                                  implicit val ec: ExecutionContext
                                 ) extends MissionService with HasDatabaseConfigProvider[MyPostgresDriver] {
  /**
   * Either resumes or creates a new validation mission.
   *
   * @param userId       User ID
   * @param payPerLabel  Amount of money users receive per label validated
   * @param tutorialPay  Amount of money users receive after completing onboarding [unimplemented]
   * @param missionType  Name of the mission type of the current validation mission {validation, labelmapValidation}
   * @param labelTypeId  Label Type ID to be validated for the next mission {1: cr, 2: mcr, 3: obs in path, 4: sfcp, 7: no sdwlk}
   */
  def resumeOrCreateNewValidationMission(userId: String, payPerLabel: Double, tutorialPay: Double, missionType: String, labelTypeId: Int): Future[Option[Mission]] = {
    val actions: List[String] = List("getValidationMission")
    queryMissionTableValidationMissions(actions, userId, Some(payPerLabel), Some(tutorialPay), Some(false), None, Some(missionType), None, Some(labelTypeId), None)
  }

  /**
   * Provides functionality for accessing the mission table while the user is validating.
   *
   * @param actions            List of actions to perform.
   * @param userId             User ID
   * @param payPerLabel        Amount of money users receive per label validated (not fully implemented feature)
   * @param tutorialPay        Amount of money users when completing onboarding tutorial (not implemented -- exists in case there is any onboarding)
   * @param retakingTutorial   Indicates whether the user is retaking the tutorial (not implemented -- tutorial doesn't exist).
   * @param missionId          The mission ID to be updated.
   * @param missionType        Type of validation mission {validation, labelmapValidation}
   * @param labelsProgress     Numbers of labels that have been validated {1: cr, 2: mcr, 3: obs in path, 4: sfcp, 7: no sdwlk}
   * @param labelTypeId        Label Type ID to be validated for the next mission
   * @param skipped            Indicates whether this mission has been skipped (not fully implemented)
   */
  private def queryMissionTableValidationMissions(actions: List[String], userId: String, payPerLabel: Option[Double],
                                                  tutorialPay: Option[Double], retakingTutorial: Option[Boolean],
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
            val labelsToValidate: Int = missionTable.getNextValidationMissionLength(userId, missionType.get)
            val pay: Double = labelsToValidate.toDouble * payPerLabel.get
            missionTable.createNextValidationMission(userId, pay, labelsToValidate, labelTypeId.get, missionType.get).map(Some(_))
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
}
