package controllers

import java.sql.Timestamp
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import models.user.SidewalkUserWithRole
import play.api.i18n.MessagesApi
import service.{GSVDataService, LabelService, MissionService, ValidationService, ValidationSubmission}

import scala.concurrent.ExecutionContext
//import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.{isAdmin}
import controllers.helper.ValidateHelper.{AdminValidateParams}
import formats.json.ValidationTaskSubmissionFormats._
import formats.json.PanoHistoryFormats._
import formats.json.MissionFormats._
import models.amt.AMTAssignmentTable
import models.label._
//import models.label.LabelTable.{AdminValidationData, LabelValidationMetadata}
//import models.user.{User, UserStatTable}
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

@Singleton
class ValidationTaskController @Inject() (
                                           val messagesApi: MessagesApi,
                                           val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                           missionService: MissionService,
                                           validationService: ValidationService,
                                           labelService: LabelService,
                                           gsvDataService: GSVDataService,
                                           implicit val ec: ExecutionContext
                                         ) extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {

  /**
   * Helper function that updates database with all data submitted through the validation page.
   */
  def processValidationTaskSubmissions(data: ValidationTaskSubmission, remoteAddress: String, user: SidewalkUserWithRole): Future[Result] = {
    val currTime = new Timestamp(data.timestamp)
    val adminParams: AdminValidateParams =
      if (data.adminParams.adminVersion && isAdmin(Some(user))) data.adminParams
      else AdminValidateParams(adminVersion = false)

    // Insert interactions async.
    validationService.insertMultipleInteractions(data.interactions.map { action =>
      ValidationTaskInteraction(0, action.missionId, action.action, action.gsvPanoramaId, action.lat, action.lng,
        action.heading, action.pitch, action.zoom, action.note, new Timestamp(action.timestamp), data.source)
    })

    // Insert Environment async.
    val env: EnvironmentSubmission = data.environment
    validationService.insertEnvironment(ValidationTaskEnvironment(0, env.missionId, env.browser, env.browserVersion,
      env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
      env.operatingSystem, Some(remoteAddress), env.language, env.cssZoom, Some(currTime)))

    // Adding the new panorama information to the pano_history table async.
    gsvDataService.insertPanoHistories(data.panoHistories)

    // Send contributions to SciStarter so that it can be recorded in their user dashboard there.
    // TODO Add scistarter functionality back in.
    //      Depends on: nothing
    //      Dependent for: nothing
    //    val labels: Seq[LabelValidationSubmission] = data.validations
    //    val eligibleUser: Boolean = List("Registered", "Administrator", "Owner").contains(user.role)
    //    val envType: String = Play.configuration.getString("environment-type").get
    //    if (labels.nonEmpty && envType == "prod" && eligibleUser) {
    //      // Cap time for each validation at 1 minute.
    //      val timeSpent: Float = labels.map(l => Math.min(l.endTimestamp - l.startTimestamp, 60000)).sum / 1000F
    //      val scistarterResponse: Future[Int] = sendSciStarterContributions(user.email, labels.length, timeSpent)
    //    }

    for {
      // Insert validations (if there are any).
//      _ <- validationService.submitValidations(data.validations, user.userId)
      _ <- validationService.submitValidations(data.validations.map { newVal =>
        ValidationSubmission(
          LabelValidation(0, newVal.labelId, newVal.validationResult, newVal.oldSeverity, newVal.newSeverity,
            newVal.oldTags, newVal.newTags, user.userId, newVal.missionId, newVal.canvasX, newVal.canvasY,
            newVal.heading, newVal.pitch, newVal.zoom, newVal.canvasHeight, newVal.canvasWidth,
            new Timestamp(newVal.startTimestamp), new Timestamp(newVal.endTimestamp), newVal.source),
          newVal.undone, newVal.redone)
      })

      // Get data to return in POST response. Not much unless the mission is over and we need the next batch of labels.
      returnValue <- labelService.getDataForValidatePostRequest(user, data.missionProgress, adminParams)
    } yield {
      // Put label metadata into JSON format.
      val labelMetadataJsonSeq: Seq[JsObject] = if (adminParams.adminVersion) {
        returnValue.labels.sortBy(_.labelId).zip(returnValue.adminData.sortBy(_.labelId))
          .map(label => LabelFormat.validationLabelMetadataToJson(label._1, Some(label._2)))
      } else {
        returnValue.labels.map(l => LabelFormat.validationLabelMetadataToJson(l))
      }
      val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)

      // If this user is a turker who has just finished 3 validation missions, switch them to auditing.
      val switchToAuditing = user.role == "Turker" && returnValue.missionSetProgress.missionType != "validation"

      Ok(Json.obj(
        "has_mission_available" -> returnValue.hasMissionAvailable,
        "mission" -> returnValue.mission.map(m => Json.toJson(m)),
        "labels" -> labelMetadataJson,
        "progress" -> returnValue.progress.map { case (agreeCount, disagreeCount, unsureCount) =>
          Json.obj(
            "agree_count" -> agreeCount,
            "disagree_count" -> disagreeCount,
            "unsure_count" -> unsureCount
          )},
        "switch_to_auditing" -> switchToAuditing
      ))
    }
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    */
  def postBeacon = UserAwareAction.async(BodyParsers.parse.text) { implicit request =>
    val json = Json.parse(request.body)
    var submission = json.validate[ValidationTaskSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) => processValidationTaskSubmissions(submission, request.remoteAddress, user)
          case None => Future.successful(Unauthorized(Json.obj("status" -> "Error", "message" -> "User not logged in.")))
        }
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
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) => processValidationTaskSubmissions(submission, request.remoteAddress, user)
          case None => Future.successful(Unauthorized(Json.obj("status" -> "Error", "message" -> "User not logged in.")))
        }
      }
    )
  }

  /**
   * Parse submitted validation data for a single label from the /labelmap endpoint.
   */
  def postLabelMapValidation = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    val userId: String = request.identity.get.userId
    var submission = request.body.validate[LabelMapValidationSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      newVal => {
        val labelTypeId: Int = LabelTypeTable.labelTypeToId(newVal.labelType)
        for {
          mission <- missionService.resumeOrCreateNewValidationMission(userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId)
          newValIds <- validationService.submitValidations(Seq(ValidationSubmission(
            LabelValidation(0, newVal.labelId, newVal.validationResult, newVal.oldSeverity, newVal.newSeverity,
              newVal.oldTags, newVal.newTags, userId, mission.get.missionId, newVal.canvasX, newVal.canvasY,
              newVal.heading, newVal.pitch, newVal.zoom, newVal.canvasHeight, newVal.canvasWidth,
              new Timestamp(newVal.startTimestamp), new Timestamp(newVal.endTimestamp), newVal.source),
            newVal.undone, newVal.redone)))
        } yield {
          Ok(Json.obj("status" -> "Success"))
        }
      }
    )
  }

  /**
    * Handles a comment POST request. It parses the comment and inserts it into the comment table.
    */
