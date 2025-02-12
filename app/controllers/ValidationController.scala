package controllers

import java.util.UUID
import javax.inject.{Inject, Singleton}
import io.github.honeycombcheesecake.play.silhouette.api.Silhouette
import models.auth.{DefaultEnv, WithAdmin}
import controllers.base._
import formats.json.MissionFormats._
import play.api.Configuration
import service.region.RegionService
import service.user.UserService
import service.{LabelService, ValidationService}
import service.utils.ConfigService


import scala.concurrent.ExecutionContext

import controllers.helper.ControllerUtils.isMobile
import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.CommentSubmissionFormats._
import formats.json.LabelFormat
import models.amt.AMTAssignmentTable
import models.label.{LabelTable, LabelTypeTable, LabelValidationTable, Tag, TagTable}
//import models.label.LabelTable.{AdminValidationData, LabelValidationMetadata}
import models.mission.{Mission, MissionSetProgress, MissionTable}
import models.region.{Region, RegionTable}
import models.validation._
import models.user._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._
import service.utils.CityInfo

import javax.naming.AuthenticationException
import scala.concurrent.Future
import scala.util.Try

@Singleton
class ValidationController @Inject() (
                                       cc: CustomControllerComponents,
//                                       val silhouette: Silhouette[DefaultEnv],
                                       val config: Configuration,
                                       implicit val ec: ExecutionContext,
                                       labelService: LabelService,
                                       validationService: ValidationService,
                                       userService: UserService,
                                       regionService: RegionService,
                                       configService: ConfigService
                                     )(implicit assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config

  val validationMissionStr: String = "validation"

  /**
    * Returns the validation page.
    */
  def validate = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val adminParams = AdminValidateParams(adminVersion = false)
    for {
      (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedVals)
        <- getDataForValidationPages(user, labelCount = 10, adminParams)
      commonPageData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      if (missionSetProgress.missionType != validationMissionStr) {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_Validate_RedirectExplore")
        Redirect("/explore")
      } else {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_Validate")
        Ok(views.html.validation(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, missionSetProgress.numComplete, hasNextMission, completedVals))
      }
    }
  }

  /**
   * Returns the new validation that includes severity and tags page.
   */
  def newValidateBeta = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val adminParams = AdminValidateParams(adminVersion = false)
    for {
      (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedVals)
        <- getDataForValidationPages(user, labelCount = 10, adminParams)
      commonPageData <- configService.getCommonPageData(request2Messages.lang)
      tags: Seq[Tag] <- labelService.getTagsForCurrentCity
    } yield {
      if (missionSetProgress.missionType != validationMissionStr) {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_NewValidateBeta_RedirectExplore")
        Redirect("/explore")
      } else {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_NewValidateBeta")
        Ok(views.html.newValidateBeta(commonPageData, "Sidewalk - NewValidateBeta", user, adminParams, mission, labelList, missionProgress, missionSetProgress.numComplete, hasNextMission, completedVals, tags))
      }
    }
  }

  /**
    * Returns the validation page for mobile.
    */
  def mobileValidate = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val adminParams = AdminValidateParams(adminVersion = false)
    for {
      (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedVals)
        <- getDataForValidationPages(user, labelCount = 10, adminParams)
      commonPageData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      if ((missionSetProgress.missionType != validationMissionStr && user.role == "Turker") || !isMobile(request)) {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_MobileValidate_RedirectExplore")
        Redirect("/explore")
      } else {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_MobileValidate")
        Ok(views.html.mobileValidate(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, missionSetProgress.numComplete, hasNextMission, completedVals))
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
    val user: SidewalkUserWithRole = request.identity
    // If any inputs are invalid, send back error message. For each input, we check if the input is an integer
    // representing a valid ID (label_type_id, user_id, or region_id) or a String representing a valid name for that
    // parameter (label_type, username, or region_name).
    val parsedLabelTypeId: Option[Option[Int]] = labelType.map { lType =>
      val parsedId: Try[Int] = Try(lType.toInt)
      val lTypeIdFromName: Option[Int] = LabelTypeTable.labelTypeToId.get(lType)
      if (parsedId.isSuccess && LabelTypeTable.validationLabelTypeIds.contains(parsedId.get)) parsedId.toOption
      else if (lTypeIdFromName.isDefined) lTypeIdFromName
      else None
    }
    val userIdsList: Option[Seq[Future[Option[String]]]] = users.map(_.split(',').map(_.trim).map { userStr =>
      val parsedUserId: Try[UUID] = Try(UUID.fromString(userStr))
      if (parsedUserId.isSuccess) {
        userService.findByUserId(parsedUserId.get.toString).flatMap {
          case Some(u) => Future.successful(Some(u.userId))
          case None => userService.findByUsername(userStr).map(_.map(_.userId))
        }
      } else {
        userService.findByUsername(userStr).map(_.map(_.userId))
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

    (for {
      userIds: Option[Seq[Option[String]]] <- userIdsList match {
        case Some(userIds) => Future.sequence(userIds).map(Some(_))
        case None => Future.successful(None)
      }
      regionIds: Option[Seq[Option[Int]]] <- neighborhoodIdList match {
        case Some(regionIds) => Future.sequence(regionIds).map(Some(_))
        case None => Future.successful(None)
      }
    } yield {
      if (parsedLabelTypeId.isDefined && parsedLabelTypeId.get.isEmpty) {
        Future.successful(BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeTable.validationLabelTypes.mkString(", ")}. Or you can use their IDs: ${LabelTypeTable.validationLabelTypeIds.mkString(", ")}."))
      } else if (userIds.isDefined && userIds.get.length != userIds.get.flatten.length) {
        Future.successful(BadRequest(s"One or more of the users provided were not found; please double check your list of users! You can use either their usernames or user IDs. You provided: ${users.get}"))
      } else if (regionIds.isDefined && regionIds.get.length != regionIds.get.flatten.length) {
        Future.successful(BadRequest(s"One or more of the neighborhoods provided were not found; please double check your list of neighborhoods! You can use either their names or IDs. You provided: ${neighborhoods.get}"))
      } else {
        cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_AdminValidate")
        val adminParams = AdminValidateParams(adminVersion = true, parsedLabelTypeId.flatten, userIds.map(_.flatten), regionIds.map(_.flatten))
        for {
          (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedVals)
            <- getDataForValidationPages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          Ok(views.html.validation(commonPageData, "Sidewalk - AdminValidate", user, adminParams, mission, labelList, missionProgress, missionSetProgress.numComplete, hasNextMission, completedVals))
        }
      }
    }).flatMap(identity) // Flatten the Future[Future[T]] to Future[T].
  }

  /**
    * Get the data needed by the /validate or /mobileValidate endpoints.
    *
    * @return (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedValidations)
    */
  def getDataForValidationPages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[JsValue], Option[JsValue], Option[JsObject], MissionSetProgress, Boolean, Int)] = {
    for {
      (mission, missionSetProgress, missionProgress, labels, adminData) <- labelService.getDataForValidationPages(user, labelCount, adminParams)
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
        .map(label => LabelFormat.validationLabelMetadataToJson(label._1, Some(label._2)))
      } else {
        labels.map(l => LabelFormat.validationLabelMetadataToJson(l))
      }
      val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
      // https://github.com/ProjectSidewalk/SidewalkWebpage/blob/develop/app/controllers/ValidationController.scala
      (missionJsObject, Some(labelMetadataJson), progressJsObject, missionSetProgress, hasDataForMission, completedValidations)
    }
  }
}
