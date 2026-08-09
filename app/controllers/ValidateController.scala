package controllers

import controllers.base._
import controllers.helper.ControllerUtils.isMobile
import controllers.helper.ValidateHelper.ValidateParams
import formats.json.CommentSubmissionFormats.LabelMapValidationCommentSubmission
import formats.json.LabelFormats
import formats.json.MissionFormats._
import formats.json.ValidateFormats.{
  EnvironmentSubmission,
  LabelMapValidationSubmission,
  MoreLabelsRequest,
  ValidationTaskSubmission
}
import models.auth.WithAdmin
import models.label.{LabelTypeEnum, Tag}
import models.mission.MissionType
import models.user._
import models.validation.{LabelValidation, ValidationTaskComment, ValidationTaskEnvironment, ValidationTaskInteraction}
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.Result
import service.ValidationSubmission

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

case class ValidatePageData(
    mission: Option[JsValue],
    labelList: Option[JsValue],
    missionProgress: Option[JsObject],
    hasNextMission: Boolean,
    completedValidations: Int,
    tagList: Seq[Tag]
)

@Singleton
class ValidateController @Inject() (
    cc: CustomControllerComponents,
    implicit val ec: ExecutionContext,
    val config: Configuration,
    configService: service.ConfigService,
    labelService: service.LabelService,
    validationService: service.ValidationService,
    authenticationService: service.AuthenticationService,
    regionService: service.RegionService,
    panoDataService: service.PanoDataService,
    osmWayService: service.OsmWayService,
    missionService: service.MissionService
)(implicit assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Returns the validation page.
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   * @param unvalidatedOnly Boolean indicating whether to show only labels with no prior validations.
   */
  def validate(neighborhoods: Option[String], unvalidatedOnly: Option[Boolean]) =
    cc.securityService.SecuredAction { implicit request =>
      if (isMobile(request)) {
        // mobileValidate takes the same query params, so forward them along with the redirect.
        cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Validate_RedirectMobile")
        Future.successful(Redirect("/mobile", request.queryString))
      } else {
        checkParams(adminVersion = false, None, None, neighborhoods, unvalidatedOnly).flatMap {
          case (validateParams, response) =>
            if (response.header.status == 200) {
              val user: SidewalkUserWithRole = request.identity
              for {
                validatePageData <- getDataForValidatePages(user, labelCount = 10, validateParams)
                commonPageData   <- configService.getCommonPageData(request2Messages.lang)
              } yield {
                cc.loggingService.insert(user.userId, request.ipAddress, "Visit_Validate")
                Ok(
                  views.html.apps.validate(commonPageData, "/validate", Messages("seo.title.validate"), user,
                    validateParams, validatePageData)
                )
              }
            } else {
              Future.successful(response)
            }
        }
      }
    }

  /**
   * Returns the Expert Validate page, optionally with some admin filters.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   * @param unvalidatedOnly Boolean indicating whether to show only labels with no prior validations.
   */
  def expertValidate(
      labelType: Option[String],
      users: Option[String],
      neighborhoods: Option[String],
      unvalidatedOnly: Option[Boolean]
  ) =
    cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
      if (isMobile(request)) {
        cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_ExpertValidate_RedirectMobile")
        Future.successful(Redirect("/mobile"))
      } else {
        checkParams(adminVersion = true, labelType, users, neighborhoods, unvalidatedOnly).flatMap {
          case (validateParams, response) =>
            if (response.header.status == 200) {
              val user: SidewalkUserWithRole = request.identity
              for {
                validatePageData <- getDataForValidatePages(user, labelCount = 10, validateParams)
                commonPageData   <- configService.getCommonPageData(request2Messages.lang)
              } yield {
                cc.loggingService.insert(user.userId, request.ipAddress, "Visit_ExpertValidate")
                Ok(
                  views.html.apps.validate(commonPageData, "/expertValidate", Messages("seo.title.expert.validate"),
                    user, validateParams, validatePageData)
                )
              }
            } else {
              Future.successful(response)
            }
        }
      }
    }

  /**
   * Returns the validation page for mobile.
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   * @param unvalidatedOnly Boolean indicating whether to show only labels with no prior validations.
   */
  def mobileValidate(neighborhoods: Option[String], unvalidatedOnly: Option[Boolean]) =
    cc.securityService.SecuredAction { implicit request =>
      checkParams(adminVersion = false, None, None, neighborhoods, unvalidatedOnly).flatMap {
        case (validateParams, response) =>
          if (response.header.status == 200) {
            val user: SidewalkUserWithRole = request.identity
            for {
              validatePageData <- getDataForValidatePages(user, labelCount = 10, validateParams)
              commonPageData   <- configService.getCommonPageData(request2Messages.lang)
            } yield {
              if (!isMobile(request)) {
                cc.loggingService.insert(user.userId, request.ipAddress, "Visit_MobileValidate_RedirectHome")
                Redirect("/")
              } else {
                cc.loggingService.insert(user.userId, request.ipAddress, "Visit_MobileValidate")
                Ok(
                  views.html.apps.mobileValidate(commonPageData, Messages("seo.title.validate"), user, validateParams,
                    validatePageData)
                )
              }
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
   * @param unvalidatedOnly Boolean indicating whether to show only labels with no prior validations.
   */
  def checkParams(
      adminVersion: Boolean,
      labelType: Option[String],
      users: Option[String],
      neighborhoods: Option[String],
      unvalidatedOnly: Option[Boolean]
  ): Future[(ValidateParams, Result)] = {
    // If any inputs are invalid, send back error message. For each input, we check if the input is an integer
    // representing a valid ID (label_type_id, user_id, or region_id) or a String representing a valid name for that
    // parameter (label_type, username, or region_name).
    val parsedLabelType: Option[Option[LabelTypeEnum.Base]] = labelType.map { lType =>
      val lTypeFromId: Option[LabelTypeEnum.Base]   = lType.toIntOption.flatMap(LabelTypeEnum.byId.get)
      val lTypeFromName: Option[LabelTypeEnum.Base] = LabelTypeEnum.byName.get(lType)
      if (lTypeFromId.isDefined) lTypeFromId
      else if (lTypeFromName.isDefined) lTypeFromName
      else None
    }
    val userIdsList: Option[Seq[Future[Option[String]]]] = users.map(
      _.split(',')
        .map(_.trim)
        .map { userStr =>
          val parsedUserId: Try[UUID] = Try(UUID.fromString(userStr))
          if (parsedUserId.isSuccess) {
            authenticationService.findByUserId(parsedUserId.get.toString).flatMap {
              case Some(u) => Future.successful(Some(u.userId))
              case None    => authenticationService.findByUsername(userStr).map(_.map(_.userId))
            }
          } else {
            authenticationService.findByUsername(userStr).map(_.map(_.userId))
          }
        }
        .toSeq
    )
    val neighborhoodIdList: Option[Seq[Future[Option[Int]]]] = neighborhoods.map(
      _.split(",")
        .map { regionStr =>
          val parsedRegionId: Try[Int] = Try(regionStr.toInt)
          if (parsedRegionId.isSuccess) {
            regionService.getRegion(parsedRegionId.get).flatMap {
              case Some(region) => Future.successful(Some(region.regionId))
              case None         => regionService.getRegionByName(regionStr).map(_.map(_.regionId))
            }
          } else {
            regionService.getRegionByName(regionStr).map(_.map(_.regionId))
          }
        }
        .toSeq
    )
    for {
      userIds: Option[Seq[Option[String]]] <- userIdsList match {
        case Some(userIds) => Future.sequence(userIds).map(Some(_))
        case None          => Future.successful(None)
      }
      regionIds: Option[Seq[Option[Int]]] <- neighborhoodIdList match {
        case Some(regionIds) => Future.sequence(regionIds).map(Some(_))
        case None            => Future.successful(None)
      }
    } yield {
      // Return a BadRequest if anything is wrong, or the ValidateParams if everything looks good.
      if (parsedLabelType.isDefined && parsedLabelType.get.isEmpty) {
        (
          ValidateParams(adminVersion),
          BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeEnum.primaryLabelTypeNames.mkString(", ")}. Or you can use their IDs: ${LabelTypeEnum.primaryLabelTypeIds.mkString(", ")}.")
        )
      } else if (userIds.isDefined && userIds.get.length != userIds.get.flatten.length) {
        (
          ValidateParams(adminVersion),
          BadRequest(s"One or more of the users provided were not found; please double check your list of users! You can use either their usernames or user IDs. You provided: ${users.get}")
        )
      } else if (regionIds.isDefined && regionIds.get.length != regionIds.get.flatten.length) {
        (
          ValidateParams(adminVersion),
          BadRequest(s"One or more of the neighborhoods provided were not found; please double check your list of neighborhoods! You can use either their names or IDs. You provided: ${neighborhoods.get}")
        )
      } else {
        (
          ValidateParams(
            adminVersion, parsedLabelType.flatten, userIds.map(_.flatten), regionIds.map(_.flatten),
            unvalidatedOnly.getOrElse(false)
          ),
          Ok("")
        )
      }
    }
  }

  /**
   * Get the data needed by the /validate or /mobileValidate endpoints.
   *
   * @return (mission, labelList, missionProgress, hasNextMission, completedValidations)
   */
  def getDataForValidatePages(
      user: SidewalkUserWithRole,
      labelCount: Int,
      validateParams: ValidateParams
  ): Future[ValidatePageData] = {
    for {
      (mission, missionProgress, labels, adminData) <-
        labelService.getDataForValidationPages(user, labelCount, validateParams)
      completedValidations <- validationService.countValidations(user.userId)
      tags: Seq[Tag]       <- labelService.getTagsForCurrentCity
      maxSpeeds            <- osmWayService.getMaxSpeedsForStreets(labels.map(_.streetEdgeId).distinct)
    } yield {
      val missionJsObject: Option[JsValue] = mission.map(m => Json.toJson(m))
      val progressJsObject                 =
        missionProgress.map(p => Json.obj("agree_count" -> p._1, "disagree_count" -> p._2, "unsure_count" -> p._3))
      val hasDataForMission: Boolean          = labels.nonEmpty
      val labelMetadataJsonSeq: Seq[JsObject] = if (validateParams.adminVersion) {
        labels.sortBy(_.labelId).zip(adminData.sortBy(_.labelId)).map { case (l, admin) =>
          LabelFormats.validationLabelMetadataToJson(
            l,
            panoDataService.backupImageUrl(l.panoId),
            Some(admin),
            maxSpeed = maxSpeeds.get(l.streetEdgeId)
          )
        }
      } else {
        labels.map { l =>
          LabelFormats.validationLabelMetadataToJson(
            l,
            panoDataService.backupImageUrl(l.panoId),
            maxSpeed = maxSpeeds.get(l.streetEdgeId)
          )
        }
      }
      val labelMetadataJson: JsValue = Json.toJson(labelMetadataJsonSeq)
      ValidatePageData(missionJsObject, Some(labelMetadataJson), progressJsObject, hasDataForMission,
        completedValidations, tags)
    }
  }

  /**
   * Helper function that updates database with all data submitted through the validation page.
   */
  private def processValidationTaskSubmissions(
      data: ValidationTaskSubmission,
      ipAddress: String,
      user: SidewalkUserWithRole
  ): Future[Result] = {
    val currTime: OffsetDateTime = data.timestamp

    // First do all the important stuff that needs to be done synchronously.
    val response: Future[Result] = for {
      // Insert validations and comments (if there are any).
      _ <- validationService.submitValidations(data.validations.map { newVal =>
        ValidationSubmission(
          LabelValidation(0, newVal.labelId, newVal.validationResult, newVal.oldSeverity, newVal.newSeverity,
            newVal.oldTags, newVal.newTags, user.userId, newVal.missionId, newVal.canvasX, newVal.canvasY,
            newVal.heading, newVal.pitch, newVal.zoom, newVal.canvasHeight, newVal.canvasWidth, newVal.startTimestamp,
            newVal.endTimestamp, newVal.source, newVal.viewerType),
          newVal.comment.map(c =>
            ValidationTaskComment(
              0, c.missionId, c.labelId, user.userId, ipAddress, c.panoId, c.heading, c.pitch, c.zoom, c.lat, c.lng,
              currTime, c.comment
            )
          ),
          newVal.undone,
          newVal.redone
        )
      })

      // Get data to return in POST response. Not much unless the mission is over and we need the next batch of labels.
      returnValue <- labelService.getDataForValidatePostRequest(user, data.missionProgress, data.validateParams)
      maxSpeeds   <- osmWayService.getMaxSpeedsForStreets(returnValue.labels.map(_.streetEdgeId).distinct)
    } yield {
      val labelMetadataJsonSeq: Seq[JsObject] = if (data.validateParams.adminVersion) {
        returnValue.labels.sortBy(_.labelId).zip(returnValue.adminData.sortBy(_.labelId)).map { case (l, admin) =>
          LabelFormats.validationLabelMetadataToJson(
            l,
            panoDataService.backupImageUrl(l.panoId),
            Some(admin),
            maxSpeed = maxSpeeds.get(l.streetEdgeId)
          )
        }
      } else {
        returnValue.labels.map { l =>
          LabelFormats.validationLabelMetadataToJson(
            l,
            panoDataService.backupImageUrl(l.panoId),
            maxSpeed = maxSpeeds.get(l.streetEdgeId)
          )
        }
      }
      Ok(
        Json.obj(
          "has_mission_available" -> returnValue.hasMissionAvailable,
          "mission"               -> returnValue.mission.map(m => Json.toJson(m)),
          "labels"                -> Json.toJson(labelMetadataJsonSeq),
          "progress"              -> returnValue.progress.map { case (agreeCount, disagreeCount, unsureCount) =>
            Json.obj("agree_count" -> agreeCount, "disagree_count" -> disagreeCount, "unsure_count" -> unsureCount)
          }
        )
      )
    }

    // Now we do all the stuff that can be done async, we can return the response before these are done.
    // Insert interactions async.
    validationService.insertMultipleInteractions(data.interactions.map { action =>
      ValidationTaskInteraction(0, action.missionId, action.action, action.panoId, action.lat, action.lng,
        action.heading, action.pitch, action.zoom, action.note, action.timestamp, data.source)
    })

    // Insert Environment async.
    val env: EnvironmentSubmission = data.environment
    validationService.insertEnvironment(
      ValidationTaskEnvironment(0, env.missionId, env.browser, env.browserVersion, env.browserWidth, env.browserHeight,
        env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(ipAddress),
        env.language, env.cssZoom, Some(currTime))
    )

    // Adding the new panorama information to the pano_history table async.
    panoDataService.insertPanoHistories(data.panoHistories)

    // Send contributions to SciStarter async so that it can be recorded in their user dashboard there.
    val eligibleUser: Boolean = RoleTable.SCISTARTER_ROLES.contains(user.role)
    if (data.validations.nonEmpty && config.get[String]("environment-type") == "prod" && eligibleUser) {
      // Cap time for each validation at 1 minute.
      val timeSpent: Double = data.validations.map { l =>
        Math.min(ChronoUnit.MILLIS.between(l.startTimestamp, l.endTimestamp), 60000)
      }.sum / 1000d
      configService.sendSciStarterContributions(user.email, data.validations.length, timeSpent)
    }

    response
  }

  /**
   * Parse submitted validation data and submit to tables.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[ValidationTaskSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processValidationTaskSubmissions(submission, request.ipAddress, request.identity) }
    )
  }

  /**
   * Hands Validate replacement labels for a mission that ran out of them mid-mission (#4810).
   *
   * Validate receives exactly as many labels as its mission still needs, so a label whose imagery turns out not to
   * render leaves the mission unfinishable. This is the only way to top the queue back up: the mission-complete
   * response is the only other place labels are handed out, and it fires a mission too late to help.
   *
   * The request names every label the client already holds so a replacement can't duplicate one — the client's
   * validations may not have reached the database yet, so the query's own "already validated by this user" filter
   * isn't enough on its own. An empty `labels` array is a real answer: there is nothing left for this user to
   * validate, which is exactly when the no-more-labels modal is the truth.
   */
  def getMoreLabels = cc.securityService.SecuredAction(parse.json) { implicit request =>
    request.body
      .validate[MoreLabelsRequest]
      .fold(
        errors => Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))),
        moreLabels => {
          // Expert Validate's extra per-label data (the labeler's username, who else has validated it) is gated on
          // the user's actual role, not on the adminVersion flag in the request body. ADMIN_ROLES is the same set
          // `WithAdmin` checks on /expertValidate, the only place adminVersion is ever set — keep the two together
          // if that page's gate ever widens. The region and unvalidated-only filters are available to everyone on
          // plain /validate, so they carry over either way.
          val isAdmin: Boolean           = RoleTable.ADMIN_ROLES.contains(request.identity.role)
          val validateParams             = moreLabels.validateParams
          val safeParams: ValidateParams =
            if (isAdmin) validateParams
            else
              ValidateParams(
                adminVersion = false,
                neighborhoodIds = validateParams.neighborhoodIds,
                unvalidatedOnly = validateParams.unvalidatedOnly
              )
          for {
            (labels, adminData) <- labelService.getMoreLabelsToValidate(request.identity, moreLabels.labelTypeId,
              moreLabels.labelsNeeded, moreLabels.excludedLabelIds.toSet, safeParams)
            maxSpeeds <- osmWayService.getMaxSpeedsForStreets(labels.map(_.streetEdgeId).distinct)
          } yield {
            val labelMetadataJsonSeq: Seq[JsObject] = if (safeParams.adminVersion) {
              labels.sortBy(_.labelId).zip(adminData.sortBy(_.labelId)).map { case (l, admin) =>
                LabelFormats.validationLabelMetadataToJson(
                  l,
                  panoDataService.backupImageUrl(l.panoId),
                  Some(admin),
                  maxSpeed = maxSpeeds.get(l.streetEdgeId)
                )
              }
            } else {
              labels.map { l =>
                LabelFormats.validationLabelMetadataToJson(
                  l,
                  panoDataService.backupImageUrl(l.panoId),
                  maxSpeed = maxSpeeds.get(l.streetEdgeId)
                )
              }
            }
            Ok(Json.obj("labels" -> Json.toJson(labelMetadataJsonSeq)))
          }
        }
      )
  }

  /**
   * Parse submitted validation data for a single label from the /labelmap endpoint.
   *
   * Also handles clearing a vote (#4653): a submission with `undone = true` carries the vote being cleared as its
   * `validationResult` and deletes that validation (and the user's comment on the label) instead of inserting one —
   * the same path Validate's undo button uses.
   */
  def postLabelMapValidation = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val userId: String = request.identity.userId
    val submission     = request.body.validate[LabelMapValidationSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      newVal => {
        for {
          mission <- missionService.resumeOrCreateNewValidateMission(
            userId,
            MissionType.LabelmapValidation,
            newVal.labelType.id
          )
          newValIds <- validationService.submitValidations(
            Seq(
              ValidationSubmission(
                LabelValidation(0, newVal.labelId, newVal.validationResult, newVal.oldSeverity, newVal.newSeverity,
                  newVal.oldTags, newVal.newTags, userId, mission.get.missionId, newVal.canvasX, newVal.canvasY,
                  newVal.heading, newVal.pitch, newVal.zoom, newVal.canvasHeight, newVal.canvasWidth,
                  newVal.startTimestamp, newVal.endTimestamp, newVal.source, newVal.viewerType),
                comment = None,
                newVal.undone,
                newVal.redone
              )
            )
          )
        } yield {
          Ok(Json.obj("status" -> "Success"))
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
        val userId: String   = request.identity.userId
        val labelTypeId: Int = LabelTypeEnum.labelTypeToId(submission.labelType)
        for {
          // Get the (or create a) mission_id for this user_id and label_type_id.
          mission <- missionService.resumeOrCreateNewValidateMission(
            userId,
            MissionType.LabelmapValidation,
            labelTypeId
          )
          _              <- validationService.deleteCommentIfExists(submission.labelId, userId)
          commentId: Int <- validationService.insertComment(
            ValidationTaskComment(0, mission.get.missionId, submission.labelId, userId, request.ipAddress,
              submission.panoId, submission.heading, submission.pitch, submission.zoom, submission.lat, submission.lng,
              OffsetDateTime.now, submission.comment)
          )
        } yield {
          Ok(Json.obj("comment_id" -> commentId, "username" -> request.identity.username))
        }
      }
    )
  }

}
