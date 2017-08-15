package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable.LabelMetadata
import models.label.{LabelPointTable, LabelTable}
import models.user.{User, WebpageActivityTable}
import models.daos.UserDAOImpl
import models.user.UserRoleTable
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import forms.SignInForm

import formats.json.ClusteringFormats
import models.clustering_session.ClusteringSessionTable
import play.api.libs.json.{JsError, JsObject, Json}
import play.api.mvc.BodyParsers
import play.api.libs.json._
import play.api.libs.functional.syntax._
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
    * Takes in ground truth designated labels and adds the data to the relevant tables
*/
  def postGroundTruthResults(clustSessionId: Int) = UserAwareAction.async(BodyParsers.parse.json) {implicit request =>
    val submission = request.body.validate[List[ClusteringFormats.GTLabelSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        // get the route id for this clustering session, returning error if no session is found with that ID
        val routeId: Option[Int] = ClusteringSessionTable.getRouteIdOfClusteringSession(clustSessionId)
        routeId match {
          case Some(id) =>
            for (data <- submission) yield {
              val gtLabelId: Int = GTLabelTable.save(GTLabel(
                0, id, data.gsvPanoId, data.labelType, data.svImageX, data.svImageY, data.svCanvasX, data.svCanvasY,
                data.heading, data.pitch, data.zoom, data.canvasHeight, data.canvasWidth, data.alphaX, data.alphaY,
                data.lat, data.lng, data.description, data.severity, data.temporary
              ))
              if (data.labelId.isDefined) {
                GTExistingLabelTable.save(GTExistingLabel(0, gtLabelId, data.labelId.get))
              }
            }
          case None =>
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "No matching clustering session found")))
        }
      }
    )
    val json = Json.obj()
    println()
    Future.successful(Ok(json))
  }

}
