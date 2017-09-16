package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.label.{LabelPointTable, LabelTable}
import models.user.User
import forms.SignInForm
import formats.json.ClusteringFormats
import models.amt.AMTAssignmentTable
import models.clustering_session.ClusteringSessionTable
import play.api.libs.json.{JsError, JsObject, Json}
import play.api.mvc.BodyParsers
import models.gt.GTExistingLabelTable
import models.gt.GTLabelTable
import models.gt._

import scala.concurrent.Future


/**
  * Todo. This controller is written quickly and not well thought out. Someone could polish the controller together with the model code that was written kind of ad-hoc.
  * @param env
  */
class GroundTruthResolutionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {


  // TODO: when merging with develop, change this isAdmin to match develop's isAdmin function in AdminController
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }
  def index = UserAwareAction.async { implicit request =>
    if(isAdmin(request.identity)){
      Future.successful(Ok(views.html.gtresolution("Ground Truth Resolution")))
    }
    else {
      request.identity match{
        case Some(user) => Future.successful(Ok(views.html.signIn(SignInForm.form, "/gtresolution", Some(user))))
        case None => Future.successful(Ok(views.html.signIn(SignInForm.form, "/gtresolution")))
      }
      
    }
  }

  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
  	LabelPointTable.find(labelId) match {
    	case Some(labelPointObj) =>
    	  val labelMetadata = LabelTable.getLabelMetadata(labelId)
    	  val labelMetadataJson: JsObject = LabelTable.labelMetadataToJson(labelMetadata)
    	  Future.successful(Ok(labelMetadataJson))
    	case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
  	}
  }

  /**
    * Gets the set of labels placed by a single GT labeler for the specified condition, so null severities can be fixed.
    *
    * @param conditionId
    * @return
    */
  def getLabelsForGTSeverityFix(conditionId: String) = UserAwareAction.async { implicit request =>
    val labels = AMTAssignmentTable.getLabelsFromGTLabelers(conditionId.toInt)
    val json = Json.arr(labels.map(x => Json.obj(
      "label_id" -> x.labelId, "cluster_id" -> x.clusterId, "route_id" -> x.routeId, "turker_id" -> x.turkerId,
      "pano_id" -> x.gsvPanoramaId, "label_type" -> x.labelType, "sv_image_x" -> x.svImageX, "sv_image_y" -> x.svImageY,
      "sv_canvas_x" -> x.canvasX, "sv_canvas_y" -> x.canvasY, "heading" -> x.heading, "pitch" -> x.pitch,
      "zoom" -> x.zoom, "canvas_height" -> x.canvasHeight, "canvas_width" -> x.canvasWidth, "alpha_x" -> x.alphaX,
      "alpha_y" -> x.alphaY, "lat" -> x.lat, "lng" -> x.lng, "description" -> x.description, "severity" -> x.severity,
      "temporary" -> x.temporaryProblem
    )))
    Future.successful(Ok(json))
  }

  /**
    * Takes in ground truth designated labels and adds the data to the gt_label and gt_existing_label tables
*/
  def postGroundTruthResults = UserAwareAction.async(BodyParsers.parse.json) {implicit request =>
    val submission = request.body.validate[List[ClusteringFormats.GTLabelSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        for (data <- submission) yield {
          val gtLabelId: Int = GTLabelTable.save(GTLabel(
            0, data.routeId, data.gsvPanoId, data.labelType, data.svImageX, data.svImageY, data.svCanvasX,
            data.svCanvasY, data.heading, data.pitch, data.zoom, data.canvasHeight, data.canvasWidth, data.alphaX,
            data.alphaY, data.lat, data.lng, data.description, data.severity, data.temporary
          ))
          if (data.labelId.isDefined) {
            GTExistingLabelTable.save(GTExistingLabel(0, gtLabelId, data.labelId.get))
          }
        }
      }
    )
    val json = Json.obj("Status" -> "Success!")
    Future.successful(Ok(json))
  }

}
