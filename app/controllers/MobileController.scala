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
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.label.LabelTable.LabelValidationMetadata
import models.mission.Mission
import models.mission.MissionTable
import models.validation._
import models.user._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future
import scala.collection.mutable.ListBuffer

class MobileController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns the validation page.
    * @return
    */
  def mobileValidate = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_MobileValidate", timestamp))
        val possibleLabelTypeIds: ListBuffer[Int] = LabelTable.retrievePossibleLabelTypeIds(user.userId, 10, None)
        val hasWork: Boolean = possibleLabelTypeIds.nonEmpty

        // Checks if there are still labels in the database for the user to validate.
        hasWork match {
          case true => {
            // possibleLabelTypeIds can contain elements [1, 2, 3, 4, 7]. Select ids 1, 2, 3, 4 if
            // possible, otherwise choose 7.
            val index: Int = if (possibleLabelTypeIds.size > 1) scala.util.Random.nextInt(possibleLabelTypeIds.size - 1) else 0
            val labelTypeId: Int = possibleLabelTypeIds(index)
            val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId, 0.0, 0.0, labelTypeId).get
            val labelsProgress: Int = mission.labelsProgress.get
            val labelsValidated: Int = mission.labelsValidated.get
            val labelsToRetrieve: Int = labelsValidated - labelsProgress

            val labelList: JsValue = getLabelListForValidation(user.userId, labelsToRetrieve, labelTypeId)
            val missionJsObject: JsObject = mission.toJSON
            Future.successful(Ok(views.html.mobileValidate("Project Sidewalk - Validate", Some(user), Some(missionJsObject), Some(labelList), true)))
          }
          case false => {
            Future.successful(Ok(views.html.mobileValidate("Project Sidewalk - Validate", Some(user), None, None, false)))
          }
        }
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/mobileValidate"));
    }
  }

  /**
    * This gets a random list of labels to validate for this mission.
    * @param userId     User ID for current user.
    * @param count      Number of labels to retrieve for this list.
    * @param labelType  Label type id of labels to retrieve.
    * @return           JsValue containing a list of labels with the following attributes:
    *                   {label_id, label_type, gsv_panorama_id, heading, pitch, zoom, canvas_x,
    *                   canvas_y, canvas_width, canvas_height}
    */
  def getLabelListForValidation(userId: UUID, count: Int, labelType: Int): JsValue = {
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelListForValidation(userId, count, labelType)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(label => LabelTable.validationLabelMetadataToJson(label))
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }


}