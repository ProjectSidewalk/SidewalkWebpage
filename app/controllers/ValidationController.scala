package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import controllers.helper.ControllerUtils.anonSignupRedirect
import formats.json.MissionFormats._
import play.api.Configuration
import play.api.i18n.I18nSupport
import service.{LabelService, ValidationService}
import service.utils.{ConfigService, WebpageActivityService}

import scala.concurrent.ExecutionContext
//import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.{isAdmin, isMobile}
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
import play.api.i18n.MessagesApi
import play.api.mvc._
import service.utils.CityInfo

import javax.naming.AuthenticationException
import scala.concurrent.Future
import scala.util.Try

@Singleton
class ValidationController @Inject() (
                                       val messagesApi: MessagesApi,
                                       val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                       val config: Configuration,
                                       implicit val ec: ExecutionContext,
                                       labelService: LabelService,
                                       validationService: ValidationService,
                                       webpageActivityService: WebpageActivityService,
                                       configService: ConfigService
                                     ) extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] with I18nSupport {
  implicit val implicitConfig = config

  val validationMissionStr: String = "validation"

  /**
    * Returns the validation page.
    */
  def validate = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        webpageActivityService.insert(user.userId, request.remoteAddress, "Visit_Validate")

        val adminParams = AdminValidateParams(adminVersion = false)
        for {
          (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedVals) <- getDataForValidationPages(user, labelCount = 10, adminParams)
          commonPageData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          if (missionSetProgress.missionType != validationMissionStr) {
            Redirect("/explore")
          } else {
            Ok(views.html.validation(commonPageData, "Sidewalk - Validate", user, adminParams, mission, labelList, missionProgress, missionSetProgress.numComplete, hasNextMission, completedVals))
          }
        }
      case None =>
        Future.successful(anonSignupRedirect(request))
    }
  }

  /**
   * Returns the new validation that includes severity and tags page.
   */
//  def newValidateBeta = UserAwareAction.async { implicit request =>
//    if (isAdmin(request.identity)) {
//      request.identity match {
//        case Some(user) =>
//          val adminParams = AdminValidateParams(adminVersion = false)
//          val validationData = getDataForValidationPages(request, labelCount = 10, "Visit_NewValidateBeta", adminParams)
//          if (validationData._4.missionType != "validation") {
//            Future.successful(Redirect("/explore"))
//          } else {
//            val tags: List[Tag] = TagTable.getTagsForCurrentCity
//            Future.successful(Ok(views.html.newValidateBeta("Sidewalk - NewValidateBeta", Some(user), adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6, tags)))
//          }
//        case None =>
//          Future.successful(Redirect(s"/anonSignUp?url=/newValidateBeta"));
//      }
//    } else {
//      Future.failed(new AuthenticationException("This is a beta currently only open to Admins."))
//    }
//  }

  /**
    * Returns the validation page for mobile.
    */