//  def postLabelMapComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    var submission = request.body.validate[LabelMapValidationCommentSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val userId: UUID = request.identity.get.userId
//
//        // Get the (or create a) mission_id for this user_id and label_type_id.
//        val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType).get
//        val mission: Mission =
//          MissionTable.resumeOrCreateNewValidationMission(userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId).get
//
//        val ipAddress: String = request.remoteAddress
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//
//        val comment = ValidationTaskComment(0, mission.missionId, submission.labelId, userId.toString,
//          ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
//          submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
//
//        val commentId: Int = ValidationTaskCommentTable.insert(comment)
//        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
//      }
//    )
//  }

  /**
    * Gets the metadata for a single random label in the database. Excludes labels that were originally placed by the
    * user, labels that have already appeared on the interface, and the label that was just skipped.
    *
    * @param labelTypeId    Label Type Id this label should have
    * @param skippedLabelId Label ID of the label that was just skipped
    * @return               Label metadata containing GSV metadata and label type
    */
//  def getRandomLabelData(labelTypeId: Int, skippedLabelId: Int) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    var submission = request.body.validate[SkipLabelSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        var labelIdList = new ListBuffer[Int]()
//
//        for (label: LabelValidationSubmission <- submission.labels) {
//          labelIdList += label.labelId
//        }
//        val adminParams: AdminValidateParams =
//          if (submission.adminParams.adminVersion && isAdmin(request.identity)) submission.adminParams
//          else AdminValidateParams(adminVersion = false)
//        val userId: UUID = request.identity.get.userId
//        val labelMetadata: LabelValidationMetadata = LabelTable.retrieveLabelListForValidation(userId, n=1, labelTypeId, adminParams.userIds, adminParams.neighborhoodIds, skippedLabelId=Some(skippedLabelId)).head
//        val labelMetadataJson: JsObject = if (adminParams.adminVersion) {
//          val adminData: AdminValidationData = LabelTable.getExtraAdminValidateData(List(labelMetadata.labelId)).head
//          LabelFormat.validationLabelMetadataToJson(labelMetadata, Some(adminData))
//        } else {
//          LabelFormat.validationLabelMetadataToJson(labelMetadata)
//        }
//        Future.successful(Ok(labelMetadataJson))
//      }
//    )
  }
