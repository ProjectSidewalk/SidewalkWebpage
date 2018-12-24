package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.CommentSubmissionFormats._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.label.LabelTable.LabelValidationMetadata
import models.mission.Mission
import models.mission.MissionTable
import models.validation._
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future

class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns the validation page.
    * @return
    */
  def validate = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        // println(user)
        val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId, 0.0, 0.0).get
        val labelsProgress: Int = mission.labelsProgress.get
        val labelsValidated: Int = mission.labelsValidated.get
        val labelsToRetrieve: Int = labelsValidated - labelsProgress
        val labelList: JsValue = getLabelListForValidation(labelsToRetrieve)
        println("Labels to retrieve: " + labelsToRetrieve)
        println("[ValidationController] Mission: " + mission)
        println()
        Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user), mission, labelList)))
      case None =>
        Future.successful(Redirect("/"))
    }
  }

  /**
    * This gets a random list of labels to validate for this mission.
    * @param count  Number of labels to retrieve for this list.
    * @return       JsValue containing a list of labels with the following attributes:
    *               {label_id, label_type, gsv_panorama_id, heading, pitch, zoom, canvas_x, canvas_y,
    *               canvas_width, canvas_height}
    */
  def getLabelListForValidation(count: Int): JsValue = {
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveRandomLabelListForValidation(count)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(label => LabelTable.validationLabelMetadataToJson(label))
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }

  /**
    * This method handles a comment POST request. It parse the comment and insert it into the comment table
    *
    * @return
    */
  def postComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[ValidationCommentSubmission]
    println("[ValidationController] postComment submission: " + submission)
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
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)

        val comment = ValidationTaskComment(0, submission.missionId, submission.labelId, userId,
          ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
          submission.zoom, submission.lat, submission.lng, Some(timestamp), submission.comment)

        val commentId: Int = ValidationTaskCommentTable.save(comment)
        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
      }
    )
  }
}