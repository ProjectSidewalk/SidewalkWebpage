package controllers

import java.sql.Timestamp
import java.time.Instant
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

class MobileController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns a page saying that we do not yet support mobile devices.
    *
    * @return
    */
  def mobileValidate = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_MobileValidate", timestamp))
        val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId, 0.0, 0.0).get
        val labelsProgress: Int = mission.labelsProgress.get
        val labelsValidated: Int = mission.labelsValidated.get
        val labelsToRetrieve: Int = labelsValidated - labelsProgress
        val labelList: JsValue = getLabelListForValidation(labelsToRetrieve)
        Future.successful(Ok(views.html.mobileValidate("Project Sidewalk - Validate", Some(user), mission, labelList)))
      case None =>
        Future.successful(Redirect("/anonSignUp?url=/mobile"))
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


}