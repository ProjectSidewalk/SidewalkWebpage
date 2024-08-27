package controllers

import java.sql.Timestamp
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.{isAdmin, sendSciStarterContributions}
import controllers.helper.ValidateHelper.{AdminValidateParams, getLabelTypeIdToValidate}
import formats.json.ValidationTaskSubmissionFormats._
import formats.json.PanoHistoryFormats._
import models.amt.AMTAssignmentTable
import models.label._
import models.label.LabelTable.{AdminValidationData, LabelValidationMetadata}
import models.mission.{Mission, MissionTable}
import models.user.{User, UserStatTable}
import models.validation._
import models.gsv.{GSVDataTable, PanoHistory, PanoHistoryTable}
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.mvc._
import scala.concurrent.Future
import scala.collection.mutable.ListBuffer
import formats.json.CommentSubmissionFormats._
import formats.json.LabelFormat
import play.api.Play.current
import java.time.Instant

/**
 * Holds the HTTP requests associated with tasks submitted through the validation page.
 *
 * @param env The Silhouette environment.
 */
class ValidationTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class ValidationTaskPostReturnValue(hasMissionAvailable: Option[Boolean], mission: Option[Mission], labels: Option[JsValue], progress: Option[JsValue])

  /**
   * Helper function that updates database with all data submitted through the validation page.
   */
  def processValidationTaskSubmissions(data: ValidationTaskSubmission, remoteAddress: String, identity: Option[User]) = {
    val userOption: Option[User] = identity
    val adminParams: AdminValidateParams =
      if (data.adminParams.adminVersion && isAdmin(userOption)) data.adminParams
      else AdminValidateParams(adminVersion = false)
    val currTime = new Timestamp(data.timestamp)
    ValidationTaskInteractionTable.saveMultiple(data.interactions.map { interaction =>
      ValidationTaskInteraction(0, interaction.missionId, interaction.action, interaction.gsvPanoramaId,
        interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
        new Timestamp(interaction.timestamp), data.source)
    })

    // Insert Environment.
    val env: EnvironmentSubmission = data.environment
    val taskEnv: ValidationTaskEnvironment = ValidationTaskEnvironment(0, env.missionId, env.browser,
      env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
      env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language, env.cssZoom, Some(currTime))
    ValidationTaskEnvironmentTable.save(taskEnv)

    // Insert validations. We aren't always submitting validations, so check if data.labels exists.
    for (labelVal: LabelValidationSubmission <- data.validations) {
      userOption match {
        case Some(user) =>
          val currValidation: LabelValidation = LabelValidation(0, labelVal.labelId, labelVal.validationResult,
            labelVal.oldSeverity, labelVal.newSeverity, labelVal.oldTags, labelVal.newTags, user.userId.toString,
            labelVal.missionId, labelVal.canvasX, labelVal.canvasY, labelVal.heading, labelVal.pitch, labelVal.zoom,
            labelVal.canvasHeight, labelVal.canvasWidth, new Timestamp(labelVal.startTimestamp),
            new Timestamp(labelVal.endTimestamp), labelVal.source)
          if (labelVal.undone || labelVal.redone) {
            // Deleting the last label's comment if it exists.
            ValidationTaskCommentTable.deleteIfExists(labelVal.labelId, labelVal.missionId)

            // Delete the validation from the label_validation table.
            LabelValidationTable.deleteLabelValidation(currValidation.labelId, currValidation.userId)
          }
          // If the validation is new or is an update for an undone label, save it.
          if (!labelVal.undone) {
            // Adding the validation in the label_validation table.
            val newValId: Int = LabelValidationTable.insert(currValidation)

            // Update the severity and tags in the label table if something changed (only applies if they marked Agree).
            if (labelVal.validationResult == 1) {
              LabelTable.updateAndSaveHistory(labelVal.labelId, labelVal.newSeverity, labelVal.newTags, user.userId.toString, labelVal.source, newValId)
            }
          }
        case None =>
          Logger.warn("User without user_id validated a label, but every user should have a user_id.")
      }
    }
    // For any users whose labels have been validated, update their accuracy in the user_stat table.
    if (data.validations.nonEmpty) {
      val usersValidated: List[String] = LabelValidationTable.usersValidated(data.validations.map(_.labelId).toList)
      UserStatTable.updateAccuracy(usersValidated)
    }

    // Adding the new panorama information to the pano_history table.
    data.panoHistories.foreach { panoHistory =>
      // First, update the panorama that shows up currently for the current location in the GSVDataTable.
      GSVDataTable.updatePanoHistorySaved(panoHistory.currPanoId, Some(new Timestamp(panoHistory.panoHistorySaved)))

      // Add all of the panoramas at the current location.
      panoHistory.history.foreach { h => PanoHistoryTable.save(PanoHistory(h.panoId, h.date, panoHistory.currPanoId)) }
    }

    // We aren't always submitting mission progress, so check if data.missionProgress exists.
    val returnValue: ValidationTaskPostReturnValue = data.missionProgress match {
      case Some(_) =>
        val missionProgress: ValidationMissionProgress = data.missionProgress.get
        val nextMissionLabelTypeId: Option[Int] =
          if (missionProgress.completed) {
            val labelsToRetrieve: Int = MissionTable.validationMissionLabelsToRetrieve
            getLabelTypeIdToValidate(userOption.get.userId, labelsToRetrieve, adminParams.labelTypeId)
          } else {
            None
          }

        nextMissionLabelTypeId match {
          // Load new mission, generate label list for validation.
          case Some (nextMissionLabelTypeId) =>
            val possibleNewMission: Option[Mission] = updateMissionTable(userOption, missionProgress, Some(nextMissionLabelTypeId))
            val labelList: Option[JsValue] = getLabelList(userOption, missionProgress, nextMissionLabelTypeId, adminParams)
            val progress: Option[JsObject] = Some(LabelValidationTable.getValidationProgress(possibleNewMission.get.missionId))
            val hasDataForMission: Boolean = labelList.toString != "[]"
            ValidationTaskPostReturnValue(Some(hasDataForMission), possibleNewMission, labelList, progress)
          case None =>
            updateMissionTable(userOption, missionProgress, None)
            // No more validation missions available.
            if (missionProgress.completed) {
              ValidationTaskPostReturnValue(None, None, None, None)
            } else {
              // Validation mission is still in progress.
              ValidationTaskPostReturnValue(Some(true), None, None, None)
            }
        }
      case None =>
        ValidationTaskPostReturnValue (None, None, None, None)
    }

    // Send contributions to SciStarter so that it can be recorded in their user dashboard there.
    val labels: Seq[LabelValidationSubmission] = data.validations
    val eligibleUser: Boolean = List("Registered", "Administrator", "Owner").contains(identity.get.role.getOrElse(""))
    val envType: String = Play.configuration.getString("environment-type").get
    if (labels.nonEmpty && envType == "prod" && eligibleUser) {
      // Cap time for each validation at 1 minute.
      val timeSpent: Float = labels.map(l => Math.min(l.endTimestamp - l.startTimestamp, 60000)).sum / 1000F
      val scistarterResponse: Future[Int] = sendSciStarterContributions(identity.get.email, labels.length, timeSpent)
    }

    // If this user is a turker who has just finished 3 validation missions, switch them to auditing.
    val switchToAuditing = userOption.isDefined &&
      userOption.get.role.getOrElse("") == "Turker" &&
      MissionTable.getProgressOnMissionSet(userOption.get.username).missionType != "validation"

    Future.successful(Ok(Json.obj(
      "hasMissionAvailable" -> returnValue.hasMissionAvailable,
      "mission" -> returnValue.mission.map(_.toJSON),
      "labels" -> returnValue.labels,
      "progress" -> returnValue.progress,
      "switch_to_auditing" -> switchToAuditing
    )))
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    */
  def postBeacon = UserAwareAction.async(BodyParsers.parse.text) { implicit request =>
    val json = Json.parse(request.body)
    var submission = json.validate[ValidationTaskSubmission]
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
    * Parse submitted validation data and submit to tables.
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[ValidationTaskSubmission]
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
   * Parse submitted validation data for a single label from the /labelmap endpoint.
   */
  def postLabelMapValidation = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    val userId: UUID = request.identity.get.userId
    var submission = request.body.validate[LabelMapValidationSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        // Get the (or create a) mission_id for this user_id and label_type_id.
        val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType).get
        val mission: Mission =
          MissionTable.resumeOrCreateNewValidationMission(userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId).get

        // Check if user already has a validation for this label.
        if(LabelValidationTable.countValidationsFromUserAndLabel(userId, submission.labelId) != 0) {
          // Delete the user's old label.
          LabelValidationTable.deleteLabelValidation(submission.labelId, userId.toString)
        }

        // Insert a label_validation entry for this label.
        val newValId: Int = LabelValidationTable.insert(LabelValidation(0, submission.labelId,
          submission.validationResult, submission.oldSeverity, submission.newSeverity, submission.oldTags,
          submission.newTags, userId.toString, mission.missionId, submission.canvasX, submission.canvasY,
          submission.heading, submission.pitch, submission.zoom, submission.canvasHeight, submission.canvasWidth,
          new Timestamp(submission.startTimestamp), new Timestamp(submission.endTimestamp), submission.source))

        // Now we update the severity and tags in the label table if something changed.
        LabelTable.updateAndSaveHistory(submission.labelId, submission.newSeverity, submission.newTags, userId.toString, submission.source, newValId)

        // For the user whose labels has been validated, update their accuracy in the user_stat table.
        val usersValidated: List[String] = LabelValidationTable.usersValidated(List(submission.labelId))
        UserStatTable.updateAccuracy(usersValidated)
        Future.successful(Ok(Json.obj("status" -> "Success")))
      }
    )
  }

  /**
    * Handles a comment POST request. It parses the comment and inserts it into the comment table.
    */
  def postLabelMapComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[LabelMapValidationCommentSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val userId: UUID = request.identity.get.userId

        // Get the (or create a) mission_id for this user_id and label_type_id.
        val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType).get
        val mission: Mission =
          MissionTable.resumeOrCreateNewValidationMission(userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId).get
        
        val ipAddress: String = request.remoteAddress
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

        val comment = ValidationTaskComment(0, mission.missionId, submission.labelId, userId.toString,
          ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
          submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)

        val commentId: Int = ValidationTaskCommentTable.save(comment)
        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
      }
    )
  }

  /**
    * Gets a list of new labels to validate if the mission is complete.
    *
    * @param user
    * @param missionProgress  Metadata for this mission
    * @param adminParams      Parameters related to the admin version of the validate page.
    * @return                 List of label metadata (if this mission is complete).
    */
  def getLabelList(user: Option[User], missionProgress: ValidationMissionProgress, labelTypeId: Int, adminParams: AdminValidateParams): Option[JsValue] = {
    val userId: UUID = user.get.userId
    if (missionProgress.completed) {
      Some(getLabelListForValidation(userId, MissionTable.validationMissionLabelsToRetrieve, labelTypeId, adminParams))
    } else {
      None
    }
  }
  
  /**
    * Gets a random list of labels to validate for this mission.
    *
    * @param userId       User ID of the current user.
    * @param n            Number of labels to retrieve for this list.
    * @param labelTypeId  Label Type to retrieve
    * @param adminParams  Parameters related to the admin version of the validate page.
    * @return             JsValue containing a list of labels.
    */
  def getLabelListForValidation(userId: UUID, n: Int, labelTypeId: Int, adminParams: AdminValidateParams): JsValue = {
    // Get list of labels and their metadata for Validate page. Get extra data if it's for Admin Validate.
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, n, labelTypeId, adminParams.userIds, adminParams.neighborhoodIds)
    val labelMetadataJsonSeq: Seq[JsObject] = if (adminParams.adminVersion) {
      val adminData: List[AdminValidationData] = LabelTable.getExtraAdminValidateData(labelMetadata.map(_.labelId).toList)
      labelMetadata.sortBy(_.labelId).zip(adminData.sortBy(_.labelId))
        .map(label => LabelFormat.validationLabelMetadataToJson(label._1, Some(label._2)))
    } else {
      labelMetadata.map(l => LabelFormat.validationLabelMetadataToJson(l))
    }
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }

  /**
    * Gets the metadata for a single random label in the database. Excludes labels that were originally placed by the
    * user, labels that have already appeared on the interface, and the label that was just skipped.
    *
    * @param labelTypeId    Label Type Id this label should have
    * @param skippedLabelId Label ID of the label that was just skipped
    * @return               Label metadata containing GSV metadata and label type
    */
  def getRandomLabelData(labelTypeId: Int, skippedLabelId: Int) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[SkipLabelSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        var labelIdList = new ListBuffer[Int]()

        for (label: LabelValidationSubmission <- submission.labels) {
          labelIdList += label.labelId
        }
        val adminParams: AdminValidateParams =
          if (submission.adminParams.adminVersion && isAdmin(request.identity)) submission.adminParams
          else AdminValidateParams(adminVersion = false)
        val userId: UUID = request.identity.get.userId
        val labelMetadata: LabelValidationMetadata = LabelTable.retrieveLabelListForValidation(userId, n=1, labelTypeId, adminParams.userIds, adminParams.neighborhoodIds, skippedLabelId=Some(skippedLabelId)).head
        val labelMetadataJson: JsObject = if (adminParams.adminVersion) {
          val adminData: AdminValidationData = LabelTable.getExtraAdminValidateData(List(labelMetadata.labelId)).head
          LabelFormat.validationLabelMetadataToJson(labelMetadata, Some(adminData))
        } else {
          LabelFormat.validationLabelMetadataToJson(labelMetadata)
        }
        Future.successful(Ok(labelMetadataJson))
      }
    )
  }

  /**
    * Updates the MissionTable. If the current mission is completed, then retrieves a new mission.
    *
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
