package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.{isAdmin, isMobile}
import controllers.helper.ValidateHelper.{AdminValidateParams, getLabelTypeIdToValidate}
import formats.json.CommentSubmissionFormats._
import formats.json.LabelFormat
import models.amt.AMTAssignmentTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable, LabelValidationTable}
import models.label.LabelTable.{AdminValidationData, LabelValidationMetadata}
import models.mission.{Mission, MissionSetProgress, MissionTable}
import models.region.{Region, RegionTable}
import models.validation._
import models.user._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._
import javax.naming.AuthenticationException
import scala.concurrent.Future
import scala.util.Try

/**
 * Holds the HTTP requests associated with the validation page.
 *
 * @param env The Silhouette environment.
 */
class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val validationMissionStr: String = "validation"

  /**
    * Returns the validation page.
    */
  def validate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    request.identity match {
      case Some(user) =>
        val adminParams = AdminValidateParams(adminVersion = false)
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 10, "Visit_Validate", adminParams)
        if (validationData._4.missionType != "validation") {
          Future.successful(Redirect("/explore"))
        } else {
          Future.successful(Ok(views.html.validation("Sidewalk - Validate", Some(user), adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/validate"));
    }
  }

  /**
   * Returns the new validation that includes severity and tags page.
   */
  def valerdate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    request.identity match {
      case Some(user) =>
        val adminParams = AdminValidateParams(adminVersion = false)
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 10, "Visit_Valerdate", adminParams)
        if (validationData._4.missionType != "validation") {
          Future.successful(Redirect("/explore"))
        } else {
          Future.successful(Ok(views.html.valerdation("Sidewalk - Valerdate", Some(user), adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/valerdate"));
    }
  }

  /**
    * Returns the validation page for mobile.
    */
  def mobileValidate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        val adminParams = AdminValidateParams(adminVersion = false)
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 10, "Visit_MobileValidate", adminParams)
        if (validationData._4.missionType != "validation" || user.role.getOrElse("") == "Turker" || !isMobile(request)) {
          Future.successful(Redirect("/explore"))
        } else {
          Future.successful(Ok(views.html.mobileValidate("Sidewalk - Validate", Some(user), adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/mobile"));
    }
  }

  /**
   * Returns an admin version of the validation page.
   * @param labelType       Label type or label type ID to validate.
   * @param users           Comma-separated list of usernames or user IDs to validate (could be mixed).
   * @param neighborhoods   Comma-separated list of neighborhood names or region IDs to validate (could be mixed).
   */
  def adminValidate(labelType: Option[String], users: Option[String], neighborhoods: Option[String]) = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress
    if (isAdmin(request.identity)) {
      // If any inputs are invalid, send back error message. For each input, we check if the input is an integer
      // representing a valid ID (label_type_id, user_id, or region_id) or a String representing a valid name for that
      // parameter (label_type, username, or region_name).
      val possibleLabTypeIds: List[Int] = LabelTable.valLabelTypeIds
      val parsedLabelTypeId: Option[Option[Int]] = labelType.map { lType =>
        val parsedId: Try[Int] = Try(lType.toInt)
        val lTypeIdFromName: Option[Int] = LabelTypeTable.labelTypeToId(lType)
        if (parsedId.isSuccess && possibleLabTypeIds.contains(parsedId.get)) parsedId.toOption
        else if (lTypeIdFromName.isDefined) lTypeIdFromName
        else None
      }
      val userIdsList: Option[List[Option[String]]] = users.map(_.split(',').map(_.trim).map { userStr =>
        val parsedUserId: Option[UUID] = Try(UUID.fromString(userStr)).toOption
        val user: Option[DBUser] = parsedUserId.flatMap(u => UserTable.findById(u))
        val userId: Option[String] = UserTable.find(userStr).map(_.userId)
        if (user.isDefined) Some(userStr) else if (userId.isDefined) Some(userId.get) else None
      }.toList)
      val neighborhoodIdList: Option[List[Option[Int]]] = neighborhoods.map(_.split(",").map { regionStr =>
        val parsedRegionId: Try[Int] = Try(regionStr.toInt)
        val regionFromName: Option[Region] = RegionTable.getRegionByName(regionStr)
        if (parsedRegionId.isSuccess && RegionTable.getRegion(parsedRegionId.get).isDefined) parsedRegionId.toOption
        else if (regionFromName.isDefined) regionFromName.map(_.regionId)
        else None
      }.toList)

      // If any inputs are invalid (even any item in the list of users/regions), send back error message.
      if (parsedLabelTypeId.isDefined && parsedLabelTypeId.get.isEmpty) {
        Future.successful(BadRequest(s"Invalid label type provided: ${labelType.get}. Valid label types are: ${LabelTypeTable.getAllLabelTypes.filter(l => possibleLabTypeIds.contains(l.labelTypeId)).map(_.labelType).toList.reverse.mkString(", ")}. Or you can use their IDs: ${possibleLabTypeIds.mkString(", ")}."))
      } else if (userIdsList.isDefined && userIdsList.get.length != userIdsList.get.flatten.length) {
        Future.successful(BadRequest(s"One or more of the users provided were not found; please double check your list of users! You can use either their usernames or user IDs. You provided: ${users.get}"))
      } else if (neighborhoodIdList.isDefined && neighborhoodIdList.get.length != neighborhoodIdList.get.flatten.length) {
        Future.successful(BadRequest(s"One or more of the neighborhoods provided were not found; please double check your list of neighborhoods! You can use either their names or IDs. You provided: ${neighborhoods.get}"))
      } else {
        // If all went well, load the data for Admin Validate with the specified filters.
        val adminParams: AdminValidateParams = AdminValidateParams(adminVersion = true, parsedLabelTypeId.flatten, userIdsList.map(_.flatten), neighborhoodIdList.map(_.flatten))
        val validationData = getDataForValidationPages(request.identity.get, ipAddress, labelCount=10, "Visit_AdminValidate", adminParams)
        Future.successful(Ok(views.html.validation("Sidewalk - Admin Validate", request.identity, adminParams, validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
      }
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Get the data needed by the /validate or /mobileValidate endpoints.
    *
    * @return (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedValidations)
    */
  def getDataForValidationPages(user: User, ipAddress: String, labelCount: Int, visitTypeStr: String, adminParams: AdminValidateParams): (Option[JsObject], Option[JsValue], Option[JsObject], MissionSetProgress, Boolean, Int) = {
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, visitTypeStr, timestamp))

    val missionSetProgress: MissionSetProgress =
      if (user.role.getOrElse("") == "Turker") MissionTable.getProgressOnMissionSet(user.username)
      else MissionTable.defaultValidationMissionSetProgress

    val labelTypeId: Option[Int] = getLabelTypeIdToValidate(user.userId, labelCount, adminParams.labelTypeId)

    val completedValidations: Int = LabelValidationTable.countValidations(user.userId)
    // Checks if there are still labels in the database for the user to validate.
    if (labelTypeId.isDefined && missionSetProgress.missionType == "validation") {
      val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(
        user.userId, AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION, 0.0, validationMissionStr, labelTypeId.get
      ).get

      val labelList: JsValue = getLabelListForValidation(user.userId, labelTypeId.get, mission, adminParams)
      val missionJsObject: JsObject = mission.toJSON
      val progressJsObject: JsObject = LabelValidationTable.getValidationProgress(mission.missionId)
      val hasDataForMission: Boolean = labelList.toString != "[]"

      (Some(missionJsObject), Some(labelList), Some(progressJsObject), missionSetProgress, hasDataForMission, completedValidations)
    } else {
      // TODO When fixing the mission sequence infrastructure (#1916), this should update that table since there are
      //      no validation missions that can be done.
      (None, None, None, missionSetProgress, false, completedValidations)
    }
  }

  /**
    * This gets a random list of labels to validate for this mission.
    * @param userId      User ID for current user.
    * @param labelType   Label type id of labels to retrieve.
    * @param mission     Mission object for the current mission
    * @param adminParams Parameters related to the admin version of the validate page.
    * @return            JsValue containing a list of labels.
    */
  def getLabelListForValidation(userId: UUID, labelType: Int, mission: Mission, adminParams: AdminValidateParams): JsValue = {
    val labelsProgress: Int = mission.labelsProgress.get
    val labelsToValidate: Int = MissionTable.validationMissionLabelsToRetrieve
    val labelsToRetrieve: Int = labelsToValidate - labelsProgress

    // Get list of labels and their metadata for Validate page. Get extra metadata if it's for Admin Validate.
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, labelsToRetrieve, labelType, adminParams.userIds, adminParams.neighborhoodIds)
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
    * Handles a comment POST request. It parses the comment and inserts it into the comment table.
    */
  def postComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[ValidationCommentSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            Logger.warn("User without a user_id submitted a comment, but every user should have a user_id.")
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }
        val ipAddress: String = request.remoteAddress
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

        val comment = ValidationTaskComment(0, submission.missionId, submission.labelId, userId,
          ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
          submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)

        val commentId: Int = ValidationTaskCommentTable.save(comment)
        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
      }
    )
  }
}
