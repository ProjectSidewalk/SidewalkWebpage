package controllers

import java.sql.Timestamp
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator

import controllers.headers.ProvidesHeader
import formats.json.ValidationTaskSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.label._
import models.label.LabelTable.LabelValidationMetadata
import models.mission.{Mission, MissionTable, MissionSetProgress}
import models.user.User
import models.validation._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future
import scala.collection.mutable.ListBuffer

class ValidationTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class ValidationTaskPostReturnValue(hasMissionAvailable: Option[Boolean], mission: Option[Mission], labels: Option[JsValue], progress: Option[JsValue])

  def processValidationTaskSubmissions(submission: Seq[ValidationTaskSubmission], remoteAddress: String, identity: Option[User]) = {
    val userOption = identity
    val returnValues: Seq[ValidationTaskPostReturnValue] = for (data <- submission) yield {
      ValidationTaskInteractionTable.saveMultiple(data.interactions.map { interaction =>
        ValidationTaskInteraction(0, interaction.missionId, interaction.action, interaction.gsvPanoramaId,
          interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
          new Timestamp(interaction.timestamp), interaction.isMobile)
      })

      // We aren't always submitting labels, so check if data.labels exists.
      for (label: LabelValidationSubmission <- data.labels) {
        userOption match {
          case Some(user) =>
            LabelValidationTable.save(LabelValidation(0, label.labelId, label.validationResult,
              user.userId.toString, label.missionId, label.canvasX, label.canvasY, label.heading,
              label.pitch, label.zoom, label.canvasHeight, label.canvasWidth,
              new Timestamp(label.startTimestamp), new Timestamp(label.endTimestamp), label.isMobile))
          case None =>
            Logger.warn("User without user_id validated a label, but every user should have a user_id.")
        }
      }

      // We aren't always submitting mission progress, so check if data.missionProgress exists.
      data.missionProgress match {
        case Some(_) =>
          val missionProgress: ValidationMissionProgress = data.missionProgress.get
          val missionId: Int = missionProgress.missionId
          val currentMissionLabelTypeId: Int = missionProgress.labelTypeId
          val nextMissionLabelTypeId: Option[Int] = getLabelTypeId(userOption, missionProgress, Some(currentMissionLabelTypeId))
          nextMissionLabelTypeId match {
            // Load new mission, generate label list for validation
            case Some (nextMissionLabelTypeId) =>
              val possibleNewMission: Option[Mission] = updateMissionTable(userOption, missionProgress, Some(nextMissionLabelTypeId))
              val labelList: Option[JsValue] = getLabelList(userOption, missionProgress, nextMissionLabelTypeId)
              val progress: Option[JsObject] = Some(LabelValidationTable.getValidationProgress(possibleNewMission.get.missionId))
              ValidationTaskPostReturnValue(Some (true), possibleNewMission, labelList, progress)
            case None =>
              updateMissionTable(userOption, missionProgress, None)
              // No more validation missions available
              if (missionProgress.completed) {
                ValidationTaskPostReturnValue(None, None, None, None)
              } else {
                // Validation mission is still in progress
                ValidationTaskPostReturnValue(Some(true), None, None, None)
              }
          }
        case None =>
          ValidationTaskPostReturnValue (None, None, None, None)
      }
    }

    // If this user is a turker who has just finished 3 validation missions, switch them to auditing.
    val switchToAuditing = userOption.isDefined &&
      userOption.get.role.getOrElse("") == "Turker" &&
      MissionTable.getProgressOnMissionSet(userOption.get.username).missionType != "validation"

    Future.successful(Ok(Json.obj(
      "hasMissionAvailable" -> returnValues.head.hasMissionAvailable,
      "mission" -> returnValues.head.mission.map(_.toJSON),
      "labels" -> returnValues.head.labels,
      "progress" -> returnValues.head.progress,
      "switch_to_auditing" -> switchToAuditing
    )))
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON
    *
    * @return
    */
  def postBeacon = UserAwareAction.async(BodyParsers.parse.text) { implicit request =>
    val json = Json.parse(request.body)
    var submission = json.validate[Seq[ValidationTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processValidationTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  /**
    * Parse submitted validation data and submit to tables
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[ValidationTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processValidationTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  def postLabelMap = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[LabelMapValidationSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        // Get the (or create a) mission_id for this user_id and label_type_id
        val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType)
        val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(request.identity.get.userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId).get
        // Insert a label_validation entry for this label.
        LabelValidationTable.save(LabelValidation(0, submission.labelId, submission.validationResult,
          request.identity.get.userId.toString, mission.missionId, submission.canvasX, submission.canvasY,
          submission.heading, submission.pitch, submission.zoom, submission.canvasHeight, submission.canvasWidth,
          new Timestamp(submission.startTimestamp), new Timestamp(submission.endTimestamp), submission.isMobile))
        Future.successful(Ok(Json.obj("status" -> "Success")))
      }
    )
  }

  /**
    * Returns the label type id for the next validation mission
    * @param user               UserId of the current user.
    * @param missionProgress    Progress of the current validation mission.
    * @param currentLabelTypeId Label Type ID of the current mission
    * @return
    */
  def getLabelTypeId(user: Option[User], missionProgress: ValidationMissionProgress, currentLabelTypeId: Option[Int]): Option[Int] = {
    val userId: UUID = user.get.userId
    if (missionProgress.completed) {
      val labelsToRetrieve: Int = MissionTable.getNumberOfLabelsToRetrieve(userId, missionProgress.missionType)
      val possibleLabelTypeIds: List[Int] = LabelTable.retrievePossibleLabelTypeIds(userId, labelsToRetrieve, currentLabelTypeId)
      val hasNextMission: Boolean = possibleLabelTypeIds.nonEmpty

      if (hasNextMission) {
        // possibleLabTypeIds can contain [1, 2, 3, 4, 7]. Select ids 1, 2, 3, 4 if possible, o/w choose 7.
        val possibleIds: List[Int] =
          if (possibleLabelTypeIds.size > 1) possibleLabelTypeIds.filter(_ != 7)
          else possibleLabelTypeIds
        val index: Int = if (possibleIds.size > 1) scala.util.Random.nextInt(possibleIds.size - 1) else 0
        return Some(possibleIds(index))
      }
    }
    None
  }

  /**
    * Gets the metadata for a specific label in the database.
    * @param labelId  label_id for this label
    * @return Label metadata containing GSV metadata and label type
    */
  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    LabelTable.find(labelId) match {
      case Some(labelPointObj) =>
        val labelMetadata: LabelValidationMetadata = LabelTable.retrieveSingleLabelForValidation(labelId)
        val labelMetadataJson: JsObject = LabelTable.validationLabelMetadataToJson(labelMetadata)
        Future.successful(Ok(labelMetadataJson))
      case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
    }
  }

  /**
    * Gets a list of new labels to validate if the mission is complete.
    * @param user
    * @param missionProgress  Metadata for this mission
    * @return                 List of label metadata (if this mission is complete).
    */
  def getLabelList(user: Option[User], missionProgress: ValidationMissionProgress, labelTypeId: Int): Option[JsValue] = {
    val userId: UUID = user.get.userId
    if (missionProgress.completed) {
      val labelCount: Int = MissionTable.getNumberOfLabelsToRetrieve(userId, missionProgress.missionType)
      Some(getLabelListForValidation(userId, labelCount, labelTypeId))
    } else {
      None
    }
  }
  
  /**
    * Gets a random list of labels to validate for this mission.
    * @param userId       User ID of the current user.
    * @param n            Number of labels to retrieve for this list.
    * @param labelTypeId  Label Type to retrieve
    * @return             JsValue containing a list of labels with the following attributes:
    *                     {label_id, label_type, gsv_panorama_id, heading, pitch, zoom, canvas_x,
    *                     canvas_y, canvas_width, canvas_height}
    */
  def getLabelListForValidation(userId: UUID, n: Int, labelTypeId: Int): JsValue = {
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, n, labelTypeId, skippedLabelId = None)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(LabelTable.validationLabelMetadataToJson)
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }

  /**
    * Gets the metadata for a single random label in the database. Excludes labels that were originally placed by the
    * user, labels that have already appeared on the interface, and the label that was just skipped.
    * @param labelTypeId    Label Type Id this label should have
    * @param skippedLabelId Label ID of the label that was just skipped
    * @return               Label metadata containing GSV metadata and label type
    */
  def getRandomLabelData(labelTypeId: Int, skippedLabelId: Int) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[SkipLabelSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        var labelIdList = new ListBuffer[Int]()

        val labelMetadataJson: Seq[JsObject] = for (data <- submission) yield {
          for (label: LabelValidationSubmission <- data.labels) {
            labelIdList += label.labelId
          }

          val userId: UUID = request.identity.get.userId
          val labelMetadata: LabelValidationMetadata = LabelTable.retrieveLabelListForValidation(userId, n = 1, labelTypeId, Some(skippedLabelId)).head
          LabelTable.validationLabelMetadataToJson(labelMetadata)
        }
        Future.successful(Ok(labelMetadataJson.head))
      }
    )
  }

  /**
    * Updates the MissionTable. If the current mission is completed, then retrieves a new mission.
    * @param user                     User ID
    * @param missionProgress          Metadata for this mission
    * @param nextMissionLabelTypeId   Label Type ID for the next mission
    * @return
    */
  def updateMissionTable(user: Option[User], missionProgress: ValidationMissionProgress, nextMissionLabelTypeId: Option[Int]): Option[Mission] = {
    val missionId: Int = missionProgress.missionId
    val skipped: Boolean = missionProgress.skipped
    val userId: UUID = user.get.userId
    val role: String = user.get.role.getOrElse("")
    val labelsProgress: Int = missionProgress.labelsProgress

    if (missionProgress.completed) {
      // payPerLabel is currently always 0 because this is only available to volunteers.
      val payPerLabel: Double = AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION
      MissionTable.updateCompleteAndGetNextValidationMission(userId, payPerLabel, missionId, missionProgress.missionType, labelsProgress, nextMissionLabelTypeId, skipped)
    } else {
      MissionTable.updateValidationProgressOnly(userId, missionId, labelsProgress)
    }
  }
}
