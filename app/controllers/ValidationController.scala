package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.label.LabelTable.LabelValidationMetadata
import models.label.LabelValidationTable
import models.mission.{Mission, MissionTable, MissionTypeTable}
import models.validation._
import models.user._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future

class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)
  val validationMissionStr: String = "validation"
  val mobileValidationMissionStr: String = "validation"
  val rapidValidationMissionStr: String = "rapidValidation"

  /**
    * Returns the validation page with a single panorama.
    * @return
    */
  def validate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 10, validationMissionStr, "Visit_Validate")
        Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user), validationData._1, validationData._2, validationData._3, validationData._4)))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/validate"));
    }
  }

  /**
    * Returns the validation page for mobile.
    * @return
    */
  def mobileValidate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 10, mobileValidationMissionStr, "Visit_MobileValidate")
        Future.successful(Ok(views.html.mobileValidate("Project Sidewalk - Validate", Some(user), validationData._1, validationData._2, validationData._3, validationData._4)))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/mobileValidate"));
    }
  }

  /**
    * Returns the validation page with multiple panoramas.
    * @return
    */
  def rapidValidate = UserAwareAction.async { implicit request =>
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        val validationData = getDataForValidationPages(user, ipAddress, labelCount = 19, rapidValidationMissionStr, "Visit_Validate")
        Future.successful(Ok(views.html.rapidValidation("Project Sidewalk - Validate", Some(user), validationData._1, validationData._2, validationData._3, validationData._4)))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/rapidValidate"));
    }
  }

  /**
    * Get the data needed by the /validate or /rapidValidate endpoints.
    * @return (mission, labelList, missionProgress, hasNextMission)
    */
  def getDataForValidationPages(user: User, ipAddress: String, labelCount: Int, validationTypeStr: String, visitTypeStr: String): (Option[JsObject], Option[JsValue], Option[JsObject], Boolean) = {
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, visitTypeStr, timestamp))
    val possibleLabTypeIds: List[Int] = LabelTable.retrievePossibleLabelTypeIds(user.userId, labelCount, None)
    val hasWork: Boolean = possibleLabTypeIds.nonEmpty

    // Checks if there are still labels in the database for the user to validate.
    hasWork match {
      case true => {
        // possibleLabTypeIds can contain [1, 2, 3, 4, 7]. Select ids 1, 2, 3, 4 if possible, o/w choose 7.
        val possibleIds: List[Int] =
          if (possibleLabTypeIds.size > 1) possibleLabTypeIds.filter(_ != 7)
          else possibleLabTypeIds
        val index: Int = if (possibleIds.size > 1) scala.util.Random.nextInt(possibleIds.size - 1) else 0
        val labelTypeId: Int = possibleIds(index)
        val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId,
          AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION, 0.0, validationTypeStr, labelTypeId).get

        val labelList: JsValue = getLabelListForValidation(user.userId, labelTypeId, mission)
        val missionJsObject: JsObject = mission.toJSON
        val progressJsObject: JsObject = LabelValidationTable.getValidationProgress(mission.missionId)

        return (Some(missionJsObject), Some(labelList), Some(progressJsObject), true)
      }
      case false => {
        return (None, None, None, false)
      }
    }
  }

  /**
    * This gets a random list of labels to validate for this mission.
    * @param userId     User ID for current user.
    * @param labelType  Label type id of labels to retrieve.
    * @param mission    Mission object for the current mission
    * @return           JsValue containing a list of labels with the following attributes:
    *                   {label_id, label_type, gsv_panorama_id, heading, pitch, zoom, canvas_x,
    *                   canvas_y, canvas_width, canvas_height}
    */
  def getLabelListForValidation(userId: UUID, labelType: Int, mission: Mission): JsValue = {
    val missionType: String = MissionTypeTable.missionTypeIdToMissionType(mission.missionTypeId)
    val labelsProgress: Int = mission.labelsProgress.get
    val labelsToValidate: Int = MissionTable.getNumberOfLabelsToRetrieve(userId, missionType)
    val labelsToRetrieve: Int = labelsToValidate - labelsProgress

    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, labelsToRetrieve, labelType)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(label => LabelTable.validationLabelMetadataToJson(label))
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }

  /**
    * Handles a comment POST request. It parses the comment and inserts it into the comment table
    * @return
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
