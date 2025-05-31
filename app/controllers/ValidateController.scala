package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, isMobile}
import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.CommentSubmissionFormats.{LabelMapValidationCommentSubmission, ValidationCommentSubmission}
import formats.json.LabelFormats
import formats.json.MissionFormats._
import formats.json.ValidateFormats.{EnvironmentSubmission, LabelMapValidationSubmission, SkipLabelSubmission, ValidationTaskSubmission}
import models.auth.WithAdmin
import models.label.{LabelTypeEnum, Tag}
import models.user._
import models.validation.{LabelValidation, ValidationTaskComment, ValidationTaskEnvironment, ValidationTaskInteraction}
import play.api.Configuration
import play.api.libs.json._
import play.api.mvc.Result
import service.ValidationSubmission

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@Singleton
class ValidateController @Inject() (cc: CustomControllerComponents,
                                    implicit val ec: ExecutionContext,
                                    val config: Configuration,
                                    configService: service.ConfigService,
                                    labelService: service.LabelService,
                                    validationService: service.ValidationService,
                                    authenticationService: service.AuthenticationService,
                                    regionService: service.RegionService,
                                    gsvDataService: service.GsvDataService,
                                    missionService: service.MissionService
                                   )(implicit assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Returns the validation page.
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def validate(neighborhoods: Option[String]) = cc.securityService.SecuredAction { implicit request =>
    checkParams(adminVersion = false, None, None, neighborhoods).flatMap { case (adminParams, response) =>
      if (response.header.status == 200) {
        val user: SidewalkUserWithRole = request.identity
        for {
          (mission, labelList, missionProgress, hasNextMission, completedVals) <- getDataForValidatePages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_Validate")
          Ok(views.html.apps.validate(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, hasNextMission, completedVals))
        }
      } else {
        Future.successful(response)
      }
    }
  }

  /**
   * Returns the new validate beta page, optionally with some admin filters.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def newValidateBeta(labelType: Option[String], users: Option[String], neighborhoods: Option[String]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    checkParams(adminVersion = true, labelType, users, neighborhoods).flatMap { case (adminParams, response) =>
      if (response.header.status == 200) {
        val user: SidewalkUserWithRole = request.identity
        for {
          (mission, labelList, missionProgress, hasNextMission, completedVals) <- getDataForValidatePages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
          tags: Seq[Tag] <- labelService.getTagsForCurrentCity
        } yield {
          cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_NewValidateBeta")
          Ok(views.html.apps.newValidateBeta(commonPageData, "Sidewalk - NewValidateBeta", user, adminParams, mission, labelList, missionProgress, hasNextMission, completedVals, tags))
        }
      } else {
        Future.successful(response)
      }
    }
  }

  /**
   * Returns the validation page for mobile.
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def mobileValidate(neighborhoods: Option[String]) = cc.securityService.SecuredAction { implicit request =>
    checkParams(adminVersion = false, None, None, neighborhoods).flatMap { case (adminParams, response) =>
      if (response.header.status == 200) {
        val user: SidewalkUserWithRole = request.identity
        for {
          (mission, labelList, missionProgress, hasNextMission, completedVals) <- getDataForValidatePages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          if (!isMobile(request)) {
            cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_MobileValidate_RedirectHome")
            Redirect("/")
          } else {
            cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_MobileValidate")
            Ok(views.html.apps.mobileValidate(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, hasNextMission, completedVals))
          }
          cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_MobileValidate")
          Ok(views.html.apps.mobileValidate(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, hasNextMission, completedVals))
        }
      } else {
        Future.successful(response)
      }
    }
  }

  /**
   * Returns an admin version of the validation page.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def adminValidate(labelType: Option[String], users: Option[String], neighborhoods: Option[String]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    checkParams(adminVersion = true, labelType, users, neighborhoods).flatMap { case (adminParams, response) =>
      if (response.header.status == 200) {
        val user: SidewalkUserWithRole = request.identity
        for {
          (mission, labelList, missionProgress, hasNextMission, completedVals) <- getDataForValidatePages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_AdminValidate")
          Ok(views.html.apps.validate(commonPageData, "Sidewalk - AdminValidate", user, adminParams, mission, labelList, missionProgress, hasNextMission, completedVals))
        }
      } else {
        Future.successful(response)
      }
    }
  }

  /**
   * Checks filtering parameters passed into the validate endpoints, and returns an error message if any are invalid.
   * @param adminVersion    Boolean indicating whether the admin version of the page is being shown.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def checkParams(adminVersion: Boolean, labelType: Option[String], users: Option[String], neighborhoods: Option[String]): Future[(AdminValidateParams, Result)] = {
    // If any inputs are invalid, send back error message. For each input, we check if the input is an integer
    // representing a valid ID (label_type_id, user_id, or region_id) or a String representing a valid name for that
    // parameter (label_type, username, or region_name).
    val parsedLabelTypeId: Option[Option[Int]] = labelType.map { lType =>
      val parsedId: Try[Int] = Try(lType.toInt)
      val lTypeIdFromName: Option[Int] = LabelTypeEnum.labelTypeToId.get(lType)
      if (parsedId.isSuccess && LabelTypeEnum.primaryLabelTypeIds.contains(parsedId.get)) parsedId.toOption
      else if (lTypeIdFromName.isDefined) lTypeIdFromName
      else None
    }
    val userIdsList: Option[Seq[Future[Option[String]]]] = users.map(_.split(',').map(_.trim).map { userStr =>
      val parsedUserId: Try[UUID] = Try(UUID.fromString(userStr))
      if (parsedUserId.isSuccess) {
        authenticationService.findByUserId(parsedUserId.get.toString).flatMap {
          case Some(u) => Future.successful(Some(u.userId))
          case None => authenticationService.findByUsername(userStr).map(_.map(_.userId))
        }
      } else {
        authenticationService.findByUsername(userStr).map(_.map(_.userId))
      }
    }.toSeq)
    val neighborhoodIdList: Option[Seq[Future[Option[Int]]]] = neighborhoods.map(_.split(",").map { regionStr =>
      val parsedRegionId: Try[Int] = Try(regionStr.toInt)
      if (parsedRegionId.isSuccess) {
        regionService.getRegion(parsedRegionId.get).flatMap {
          case Some(region) => Future.successful(Some(region.regionId))
          case None => regionService.getRegionByName(regionStr).map(_.map(_.regionId))
        }
      } else {
        regionService.getRegionByName(regionStr).map(_.map(_.regionId))
      }
    }.toSeq)
    for {
      userIds: Option[Seq[Option[String]]] <- userIdsList match {
        case Some(userIds) => Future.sequence(userIds).map(Some(_))
        case None => Future.successful(None)
      }
      regionIds: Option[Seq[Option[Int]]] <- neighborhoodIdList match {
        case Some(regionIds) => Future.sequence(regionIds).map(Some(_))
        case None => Future.successful(None)
      }
    } yield {
      // Return a BadRequest if anything is wrong, or the AdminValidateParams if everything looks good.
      if (parsedLabelTypeId.isDefined && parsedLabelTypeId.get.isEmpty) {
        (AdminValidateParams(adminVersion), BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeEnum.primaryLabelTypes.mkString(", ")}. Or you can use their IDs: ${LabelTypeEnum.primaryLabelTypeIds.mkString(", ")}."))
      } else if (userIds.isDefined && userIds.get.length != userIds.get.flatten.length) {
        (AdminValidateParams(adminVersion), BadRequest(s"One or more of the users provided were not found; please double check your list of users! You can use either their usernames or user IDs. You provided: ${users.get}"))
      } else if (regionIds.isDefined && regionIds.get.length != regionIds.get.flatten.length) {
        (AdminValidateParams(adminVersion), BadRequest(s"One or more of the neighborhoods provided were not found; please double check your list of neighborhoods! You can use either their names or IDs. You provided: ${neighborhoods.get}"))
      } else {
        (AdminValidateParams(adminVersion, parsedLabelTypeId.flatten, userIds.map(_.flatten), regionIds.map(_.flatten)), Ok(""))
      }
    }
  }

  /**
   * Get the data needed by the /validate or /mobileValidate endpoints.
   *
   * @return (mission, labelList, missionProgress, hasNextMission, completedValidations)
   */
  def getDataForValidatePages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[JsValue], Option[JsValue], Option[JsObject], Boolean, Int)] = {
    for {
      (mission, missionProgress, labels, adminData) <- labelService.getDataForValidationPages(user, labelCount, adminParams)
      completedValidations <- validationService.countValidations(user.userId)
    } yield {
      val missionJsObject: Option[JsValue] = mission.map(m => Json.toJson(m))
      val progressJsObject = missionProgress.map(p => Json.obj(
        "agree_count" -> p._1,
        "disagree_count" -> p._2,
        "unsure_count" -> p._3
      ))
      val hasDataForMission: Boolean = labels.nonEmpty
      val labelMetadataJsonSeq: Seq[JsObject] = if (adminParams.adminVersion) {
        labels.sortBy(_.labelId).zip(adminData.sortBy(_.labelId))
        .map(label => LabelFormats.validationLabelMetadataToJson(label._1, Some(label._2)))
      } else {
        labels.map(l => LabelFormats.validationLabelMetadataToJson(l))
      }
      val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
      // https://github.com/ProjectSidewalk/SidewalkWebpage/blob/develop/app/controllers/ValidateController.scala
      (missionJsObject, Some(labelMetadataJson), progressJsObject, hasDataForMission, completedValidations)
    }
  }
  /**
   * Helper function that updates database with all data submitted through the validation page.
   */
  def processValidationTaskSubmissions(data: ValidationTaskSubmission, ipAddress: String, user: SidewalkUserWithRole): Future[Result] = {
    val currTime: OffsetDateTime = data.timestamp

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
      returnValue <- labelService.getDataForValidatePostRequest(user, data.missionProgress, data.adminParams)
    } yield {
      // Put label metadata into JSON format.
      val labelMetadataJsonSeq: Seq[JsObject] = if (data.adminParams.adminVersion) {
        returnValue.labels.sortBy(_.labelId).zip(returnValue.adminData.sortBy(_.labelId))
          .map(label => LabelFormats.validationLabelMetadataToJson(label._1, Some(label._2)))
      } else {
        returnValue.labels.map(l => LabelFormats.validationLabelMetadataToJson(l))
      }
      val labelMetadataJson: JsValue = Json.toJson(labelMetadataJsonSeq)

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
        }
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
    val eligibleUser: Boolean = RoleTable.SCISTARTER_ROLES.contains(user.role)
    if (data.validations.nonEmpty && config.get[String]("environment-type") == "prod" && eligibleUser) {
      // Cap time for each validation at 1 minute.
      val timeSpent: Float = data.validations.map {
        l => Math.min(ChronoUnit.MILLIS.between(l.startTimestamp, l.endTimestamp), 60000)
      }.sum / 1000F
      configService.sendSciStarterContributions(user.email, data.validations.length, timeSpent)
    }

    response
  }

  /**
   * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
   */
  def postBeacon = cc.securityService.SecuredAction(parse.text) { implicit request =>
    val json = Json.parse(request.body)
    val submission = json.validate[ValidationTaskSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processValidationTaskSubmissions(submission, request.remoteAddress, request.identity) }
    )
  }

  /**
   * Parse submitted validation data and submit to tables.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[ValidationTaskSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processValidationTaskSubmissions(submission, request.remoteAddress, request.identity) }
    )
  }

  /**
   * Parse submitted validation data for a single label from the /labelmap endpoint.
   */
  def postLabelMapValidation = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val userId: String = request.identity.userId
    val submission = request.body.validate[LabelMapValidationSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      newVal => {
        val labelTypeId: Int = LabelTypeEnum.labelTypeToId(newVal.labelType)
        for {
          mission <- missionService.resumeOrCreateNewValidationMission(userId, "labelmapValidation", labelTypeId)
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
  def postComment = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[ValidationCommentSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        for {
          _ <- validationService.deleteCommentIfExists(submission.labelId, submission.missionId)
          commentId: Int <- validationService.insertComment(
            ValidationTaskComment(0, submission.missionId, submission.labelId, request.identity.userId,
              request.remoteAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
              Math.round(submission.zoom), submission.lat, submission.lng, OffsetDateTime.now, submission.comment))
        } yield {
          Ok(Json.obj("commend_id" -> commentId))
        }
      }
    )
  }

  /**
   * Handles a comment POST request. It parses the comment and inserts it into the comment table.
   */
  def postLabelMapComment = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[LabelMapValidationCommentSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val userId: String = request.identity.userId
        val labelTypeId: Int = LabelTypeEnum.labelTypeToId(submission.labelType)
        for {
          // Get the (or create a) mission_id for this user_id and label_type_id.
          mission <- missionService.resumeOrCreateNewValidationMission(userId, "labelmapValidation", labelTypeId)
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
  def getRandomLabelData(labelTypeId: Int, skippedLabelId: Int) = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[SkipLabelSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val adminParams: AdminValidateParams =
          if (submission.adminParams.adminVersion && isAdmin(request.identity)) submission.adminParams
          else AdminValidateParams(adminVersion = false)
        val userId: String = request.identity.userId

        // Get metadata for one new label to replace the skipped one.
        // TODO should really exclude all remaining labels in the mission, not just the skipped one. Not bothering now
        //      because it isn't a heavily used feature, and it's a rare edge case.
        labelService.retrieveLabelListForValidation(userId, n = 1, labelTypeId, adminParams.userIds.map(_.toSet).getOrElse(Set()), adminParams.neighborhoodIds.map(_.toSet).getOrElse(Set()), skippedLabelId = Some(skippedLabelId))
          .flatMap { labelMetadata =>
            if (adminParams.adminVersion) {
              labelService.getExtraAdminValidateData(Seq(labelMetadata.head.labelId)).map(adminData =>
                Ok(Json.obj(
                  "label" -> LabelFormats.validationLabelMetadataToJson(labelMetadata.head, Some(adminData.head))
                ))
              )
            } else {
              Future.successful(Ok(Json.obj(
                "label" -> LabelFormats.validationLabelMetadataToJson(labelMetadata.head)
              )))
            }
          }
      }
    )
  }
}
