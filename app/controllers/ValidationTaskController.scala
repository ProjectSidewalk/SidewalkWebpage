package controllers

import java.sql.Timestamp
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.ValidationTaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.label.LabelTable.LabelValidationMetadata
import models.mission.{Mission, MissionTable}
import models.user.{User, UserCurrentRegionTable}
import models.validation._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._

import scala.concurrent.Future

class ValidationTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class ValidationPostReturnValue(validationTaskId: Int, mission: Option[Mission])
  /**
    * Parse submitted validation data and submit to tables
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */

  def post = UserAwareAction.async(BodyParsers.parse.json) {implicit request =>
    println("[ValidationTaskController] request.body: " + request.body)
    var submission = request.body.validate[Seq[ValidationTaskSubmission]]
    println("[ValidationTaskController] submission: " + submission)
    submission.fold(
      errors => {
        println("[ValidationTaskController] Error: " + errors);
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        for (data <- submission) yield {
          println("[Data] " + data)
          for (interaction: InteractionSubmission <- data.interactions) {
            ValidationTaskInteractionTable.save(ValidationTaskInteraction(0, interaction.missionId, interaction.action,
              interaction.gsvPanoramaId, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
              interaction.zoom, interaction.note, new Timestamp(interaction.timestamp)))
          }
        }
        println("[ValidationTaskController] Success");
        Future.successful(Ok(Json.obj("status" -> "Ok")))
      }
    )
  }

  /**
    * This function gets the metadata for a specific label in the database.
    * @param labelId  label_id for this label
    * @return GSV metadata and label type
    */
  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(Json.obj("status" -> "Ok")))

    LabelTable.find(labelId) match {
      case Some(labelPointObj) =>
        val labelMetadata: LabelValidationMetadata = LabelTable.retrieveSingleLabelForValidation(labelId)
        val labelMetadataJson: JsObject = LabelTable.validationLabelMetadataToJson(labelMetadata)
        Future.successful(Ok(labelMetadataJson))
      case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
    }
  }

  def getRandomLabelData = UserAwareAction.async { implicit request =>
    val labelMetadata: LabelValidationMetadata = LabelTable.retrieveSingleRandomLabelForValidation()
    val labelMetadataJson: JsObject = LabelTable.validationLabelMetadataToJson(labelMetadata)
    Future.successful(Ok(labelMetadataJson))
  }
}