//  def mobileValidate = UserAwareAction.async { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val adminParams = AdminValidateParams(adminVersion = false)
//        val validationData = getDataForValidationPages(request, labelCount = 10, "Visit_MobileValidate", adminParams)
//        if (validationData._4.missionType != "validation" || user.role.getOrElse("") == "Turker" || !isMobile(request)) {
//          Future.successful(Redirect("/explore"))
//        } else {
//          Future.successful(Ok(views.html.mobileValidate("Sidewalk - Validate", Some(user), adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6, validationData._7)))
//        }
//      case None =>
//        Future.successful(Redirect(s"/anonSignUp?url=/mobile"));
//    }
//  }

  /**
   * Returns an admin version of the validation page.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
//  def adminValidate(labelType: Option[String], users: Option[String], neighborhoods: Option[String]) = UserAwareAction.async { implicit request =>
//    if (isAdmin(request.identity)) {
//      // If any inputs are invalid, send back error message. For each input, we check if the input is an integer
//      // representing a valid ID (label_type_id, user_id, or region_id) or a String representing a valid name for that
//      // parameter (label_type, username, or region_name).
//      val possibleLabTypeIds: List[Int] = validationLabelTypeIds
//      val parsedLabelTypeId: Option[Option[Int]] = labelType.map { lType =>
//        val parsedId: Try[Int] = Try(lType.toInt)
//        val lTypeIdFromName: Option[Int] = LabelTypeTable.labelTypeToId(lType)
//        if (parsedId.isSuccess && possibleLabTypeIds.contains(parsedId.get)) parsedId.toOption
//        else if (lTypeIdFromName.isDefined) lTypeIdFromName
//        else None
//      }
//      val userIdsList: Option[List[Option[String]]] = users.map(_.split(',').map(_.trim).map { userStr =>
//        val parsedUserId: Option[UUID] = Try(UUID.fromString(userStr)).toOption
//        val user: Option[DBUser] = parsedUserId.flatMap(u => UserTable.findById(u))
//        val userId: Option[String] = UserTable.find(userStr).map(_.userId)
//        if (user.isDefined) Some(userStr) else if (userId.isDefined) Some(userId.get) else None
//      }.toList)
//      val neighborhoodIdList: Option[List[Option[Int]]] = neighborhoods.map(_.split(",").map { regionStr =>
//        val parsedRegionId: Try[Int] = Try(regionStr.toInt)
//        val regionFromName: Option[Region] = RegionTable.getRegionByName(regionStr)
//        if (parsedRegionId.isSuccess && RegionTable.getRegion(parsedRegionId.get).isDefined) parsedRegionId.toOption
//        else if (regionFromName.isDefined) regionFromName.map(_.regionId)
//        else None
//      }.toList)
//
//      // If any inputs are invalid (even any item in the list of users/regions), send back error message.
//      if (parsedLabelTypeId.isDefined && parsedLabelTypeId.get.isEmpty) {
//        Future.successful(BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeTable.getAllLabelTypes.filter(l => possibleLabTypeIds.contains(l.labelTypeId)).map(_.labelType).toList.reverse.mkString(", ")}. Or you can use their IDs: ${possibleLabTypeIds.mkString(", ")}."))
//      } else if (userIdsList.isDefined && userIdsList.get.length != userIdsList.get.flatten.length) {
//        Future.successful(BadRequest(s"One or more of the users provided were not found; please double check your list of users! You can use either their usernames or user IDs. You provided: ${users.get}"))
//      } else if (neighborhoodIdList.isDefined && neighborhoodIdList.get.length != neighborhoodIdList.get.flatten.length) {
//        Future.successful(BadRequest(s"One or more of the neighborhoods provided were not found; please double check your list of neighborhoods! You can use either their names or IDs. You provided: ${neighborhoods.get}"))
//      } else {
//        // If all went well, load the data for Admin Validate with the specified filters.
//        val adminParams: AdminValidateParams = AdminValidateParams(adminVersion = true, parsedLabelTypeId.flatten, userIdsList.map(_.flatten), neighborhoodIdList.map(_.flatten))
//        val validationData = getDataForValidationPages(request, labelCount=10, "Visit_AdminValidate", adminParams)
//        Future.successful(Ok(views.html.validation("Sidewalk - Admin Validate", request.identity, adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6, validationData._7)))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

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

  /**
    * Handles a comment POST request. It parses the comment and inserts it into the comment table.
    */
//  def postComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    var submission = request.body.validate[ValidationCommentSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val userId: String = request.identity match {
//          case Some(user) => user.userId
//          case None =>
//            Logger.warn("User without a user_id submitted a comment, but every user should have a user_id.")
//            val user: Option[SidewalkUserWithRole] = UserTable.find("anonymous")
//            user.get.userId
//        }
//        val ipAddress: String = request.remoteAddress
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//
//        val comment = ValidationTaskComment(0, submission.missionId, submission.labelId, userId, ipAddress,
//          submission.gsvPanoramaId, submission.heading, submission.pitch, submission.zoom, submission.lat,
//          submission.lng, timestamp, submission.comment)
//
//        val commentId: Int = ValidationTaskCommentTable.insert(comment)
//        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
//      }
//    )
//  }
}
