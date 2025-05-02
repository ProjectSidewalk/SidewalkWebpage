package controllers

import controllers.base._
import controllers.helper.ControllerUtils.isMobile
import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.LabelFormats
import formats.json.MissionFormats._
import models.auth.WithAdmin
import models.label.{LabelTypeTable, Tag}
import models.user._
import play.api.Configuration
import play.api.libs.json._
import play.api.mvc.Result

import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@Singleton
class ValidationController @Inject() (cc: CustomControllerComponents,
//                                      val silhouette: Silhouette[DefaultEnv],
                                      val config: Configuration,
                                      implicit val ec: ExecutionContext,
                                      labelService: service.LabelService,
                                      validationService: service.ValidationService,
                                      authenticationService: service.AuthenticationService,
                                      regionService: service.RegionService,
                                      configService: service.ConfigService
                                     )(implicit assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config

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
      val lTypeIdFromName: Option[Int] = LabelTypeTable.labelTypeToId.get(lType)
      if (parsedId.isSuccess && LabelTypeTable.primaryLabelTypeIds.contains(parsedId.get)) parsedId.toOption
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
        (AdminValidateParams(adminVersion), BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeTable.primaryLabelTypes.mkString(", ")}. Or you can use their IDs: ${LabelTypeTable.primaryLabelTypeIds.mkString(", ")}."))
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
      // https://github.com/ProjectSidewalk/SidewalkWebpage/blob/develop/app/controllers/ValidationController.scala
      (missionJsObject, Some(labelMetadataJson), progressJsObject, hasDataForMission, completedValidations)
    }
  }
}
