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
import models.mission.Mission
import models.mission.MissionTable
import models.validation._
import models.user._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future
import scala.collection.mutable.ListBuffer

class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns the validation page.
    * @return
    */
  def validate = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Validate", timestamp))
        val possibleLabelTypeIds: List[Int] = LabelTable.retrievePossibleLabelTypeIds(user.userId, 10, None)
        val hasWork: Boolean = possibleLabelTypeIds.nonEmpty

        // Checks if there are still labels in the database for the user to validate.
        hasWork match {
          case true => {
            // possibleLabelTypeIds can contain elements [1, 2, 3, 4, 7]. Select ids 1, 2, 3, 4 if
            // possible, otherwise choose 7.
            val index: Int = if (possibleLabelTypeIds.size > 1) scala.util.Random.nextInt(possibleLabelTypeIds.size - 1) else 0
            val labelTypeId: Int = possibleLabelTypeIds(index)
            val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId, AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION, 0.0, labelTypeId).get
            val labelList: JsValue = getLabelListForValidation(user.userId, labelTypeId, mission)
            val missionJsObject: JsObject = mission.toJSON
            val progressJsObject: JsObject = LabelValidationTable.getValidationProgress(mission.missionId)
            Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user), Some(missionJsObject), Some(labelList), Some(progressJsObject), true)))
          }
          case false => {
            Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user), None, None, None, false)))
          }
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/validate"));
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
    val labelsProgress: Int = mission.labelsProgress.get
    val labelsValidated: Int = mission.labelsValidated.get
    val labelsToRetrieve: Int = labelsValidated - labelsProgress

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
