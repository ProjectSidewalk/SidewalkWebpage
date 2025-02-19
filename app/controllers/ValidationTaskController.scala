package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.user.SidewalkUserWithRole
import play.api.Configuration
import service.utils.ConfigService
import service.{GSVDataService, LabelService, MissionService, ValidationService, ValidationSubmission}

import scala.concurrent.ExecutionContext
import controllers.helper.ControllerUtils.isAdmin
import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.ValidationTaskSubmissionFormats._
import formats.json.PanoHistoryFormats._
import formats.json.MissionFormats._
import models.amt.AMTAssignmentTable
import models.label._

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
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

@Singleton
class ValidationTaskController @Inject() (
                                           cc: CustomControllerComponents,
                                           val silhouette: Silhouette[DefaultEnv],
                                           config: Configuration,
                                           configService: ConfigService,
                                           missionService: MissionService,
                                           validationService: ValidationService,
                                           labelService: LabelService,
                                           gsvDataService: GSVDataService,
                                           implicit val ec: ExecutionContext
                                         ) extends CustomBaseController(cc) {

  /**
   * Helper function that updates database with all data submitted through the validation page.
   */
  def processValidationTaskSubmissions(data: ValidationTaskSubmission, ipAddress: String, user: SidewalkUserWithRole): Future[Result] = {
    val currTime: OffsetDateTime = data.timestamp
    val adminParams: AdminValidateParams =
      if (data.adminParams.adminVersion && isAdmin(Some(user))) data.adminParams
      else AdminValidateParams(adminVersion = false)

    // First do all the important stuff that needs to be done synchronously.
    val response: Future[Result] = for {
      // Insert validations and comments (if there are any).
      _ <- validationService.submitValidations(data.validations.map { newVal =>
          ValidationSubmission(
          LabelValidation(0, newVal.labelId, newVal.validationResult, newVal.oldSeverity, newVal.newSeverity,
            newVal.oldTags, newVal.newTags, user.userId, newVal.missionId, newVal.canvasX, newVal.canvasY,
            newVal.heading, newVal.pitch, newVal.zoom, newVal.canvasHeight, newVal.canvasWidth, newVal.startTimestamp,
            newVal.endTimestamp, newVal.source),
            newVal.comment.map(c => ValidationTaskComment(
              0, c.missionId, c.labelId, user.userId, ipAddress, c.gsvPanoramaId, c.heading, c.pitch,
              Math.round(c.zoom), c.lat, c.lng, currTime, c.comment
            )),
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
      val labelMetadataJson: JsValue = Json.toJson(labelMetadataJsonSeq)

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
          )
        },
        "switch_to_auditing" -> switchToAuditing
      ))
    }

    // Now we do all the stuff that can be done async, we can return the response before these are done.
    // Insert interactions async.
    validationService.insertMultipleInteractions(data.interactions.map { action =>
      ValidationTaskInteraction(0, action.missionId, action.action, action.gsvPanoramaId, action.lat, action.lng,
        action.heading, action.pitch, action.zoom, action.note, action.timestamp, data.source)
    })

    // Insert Environment async.
    val env: EnvironmentSubmission = data.environment
    validationService.insertEnvironment(ValidationTaskEnvironment(0, env.missionId, env.browser, env.browserVersion,
      env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
      env.operatingSystem, Some(ipAddress), env.language, env.cssZoom, Some(currTime)))

    // Adding the new panorama information to the pano_history table async.
    gsvDataService.insertPanoHistories(data.panoHistories)

    // Send contributions to SciStarter async so that it can be recorded in their user dashboard there.
    val eligibleUser: Boolean = List("Registered", "Researcher", "Administrator", "Owner").contains(user.role)
    if (data.validations.nonEmpty && config.get[String]("environment-type") == "prod" && eligibleUser) {
      // Cap time for each validation at 1 minute.
      val timeSpent: Float = data.validations.map {
        l => Math.min(ChronoUnit.MILLIS.between(l.startTimestamp, l.endTimestamp), 60000)
      }.sum / 1000F
      val scistarterResponse: Future[Int] = configService.sendSciStarterContributions(user.email, data.validations.length, timeSpent)
    }

    response
  }

  /**
   * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
   */
  def postBeacon = silhouette.UserAwareAction.async(parse.text) { implicit request =>
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
   */
  def post = silhouette.UserAwareAction.async(parse.json) { implicit request =>
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
  def postLabelMapValidation = silhouette.UserAwareAction.async(parse.json) { implicit request =>
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
              newVal.startTimestamp, newVal.endTimestamp, newVal.source),
            comment=None, newVal.undone, newVal.redone)))
        } yield {
          Ok(Json.obj("status" -> "Success"))
        }
      }
    )
  }

  /**
   * Handles a comment POST request. It parses the comment and inserts it into the comment table.
   */
    def postComment = silhouette.UserAwareAction.async(parse.json) { implicit request =>
      var submission = request.body.validate[ValidationCommentSubmission]
      submission.fold(
        errors => {
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          request.identity match {
            case Some(user) =>
              for {
                _ <- validationService.deleteCommentIfExists(submission.labelId, submission.missionId)
                commentId: Int <- validationService.insertComment(
                  ValidationTaskComment(0, submission.missionId, submission.labelId, user.userId, request.remoteAddress,
                    submission.gsvPanoramaId, submission.heading, submission.pitch, Math.round(submission.zoom),
                    submission.lat, submission.lng, OffsetDateTime.now, submission.comment))
              } yield {
                Ok(Json.obj("commend_id" -> commentId))
              }
            case None =>
              Future.successful(Unauthorized(Json.obj("status" -> "Error", "message" -> "User not logged in.")))
          }
        }
      )
    }

  /**
   * Handles a comment POST request. It parses the comment and inserts it into the comment table.
   */
    def postLabelMapComment = silhouette.UserAwareAction.async(parse.json) { implicit request =>
      var submission = request.body.validate[LabelMapValidationCommentSubmission]
      submission.fold(
        errors => {
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          val userId: String = request.identity.get.userId
          val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType)
          for {
            // Get the (or create a) mission_id for this user_id and label_type_id.
            mission <- missionService.resumeOrCreateNewValidationMission(userId, 0D, 0D, "labelmapValidation", labelTypeId)
            _ <- validationService.deleteCommentIfExists(submission.labelId, mission.get.missionId)
            commentId: Int <- validationService.insertComment(
              ValidationTaskComment(0, mission.get.missionId, submission.labelId, userId, request.remoteAddress,
                submission.gsvPanoramaId, submission.heading, submission.pitch, Math.round(submission.zoom),
                submission.lat, submission.lng, OffsetDateTime.now, submission.comment))
          } yield {
            Ok(Json.obj("commend_id" -> commentId))
          }
        }
      )
    }

  /**
   * Gets the metadata for a single random label in the database. Excludes labels that were originally placed by the
   * user, labels that have already appeared on the interface, and the label that was just skipped.
   *
   * @param labelTypeId    Label Type Id this label should have
   * @param skippedLabelId Label ID of the label that was just skipped
   * @return Label metadata containing GSV metadata and label type
   */
  def getRandomLabelData(labelTypeId: Int, skippedLabelId: Int) = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    var submission = request.body.validate[SkipLabelSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val adminParams: AdminValidateParams =
          if (submission.adminParams.adminVersion && isAdmin(request.identity)) submission.adminParams
          else AdminValidateParams(adminVersion = false)
        val userId: String = request.identity.get.userId

        // Get metadata for one new label to replace the skipped one.
        // TODO should really exclude all remaining labels in the mission, not just the skipped one. Not bothering now
        //      because it isn't a heavily used feature, and it's a rare edge case.
        labelService.retrieveLabelListForValidation(userId, n = 1, labelTypeId, adminParams.userIds.map(_.toSet).getOrElse(Set()), adminParams.neighborhoodIds.map(_.toSet).getOrElse(Set()), skippedLabelId = Some(skippedLabelId))
          .flatMap { labelMetadata =>
            if (adminParams.adminVersion) {
              labelService.getExtraAdminValidateData(Seq(labelMetadata.head.labelId)).map(adminData =>
                Ok(Json.obj(
                  "label" -> LabelFormat.validationLabelMetadataToJson(labelMetadata.head, Some(adminData.head))
                ))
              )
            } else {
              Future.successful(Ok(Json.obj(
                "label" -> LabelFormat.validationLabelMetadataToJson(labelMetadata.head)
              )))
            }
          }
      }
    )
  }
}
