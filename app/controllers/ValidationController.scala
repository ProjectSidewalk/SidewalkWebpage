package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils
import formats.json.CommentSubmissionFormats._
import formats.json.LabelFormat
import models.amt.AMTAssignmentTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.label.LabelTable.LabelValidationMetadata
import models.label.LabelValidationTable
import models.mission.{Mission, MissionSetProgress, MissionTable}
import models.validation._
import models.user._
import models.utils.Configs.cityId
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._
import scala.concurrent.Future

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
        val validationData = getDataForValidationPages(user, cityId(request), ipAddress, labelCount = 10, "Visit_Validate")
        if (validationData._4.missionType != "validation") {
          Future.successful(Redirect("/explore"))
        } else {
          Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", cityId(request), Some(user), validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/validate"));
    }
  }

  /**
    * Returns the validation page for mobile.
    */
  def mobileValidate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        val validationData = getDataForValidationPages(user, cityId(request), ipAddress, labelCount = 10, "Visit_MobileValidate")
        if (validationData._4.missionType != "validation" || user.role.getOrElse("") == "Turker" || !ControllerUtils.isMobile(request)) {
          Future.successful(Redirect("/explore"))
        } else {
          Future.successful(Ok(views.html.mobileValidate("Project Sidewalk - Validate", cityId(request), Some(user), validationData._1, validationData._2, validationData._3, validationData._4.numComplete, validationData._5, validationData._6)))
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/mobile"));
    }
  }

  /**
    * Get the data needed by the /validate or /mobileValidate endpoints.
    *
    * @return (mission, labelList, missionProgress, missionSetProgress, hasNextMission, completedValidations)
    */
  def getDataForValidationPages(user: User, cityId: String, ipAddress: String, labelCount: Int, visitTypeStr: String): (Option[JsObject], Option[JsValue], Option[JsObject], MissionSetProgress, Boolean, Int) = {
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, visitTypeStr, timestamp))

    val missionSetProgress: MissionSetProgress =
      if (user.role.getOrElse("") == "Turker") MissionTable.forCity(cityId).getProgressOnMissionSet(user.username)
      else MissionTable.forCity(cityId).defaultValidationMissionSetProgress

    val possibleLabTypeIds: List[Int] = LabelTable.retrievePossibleLabelTypeIds(user.userId, cityId, labelCount, None)
    val hasWork: Boolean = possibleLabTypeIds.nonEmpty

    val completedValidations: Int = LabelValidationTable.forCity(cityId).countValidations(user.userId)
    // Checks if there are still labels in the database for the user to validate.
    if (hasWork && missionSetProgress.missionType == "validation") {
      // possibleLabTypeIds can contain [1, 2, 3, 4, 7]. Select ids 1, 2, 3, 4 if possible, o/w choose 7.
      val possibleIds: List[Int] =
        if (possibleLabTypeIds.size > 1) possibleLabTypeIds.filter(_ != 7)
        else possibleLabTypeIds
      val index: Int = if (possibleIds.size > 1) scala.util.Random.nextInt(possibleIds.size) else 0
      val labelTypeId: Int = possibleIds(index)
      val mission: Mission = MissionTable.forCity(cityId).resumeOrCreateNewValidationMission(user.userId,
        AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION, 0.0, validationMissionStr, labelTypeId).get

      val labelList: JsValue = getLabelListForValidation(user.userId, cityId, labelTypeId, mission)
      val missionJsObject: JsObject = mission.toJSON
      val progressJsObject: JsObject = LabelValidationTable.forCity(cityId).getValidationProgress(mission.missionId)

      (Some(missionJsObject), Some(labelList), Some(progressJsObject), missionSetProgress, true, completedValidations)
    } else {
      // TODO When fixing the mission sequence infrastructure (#1916), this should update that table since there are
      //      no validation missions that can be done.
      (None, None, None, missionSetProgress, false, completedValidations)
    }
  }

  /**
    * This gets a random list of labels to validate for this mission.
    * @param userId     User ID for current user.
    * @param labelType  Label type id of labels to retrieve.
    * @param mission    Mission object for the current mission
    * @return           JsValue containing a list of labels.
    */
  def getLabelListForValidation(userId: UUID, cityId: String, labelType: Int, mission: Mission): JsValue = {
    val labelsProgress: Int = mission.labelsProgress.get
    val labelsToValidate: Int = MissionTable.forCity(cityId).validationMissionLabelsToRetrieve
    val labelsToRetrieve: Int = labelsToValidate - labelsProgress

    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, cityId, labelsToRetrieve, labelType, skippedLabelId = None)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(label => LabelFormat.validationLabelMetadataToJson(label))
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
